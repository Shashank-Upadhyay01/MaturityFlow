/**
 * Concurrency — the tests that matter once more than one person uses this at once.
 *
 * Requires a live database (DATABASE_URL) and writes to it. Excluded from `npm test`.
 *   npm run test:db
 *
 * These prove the properties that a busy branch actually stresses:
 *   • two cashiers paying the same instalment at the same instant cannot double-pay it
 *   • the case ledger can never exceed the maturity amount, under any interleaving
 *   • two approvers clicking Approve on the same case produce exactly one schedule
 *   • the case-number counter never collides under parallel intake
 */
import { and, eq, sql } from 'drizzle-orm';
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
import { approveCase, createCase } from '@/services/case-service';
import { recordPayout } from '@/services/payout-service';
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
let cashierA: SessionUser;
let cashierB: SessionUser;

beforeAll(async () => {
  // A dedicated branch so the fixture never collides with seeded demo data.
  branchId = newId('br');
  await db.insert(branches).values({
    id: branchId,
    code: `CT${Date.now().toString().slice(-6)}`,
    name: 'Concurrency Test Branch',
    dailyCashComfortPaise: rupees('10000000'),
  });

  const mk = async (role: SessionUser['role'], name: string) => {
    const id = newId('usr');
    await db.insert(users).values({
      id,
      email: `${id}@test.local`,
      username: id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32) || `u${id.slice(-8)}`,
      name,
      passwordHash: 'x'.repeat(60),
      role,
      branchId,
    });
    return session(id, name, role, branchId);
  };

  ops = await mk('OPS_HEAD', 'Ops Tester');
  cashierA = await mk('CASHIER', 'Cashier A');
  cashierB = await mk('CASHIER', 'Cashier B');

  agentId = newId('agt');
  await db.insert(agents).values({
    id: agentId,
    code: `CTA${Date.now().toString().slice(-6)}`,
    name: 'Concurrency Agent',
    branchId,
  });

  customerId = newId('cus');
  await db.insert(customers).values({
    id: customerId,
    name: 'Concurrency Customer',
    branchId,
    agentId,
  });
});

afterAll(async () => {
  // Tear the fixture down in FK order.
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

async function makeApprovedCase(amount: string, days = 10) {
  const { id } = await createCase(ops, {
    branchId,
    agentId,
    customerId,
    maturityAmountPaise: rupees(amount),
    formSubmittedOn: todayISO(),
    windowDays: days,
    roundingPaise: rupees('1000'),
    distribution: 'FRONT_LOADED',
    cashPolicy: 'CASH_ONLY',
    submitNow: true,
  });
  await approveCase(ops, { caseId: id });
  return id;
}

async function firstInstalment(caseId: string) {
  const [i] = await db
    .select()
    .from(payoutInstalments)
    .where(and(eq(payoutInstalments.caseId, caseId), eq(payoutInstalments.seq, 1)))
    .limit(1);
  return i;
}

async function caseRow(caseId: string) {
  const [c] = await db.select().from(maturityCases).where(eq(maturityCases.id, caseId)).limit(1);
  return c;
}

describe('two cashiers, one instalment', () => {
  it('cannot both pay the same instalment in full', async () => {
    const caseId = await makeApprovedCase('100000');
    const inst = await firstInstalment(caseId);
    const amount = inst.amountPaise;

    // Fire both at the same instant against the same row.
    const results = await Promise.allSettled([
      recordPayout(cashierA, { instalmentId: inst.id, cashPaise: amount, onlinePaise: 0n }),
      recordPayout(cashierB, { instalmentId: inst.id, cashPaise: amount, onlinePaise: 0n }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(1);        // exactly one wins
    expect(results.length - fulfilled.length).toBe(1); // the other is refused, not silently dropped

    const after = await firstInstalment(caseId);
    expect(after.paidCashPaise + after.paidOnlinePaise).toBe(amount); // paid once, not twice
    expect(after.status).toBe('PAID');
  });

  it('a burst of 12 simultaneous payments never exceeds the maturity amount', async () => {
    const caseId = await makeApprovedCase('50000', 5);
    const inst = await firstInstalment(caseId);
    const c0 = await caseRow(caseId);

    // 12 cashiers all trying to pay the same day, at once.
    const attempts = Array.from({ length: 12 }, (_, i) =>
      recordPayout(i % 2 === 0 ? cashierA : cashierB, {
        instalmentId: inst.id,
        cashPaise: inst.amountPaise,
        onlinePaise: 0n,
      }),
    );
    await Promise.allSettled(attempts);

    const c = await caseRow(caseId);
    const paid = c.paidCashPaise + c.paidOnlinePaise;

    // INV-4, under contention.
    expect(paid).toBeLessThanOrEqual(c.maturityAmountPaise);
    expect(paid).toBe(inst.amountPaise);
    expect(c0.maturityAmountPaise).toBe(c.maturityAmountPaise);
  });

  it('the ledger always reconciles with the transaction log', async () => {
    const caseId = await makeApprovedCase('30000', 3);
    const insts = await db
      .select()
      .from(payoutInstalments)
      .where(eq(payoutInstalments.caseId, caseId));

    // Pay every instalment concurrently — the realistic "end of window" rush.
    await Promise.allSettled(
      insts.map((i) =>
        recordPayout(cashierA, {
          instalmentId: i.id,
          cashPaise: i.amountPaise,
          onlinePaise: 0n,
        }),
      ),
    );

    const c = await caseRow(caseId);
    const [sums] = await db
      .select({
        cash: sql<string>`COALESCE(SUM(${payoutTransactions.cashPaise}),0)`,
        online: sql<string>`COALESCE(SUM(${payoutTransactions.onlinePaise}),0)`,
      })
      .from(payoutTransactions)
      .where(and(eq(payoutTransactions.caseId, caseId), sql`${payoutTransactions.reversedAt} IS NULL`));

    expect(c.paidCashPaise).toBe(BigInt(sums.cash));
    expect(c.paidOnlinePaise).toBe(BigInt(sums.online));
    expect(c.paidCashPaise + c.paidOnlinePaise).toBe(c.maturityAmountPaise);
    expect(c.status).toBe('COMPLETED');
  });
});

describe('two approvers, one case', () => {
  it('produces exactly one schedule, not two', async () => {
    const { id: caseId } = await createCase(ops, {
      branchId,
      agentId,
      customerId,
      maturityAmountPaise: rupees('200000'),
      formSubmittedOn: todayISO(),
      windowDays: 12,
      roundingPaise: rupees('1000'),
      distribution: 'FRONT_LOADED',
      cashPolicy: 'CASH_ONLY',
      submitNow: true,
    });

    const results = await Promise.allSettled([
      approveCase(ops, { caseId }),
      approveCase(ops, { caseId }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1); // INV-7

    const c = await caseRow(caseId);
    expect(c.scheduleVersion).toBe(1);

    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int`, total: sql<string>`COALESCE(SUM(${payoutInstalments.amountPaise}),0)` })
      .from(payoutInstalments)
      .where(and(eq(payoutInstalments.caseId, caseId), eq(payoutInstalments.scheduleVersion, 1)));

    expect(rows[0].n).toBe(12);
    // INV-2 survives the race.
    expect(BigInt(rows[0].total)).toBe(c.maturityAmountPaise);
  });
});

describe('parallel intake', () => {
  it('never issues the same case number twice', async () => {
    const created = await Promise.all(
      Array.from({ length: 25 }, () =>
        createCase(ops, {
          branchId,
          agentId,
          customerId,
          maturityAmountPaise: rupees('10000'),
          formSubmittedOn: todayISO(),
          windowDays: 5,
          roundingPaise: rupees('1000'),
          distribution: 'FRONT_LOADED',
          cashPolicy: 'CASH_ONLY',
        }),
      ),
    );

    const numbers = created.map((c) => c.caseNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
