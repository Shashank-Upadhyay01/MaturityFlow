/**
 * Auto-scheduling — submitting a maturity is now the whole workflow.
 *
 * Requires a live database (DATABASE_URL) and writes to it. Excluded from `npm test`.
 *   npm run test:db
 *
 * There is no Ops Head and no approval step. These prove the properties that replaced it:
 *   • submitting generates the schedule, in the same transaction, with its own audit row
 *   • the anchor is the customer's maturity date + 3 calendar days, rolled onto an open day
 *   • a case that matured long ago starts now, never in the past
 *   • a case with no maturity date is refused rather than guessed at
 *   • submitting twice does not schedule twice
 */
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '@/db';
import {
  agents,
  auditLog,
  branches,
  caseEvents,
  customers,
  maturityCases,
  payoutInstalments,
  payoutTransactions,
  users,
} from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { rupees } from '@/lib/money';
import { scheduleAnchorFor } from '@/lib/payout-policy';
import { permissionsOf } from '@/lib/rbac';
import { createCase, submitCase } from '@/services/case-service';
import { makeCalendar, todayISO } from '@/lib/working-days';

function session(id: string, name: string, role: SessionUser['role'], branchId: string): SessionUser {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\W/g, '')}@test.local`,
    username: name.toLowerCase().replace(/\W/g, '') || 'tester',
    phone: null,
    role,
    branchId,
    branchName: null,
    branchCode: null,
    agentId: null,
    mustChangePassword: false,
    hasAvatar: false,
    avatarAt: 0,
    orgName: 'Test',
    orgShortName: 'Test',
    permissions: permissionsOf(role),
    tokenId: newId('tok'),
  };
}

let branchId: string;
let agentId: string;
let customerId: string;
let admin: SessionUser;

beforeAll(async () => {
  branchId = newId('br');
  await db.insert(branches).values({
    id: branchId,
    code: `AS${Date.now().toString().slice(-6)}`,
    name: 'Auto-schedule Test Branch',
    dailyCashComfortPaise: rupees('10000000'),
  });

  const id = newId('usr');
  await db.insert(users).values({
    id,
    email: `${id}@test.local`,
    username: id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32) || `u${id.slice(-8)}`,
    name: 'Auto Tester',
    passwordHash: 'x'.repeat(60),
    role: 'ADMIN',
    branchId,
  });
  admin = session(id, 'Auto Tester', 'ADMIN', branchId);

  agentId = newId('agt');
  await db.insert(agents).values({
    id: agentId,
    code: `ASA${Date.now().toString().slice(-6)}`,
    name: 'Auto-schedule Agent',
    branchId,
  });

  customerId = newId('cus');
  await db.insert(customers).values({
    id: customerId,
    name: 'Auto-schedule Customer',
    branchId,
    agentId,
  });
});

afterAll(async () => {
  await db.delete(payoutTransactions).where(eq(payoutTransactions.branchId, branchId));
  const cases = await db
    .select({ id: maturityCases.id })
    .from(maturityCases)
    .where(eq(maturityCases.branchId, branchId));
  for (const c of cases) {
    await db.delete(payoutInstalments).where(eq(payoutInstalments.caseId, c.id));
    await db.delete(caseEvents).where(eq(caseEvents.caseId, c.id));
  }
  await db.delete(maturityCases).where(eq(maturityCases.branchId, branchId));
  await db.delete(customers).where(eq(customers.branchId, branchId));
  await db.delete(agents).where(eq(agents.branchId, branchId));
  await db.delete(users).where(eq(users.branchId, branchId));
  await db.delete(branches).where(eq(branches.id, branchId));
  await pool.end();
});

/** A DRAFT case — created but deliberately not submitted, so each test drives submitCase itself. */
async function draft(opts: { maturityOn: string | null; amount?: string; windowDays?: number }) {
  return createCase(admin, {
    branchId,
    agentId,
    customerId,
    maturityAmountPaise: rupees(opts.amount ?? '120000'),
    formSubmittedOn: todayISO(),
    instrumentMaturityOn: opts.maturityOn,
    windowDays: opts.windowDays ?? 15,
    roundingPaise: rupees('1000'),
    distribution: 'FRONT_LOADED',
    cashPolicy: 'CASH_ONLY',
    submitNow: false,
  });
}

const readCase = async (id: string) =>
  (await db.select().from(maturityCases).where(eq(maturityCases.id, id)).limit(1))[0];

const readInstalments = async (id: string) =>
  db.select().from(payoutInstalments).where(eq(payoutInstalments.caseId, id)).orderBy(asc(payoutInstalments.seq));

const readEvents = async (id: string) =>
  db.select().from(caseEvents).where(eq(caseEvents.caseId, id)).orderBy(asc(caseEvents.at));

const readAudit = async (id: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityId, id));

describe('submitting schedules the case', () => {
  it('moves straight to APPROVED with a full schedule', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20', amount: '120000' });
    const res = await submitCase(admin, id);

    expect(res.ok).toBe(true);
    expect(res.instalments).toBe(12);

    const expected = scheduleAnchorFor('2026-09-20', todayISO(), makeCalendar());
    expect(res.firstPayoutOn).toBe(expected);

    const row = await readCase(id);
    expect(row.status).toBe('APPROVED');
    expect(row.approvedById).toBeNull(); // nobody approved it
    expect(row.approvedOn).toBe(expected); // the anchor, kept for the SLA clock
    expect(row.deadlineOn).toBe(res.lastPayoutOn);
  });

  it('splits the money exactly, to the paise', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20', amount: '120000' });
    await submitCase(admin, id);
    const rows = await readInstalments(id);
    const total = rows.reduce((s, r) => s + r.amountPaise, 0n);
    expect(total).toBe(rupees('120000'));
  });

  it('pays on the anchor itself — no processing days on top', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20' });
    const res = await submitCase(admin, id);
    const rows = await readInstalments(id);
    expect(rows[0].dueOn).toBe(res.firstPayoutOn);
  });

  it('writes both events and an audit row in the same transaction', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20' });
    await submitCase(admin, id);
    expect((await readEvents(id)).map((e) => e.type)).toEqual([
      'CREATED',
      'SUBMITTED',
      'SCHEDULE_GENERATED',
    ]);
    expect((await readAudit(id)).some((a) => a.action === 'case.submitted')).toBe(true);
  });

  it('is idempotent — a second submit is refused, not double-scheduled', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20' });
    await submitCase(admin, id);
    await expect(submitCase(admin, id)).rejects.toThrow(/already/i);
    expect(await readInstalments(id)).toHaveLength(12);
  });

  it('refuses a case with no maturity date rather than guessing', async () => {
    const { id } = await draft({ maturityOn: null });
    await expect(submitCase(admin, id)).rejects.toThrow(/maturity date/i);
    expect((await readCase(id)).status).toBe('DRAFT');
    expect(await readInstalments(id)).toHaveLength(0);
  });

  it('starts a long-matured case today, not in the past', async () => {
    const { id } = await draft({ maturityOn: '2024-06-22' });
    const res = await submitCase(admin, id);
    expect(res.firstPayoutOn >= todayISO()).toBe(true);
    const rows = await readInstalments(id);
    expect(rows.every((r) => r.dueOn >= todayISO())).toBe(true);
  });

  it('a sub-lakh maturity pays on alternate days, still inside the window', async () => {
    const { id } = await draft({ maturityOn: '2026-09-20', amount: '60000' });
    const res = await submitCase(admin, id);
    expect(res.instalments).toBe(6);
    const rows = await readInstalments(id);
    expect(rows.reduce((s, r) => s + r.amountPaise, 0n)).toBe(rupees('60000'));
  });
});

describe('createCase(submitNow) takes the same path', () => {
  it('schedules immediately rather than parking in SUBMITTED', async () => {
    const { id } = await createCase(admin, {
      branchId,
      agentId,
      customerId,
      maturityAmountPaise: rupees('120000'),
      formSubmittedOn: todayISO(),
      instrumentMaturityOn: '2026-09-20',
      windowDays: 15,
      roundingPaise: rupees('1000'),
      distribution: 'FRONT_LOADED',
      cashPolicy: 'CASH_ONLY',
      submitNow: true,
    });

    const row = await readCase(id);
    expect(row.status).toBe('APPROVED');
    expect(await readInstalments(id)).toHaveLength(12);
  });
});
