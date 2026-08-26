/**
 * The schedule lifecycle after approval — against a real database.
 *
 * Requires a live database (DATABASE_URL) and writes to it. Excluded from `npm test`.
 *   npm run test:db
 *
 * The pure rebalance is proven in tests/schedule-edit.fuzz.test.ts. What this file proves is the
 * part that only a real database can show:
 *   • the cadence policy actually shapes a persisted schedule (12 daily / 6 alternate)
 *   • an edit persists, moves only the later rows, and leaves the case total untouched
 *   • INV-3 (cash + online === amount) survives every rewritten row — it is a DB CHECK
 *   • a day already paid cannot be edited
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '@/db';
import {
  agents,
  branches,
  customers,
  maturityCases,
  payoutInstalments,
  payoutTransactions,
  users,
} from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { rupees } from '@/lib/money';
import { permissionsOf } from '@/lib/rbac';
import type { Actor } from '@/lib/rbac';
import { createCase } from '@/services/case-service';
import {
  listBreachedCases,
  listMissedInstalments,
  listNotTakenToday,
  listPriorityCases,
} from '@/services/queries';
import { persistInstalmentEdit } from '@/services/schedule-service';
import { todayISO } from '@/lib/working-days';

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
let ops: SessionUser;

beforeAll(async () => {
  branchId = newId('br');
  await db.insert(branches).values({
    id: branchId,
    code: `SE${Date.now().toString().slice(-6)}`,
    name: 'Schedule Edit Test Branch',
    dailyCashComfortPaise: rupees('10000000'),
  });

  const id = newId('usr');
  await db.insert(users).values({
    id,
    email: `${id}@test.local`,
    username: id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32) || `u${id.slice(-8)}`,
    name: 'Ops Tester (Admin)',
    passwordHash: 'x'.repeat(60),
    role: 'ADMIN',
    branchId,
  });
  ops = session(id, 'Ops Tester (Admin)', 'ADMIN', branchId);

  agentId = newId('agt');
  await db.insert(agents).values({
    id: agentId,
    code: `SEA${Date.now().toString().slice(-6)}`,
    name: 'Schedule Edit Agent',
    branchId,
  });

  customerId = newId('cus');
  await db.insert(customers).values({
    id: customerId,
    name: 'Schedule Edit Customer',
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
  }
  await db.delete(maturityCases).where(eq(maturityCases.branchId, branchId));
  await db.delete(customers).where(eq(customers.branchId, branchId));
  await db.delete(agents).where(eq(agents.branchId, branchId));
  await db.delete(users).where(eq(users.branchId, branchId));
  await db.delete(branches).where(eq(branches.id, branchId));
  await pool.end();
});

async function approved(amount: string) {
  const { id } = await createCase(ops, {
    branchId,
    agentId,
    customerId,
    maturityAmountPaise: rupees(amount),
    formSubmittedOn: todayISO(),
    windowDays: 15,
    roundingPaise: rupees('1000'),
    distribution: 'FRONT_LOADED',
    cashPolicy: 'CASH_ONLY',
    // Creating with submitNow now schedules in the same transaction — there is nothing to approve.
    instrumentMaturityOn: todayISO(),
    submitNow: true,
  });
  return id;
}

const rowsOf = (caseId: string) =>
  db
    .select()
    .from(payoutInstalments)
    .where(eq(payoutInstalments.caseId, caseId))
    .then((r) => r.sort((a, b) => a.seq - b.seq));

describe('the cadence policy shapes what is persisted', () => {
  it('a case at the ₹1 lakh line gets 12 daily instalments', async () => {
    const caseId = await approved('100000');
    const rows = await rowsOf(caseId);
    expect(rows).toHaveLength(12);
    const [c] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId));
    expect(c.cadence).toBe('DAILY');
    expect(rows.reduce((a, r) => a + r.amountPaise, 0n)).toBe(c.maturityAmountPaise);
  });

  it('a case below the line gets 6 alternate-day instalments, inside the same deadline', async () => {
    const caseId = await approved('99999');
    const rows = await rowsOf(caseId);
    expect(rows).toHaveLength(6);
    const [c] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId));
    expect(c.cadence).toBe('ALTERNATE');
    expect(rows.reduce((a, r) => a + r.amountPaise, 0n)).toBe(c.maturityAmountPaise);
    expect(rows[rows.length - 1].dueOn <= (c.deadlineOn ?? '9999-12-31')).toBe(true);
  });
});

describe('persistInstalmentEdit', () => {
  it('moves money to the later days and leaves the total alone', async () => {
    const caseId = await approved('120000');
    const before = await rowsOf(caseId);
    const [caseRow] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId));
    const total = before.reduce((a, r) => a + r.amountPaise, 0n);

    const target = before[2];
    const newAmount = target.amountPaise + rupees('3000');

    await db.transaction(async (tx) => {
      await persistInstalmentEdit({
        tx,
        caseRow,
        instalmentId: target.id,
        newAmountPaise: newAmount,
      });
    });

    const after = await rowsOf(caseId);
    expect(after.reduce((a, r) => a + r.amountPaise, 0n)).toBe(total);
    expect(after[2].amountPaise).toBe(newAmount);
    // Days before the edit are untouched.
    expect(after[0].amountPaise).toBe(before[0].amountPaise);
    expect(after[1].amountPaise).toBe(before[1].amountPaise);
    // INV-3 holds on every row — it is also a database CHECK, so a bad write would have thrown.
    for (const r of after) {
      expect(r.cashLegPaise + r.onlineLegPaise).toBe(r.amountPaise);
    }
  });

  it('refuses to edit a day that has already been paid in full', async () => {
    const caseId = await approved('120000');
    const rows = await rowsOf(caseId);
    const first = rows[0];

    // Mark day 1 as fully paid directly — this test is about the edit guard, not the payout path.
    await db
      .update(payoutInstalments)
      .set({ paidCashPaise: first.amountPaise, status: 'PAID' })
      .where(eq(payoutInstalments.id, first.id));

    const [caseRow] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId));

    await expect(
      db.transaction(async (tx) => {
        await persistInstalmentEdit({
          tx,
          caseRow,
          instalmentId: first.id,
          newAmountPaise: 1n,
        });
      }),
    ).rejects.toThrow(/already been paid/i);
  });

  it('refuses an edit the later days cannot fund', async () => {
    const caseId = await approved('120000');
    const rows = await rowsOf(caseId);
    const [caseRow] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId));

    await expect(
      db.transaction(async (tx) => {
        await persistInstalmentEdit({
          tx,
          caseRow,
          instalmentId: rows[0].id,
          newAmountPaise: caseRow.maturityAmountPaise * 2n,
        });
      }),
    ).rejects.toThrow(/do not hold enough/i);
  });
});

describe('the follow-up lists', () => {
  /** Ops sees every branch, so the fixture branch's rows are in scope. */
  const actor = (): Actor => ({
    id: ops.id,
    role: 'ADMIN',
    branchId: null,
    agentId: null,
    name: ops.name,
  });

  const onlyOurs = <T extends { caseId: string }>(rows: T[], ids: Set<string>) =>
    rows.filter((r) => ids.has(r.caseId));

  it('finds a day that came and went unpaid', async () => {
    const caseId = await approved('120000');
    const rows = await rowsOf(caseId);
    // Drag day 1 into the past without paying it.
    await db
      .update(payoutInstalments)
      .set({ dueOn: '2020-01-06' })
      .where(eq(payoutInstalments.id, rows[0].id));

    const missed = onlyOurs(await listMissedInstalments(actor(), todayISO()), new Set([caseId]));
    expect(missed).toHaveLength(1);
    expect(missed[0].dueOn).toBe('2020-01-06');
    // The list carries what the branch needs to chase it.
    expect(BigInt(missed[0].maturityAmountPaise)).toBe(rupees('120000'));
    expect(BigInt(missed[0].duePaidPaise)).toBe(0n);
  });

  it("finds today's counter — due now, not yet handed over", async () => {
    const caseId = await approved('120000');
    const rows = await rowsOf(caseId);
    await db
      .update(payoutInstalments)
      .set({ dueOn: todayISO() })
      .where(eq(payoutInstalments.id, rows[0].id));

    const today = onlyOurs(await listNotTakenToday(actor(), todayISO()), new Set([caseId]));
    expect(today).toHaveLength(1);
    expect(BigInt(today[0].dueAmountPaise) - BigInt(today[0].duePaidPaise)).toBeGreaterThan(0n);
  });

  it('lists only the cases at or above the ₹1 lakh line, with the agent on each', async () => {
    const big = await approved('150000');
    const small = await approved('50000');
    const priority = await listPriorityCases(actor(), todayISO());
    const ids = priority.map((r) => r.caseId);
    expect(ids).toContain(big);
    expect(ids).not.toContain(small);
    const mine = priority.find((r) => r.caseId === big);
    expect(mine?.agentName).toBe('Schedule Edit Agent');
    expect(mine?.cadence).toBe('DAILY');
  });

  it('flags a case past its promised date with money still owed', async () => {
    const caseId = await approved('120000');
    await db
      .update(maturityCases)
      .set({ deadlineOn: '2020-02-01' })
      .where(eq(maturityCases.id, caseId));

    const breached = onlyOurs(await listBreachedCases(actor(), todayISO()), new Set([caseId]));
    expect(breached).toHaveLength(1);
    expect(breached[0].deadlineOn).toBe('2020-02-01');
    expect(BigInt(breached[0].paidCashPaise) + BigInt(breached[0].paidOnlinePaise)).toBe(0n);
  });

  it('a fully paid case is past nobody’s deadline', async () => {
    const caseId = await approved('120000');
    await db
      .update(maturityCases)
      .set({ deadlineOn: '2020-02-01', paidCashPaise: rupees('120000') })
      .where(eq(maturityCases.id, caseId));

    const breached = onlyOurs(await listBreachedCases(actor(), todayISO()), new Set([caseId]));
    expect(breached).toHaveLength(0);
  });
});
