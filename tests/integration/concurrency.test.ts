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
import { payoutPlanFor } from '@/lib/payout-policy';
import { permissionsOf } from '@/lib/rbac';
import { createCase, submitCase } from '@/services/case-service';
import {
  markInstalmentMissed,
  markInstalmentTaken,
  recordPayout,
} from '@/services/payout-service';
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

  ops = await mk('ADMIN', 'Ops Tester (Admin)');
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
    // Creating with submitNow now schedules in the same transaction — there is nothing to approve.
    instrumentMaturityOn: todayISO(),
    submitNow: true,
  });
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
    // 8 is the TOTAL working-day window: 3 processing days leave 5, and ₹30,000 is below the
    // ₹1 lakh line so it pays on alternate days — a short schedule, which is what this test wants.
    const caseId = await makeApprovedCase('30000', 8);
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

describe('Register Taken / Not taken', () => {
  it('records Taken against today\'s instalment through the ordinary payout ledger', async () => {
    const caseId = await makeApprovedCase('100000');
    const inst = await firstInstalment(caseId);
    await db
      .update(payoutInstalments)
      .set({ dueOn: todayISO() })
      .where(eq(payoutInstalments.id, inst.id));

    await markInstalmentTaken(cashierA, inst.id, 'SPLIT');

    const after = await firstInstalment(caseId);
    const [txn] = await db
      .select()
      .from(payoutTransactions)
      .where(eq(payoutTransactions.instalmentId, inst.id))
      .limit(1);
    expect(after.status).toBe('PAID');
    expect(after.paidCashPaise + after.paidOnlinePaise).toBe(after.amountPaise);
    expect(txn.instalmentId).toBe(inst.id);
  });

  it('refuses to mark a future instalment Taken from today\'s Register', async () => {
    const caseId = await makeApprovedCase('100000');
    const inst = await firstInstalment(caseId);
    expect(inst.dueOn > todayISO()).toBe(true);

    await expect(markInstalmentTaken(cashierA, inst.id, 'SPLIT')).rejects.toMatchObject({
      code: 'NOT_DUE_TODAY',
    });
  });

  it('marks Not taken without moving money and can undo a same-day mis-click', async () => {
    const caseId = await makeApprovedCase('100000');
    const inst = await firstInstalment(caseId);
    await db
      .update(payoutInstalments)
      .set({ dueOn: todayISO() })
      .where(eq(payoutInstalments.id, inst.id));

    await markInstalmentMissed(cashierA, inst.id);
    expect((await firstInstalment(caseId)).status).toBe('MISSED');
    expect((await caseRow(caseId)).paidCashPaise).toBe(0n);

    await markInstalmentMissed(cashierA, inst.id, { clear: true });
    expect((await firstInstalment(caseId)).status).toBe('PENDING');
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
      instrumentMaturityOn: todayISO(),
      submitNow: false,
    });

    // The race that used to be two Approve clicks is now two Submit clicks. Same invariant:
    // whoever loses the case row lock must find the case already scheduled and back out.
    const results = await Promise.allSettled([
      submitCase(ops, caseId),
      submitCase(ops, caseId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1); // INV-7

    const c = await caseRow(caseId);
    expect(c.scheduleVersion).toBe(1);

    const rows = await db
      .select({ n: sql<number>`COUNT(*)::int`, total: sql<string>`COALESCE(SUM(${payoutInstalments.amountPaise}),0)` })
      .from(payoutInstalments)
      .where(and(eq(payoutInstalments.caseId, caseId), eq(payoutInstalments.scheduleVersion, 1)));

    // Derived, not hard-coded: `windowDays` is the total window, so the payout count is whatever
    // the policy says it is. Writing 9 here would silently rot the next time the window changes.
    expect(rows[0].n).toBe(payoutPlanFor(rupees('200000'), 12).payoutDays);
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
