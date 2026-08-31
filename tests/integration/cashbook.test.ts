/**
 * Daily cashbook locking and close-snapshot integration tests.
 *
 * Requires the real DATABASE_URL and migration 0006. Run with `npm run test:db`.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db, pool } from '@/db';
import {
  auditLog,
  branches,
  cashbookCommitments,
  cashbookDays,
  cashbookEntries,
  users,
} from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { toActor } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { rupees } from '@/lib/money';
import { permissionsOf } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';
import {
  CashbookError,
  addCashbookCommitment,
  addCashbookEntry,
  confirmCashbookClose,
  requestCashbookClose,
  saveCashbookDay,
  setCashbookCommitmentSettled,
} from '@/services/cashbook-service';
import { getCashbookDay } from '@/services/queries';

function session(id: string, name: string, role: SessionUser['role'], branchId: string): SessionUser {
  return {
    id,
    name,
    email: `${id}@test.local`,
    username: id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32),
    phone: null,
    role,
    branchId,
    branchName: 'Cashbook Integration Branch',
    branchCode: 'CBI',
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

function figures(expectedVersion: number, note500Count = 0, note = '') {
  return {
    expectedVersion,
    oldPortalTotalPaise: 0n,
    fixedDepositPaise: 0n,
    newBusinessPaise: 0n,
    membershipCollectionPaise: 0n,
    oldLoanPaise: 0n,
    note500Count,
    note200Count: 0,
    note100Count: 0,
    note50Count: 0,
    note20Count: 0,
    note10Count: 0,
    coinsPaise: 0n,
    notes: note,
  };
}

let branchId: string;
let cashierA: SessionUser;
let cashierB: SessionUser;
let admin: SessionUser;

beforeAll(async () => {
  branchId = newId('br');
  await db.insert(branches).values({
    id: branchId,
    code: `CB${Date.now().toString().slice(-6)}`,
    name: 'Cashbook Integration Branch',
    dailyCashComfortPaise: rupees('1000000'),
  });
  const makeUser = async (name: string, role: SessionUser['role']) => {
    const id = newId('usr');
    await db.insert(users).values({
      id,
      email: `${id}@test.local`,
      username: id.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 32),
      name,
      passwordHash: 'x'.repeat(60),
      role,
      branchId,
    });
    return session(id, name, role, branchId);
  };
  cashierA = await makeUser('Cashbook Cashier A', 'CASHIER');
  cashierB = await makeUser('Cashbook Cashier B', 'CASHIER');
  admin = await makeUser('Cashbook Admin', 'ADMIN');
});

afterAll(async () => {
  const days = await db.select({ id: cashbookDays.id }).from(cashbookDays).where(eq(cashbookDays.branchId, branchId));
  for (const day of days) {
    await db.delete(cashbookCommitments).where(eq(cashbookCommitments.cashbookDayId, day.id));
    await db.delete(cashbookEntries).where(eq(cashbookEntries.cashbookDayId, day.id));
  }
  await db.delete(cashbookDays).where(eq(cashbookDays.branchId, branchId));
  await db.delete(auditLog).where(eq(auditLog.branchId, branchId));
  await db.delete(users).where(eq(users.branchId, branchId));
  await db.delete(branches).where(eq(branches.id, branchId));
  await pool.end();
});

describe('cashbook concurrent writers', () => {
  it('serialises simultaneous entries on the parent day and keeps both', async () => {
    const date = addDays(todayISO(), -31);
    await Promise.all([
      addCashbookEntry(cashierA, branchId, date, {
        category: 'OTHER_RECEIPT',
        channel: 'CASH',
        amountPaise: rupees('100'),
      }),
      addCashbookEntry(cashierB, branchId, date, {
        category: 'OTHER_RECEIPT',
        channel: 'CASH',
        amountPaise: rupees('250'),
      }),
    ]);

    const view = await getCashbookDay(toActor(cashierA), branchId, date);
    expect(view?.entries).toHaveLength(2);
    expect(view?.totals.receivingPaise).toBe(rupees('350'));
    expect(view?.day?.version).toBe(2);

    const audits = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.branchId, branchId), eq(auditLog.action, 'cashbook.entry_added')));
    expect(audits).toHaveLength(2);
  });

  it('lets exactly one stale-version figure save win', async () => {
    const date = addDays(todayISO(), -30);
    const first = await addCashbookEntry(cashierA, branchId, date, {
      category: 'OPENING_BALANCE',
      channel: 'CASH',
      amountPaise: rupees('500'),
    });
    const results = await Promise.allSettled([
      saveCashbookDay(cashierA, branchId, date, figures(first.version, 1, 'A')),
      saveCashbookDay(cashierB, branchId, date, figures(first.version, 2, 'B')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toBeInstanceOf(CashbookError);
      expect((rejected.reason as CashbookError).code).toBe('VERSION_CONFLICT');
    }
  });
});

describe('cashbook close snapshot', () => {
  it('stays stable when a named item is settled after close and locks ordinary edits', async () => {
    const date = addDays(todayISO(), -29);
    const opening = await addCashbookEntry(cashierA, branchId, date, {
      category: 'OPENING_BALANCE',
      channel: 'CASH',
      amountPaise: rupees('1000'),
    });
    await saveCashbookDay(cashierA, branchId, date, figures(opening.version, 2));
    const item = await addCashbookCommitment(cashierA, branchId, date, {
      kind: 'DUE_AMOUNT',
      amountPaise: rupees('50'),
      partyName: 'Named Customer',
    });
    await requestCashbookClose(cashierA, branchId, date);
    await confirmCashbookClose(admin, branchId, date, true, 'Count checked');

    const closed = await getCashbookDay(toActor(admin), branchId, date);
    expect(closed?.totalsSource).toBe('CLOSE_SNAPSHOT');
    expect(closed?.totals.state).toBe('BALANCED');
    expect(closed?.totals.dueAmountPaise).toBe(rupees('50'));
    expect(closed?.commitmentTotals.DUE_AMOUNT.outstandingPaise).toBe(rupees('50'));

    await setCashbookCommitmentSettled(cashierA, item.id, true, 'Received next day');
    const afterSettlement = await getCashbookDay(toActor(admin), branchId, date);
    expect(afterSettlement?.totals.dueAmountPaise).toBe(rupees('50'));
    // Historical reads are as-of the selected date: the item was still outstanding when this
    // close was approved. Today's book sees the later settlement and no longer carries it.
    expect(afterSettlement?.commitmentTotals.DUE_AMOUNT.outstandingPaise).toBe(rupees('50'));
    const todayView = await getCashbookDay(toActor(admin), branchId, todayISO());
    expect(todayView?.commitmentTotals.DUE_AMOUNT.outstandingPaise).toBe(0n);

    await expect(
      addCashbookEntry(cashierA, branchId, date, {
        category: 'EXPENSE',
        channel: 'CASH',
        amountPaise: rupees('1'),
      }),
    ).rejects.toMatchObject({ code: 'DAY_LOCKED' });
  });
});
