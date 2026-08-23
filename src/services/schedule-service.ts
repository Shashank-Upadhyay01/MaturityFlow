import 'server-only';

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Queryable } from '@/db';
import { maturityCases, payoutInstalments, type MaturityCase } from '@/db/schema';
import { newId } from '@/lib/id';
import {
  type CashPolicy,
  type ScheduleResult,
  deriveDeadline,
  generateSchedule,
  rescheduleRemaining,
} from '@/lib/payout-engine';
import type { WorkingDayCalendar } from '@/lib/working-days';
import { todayISO } from '@/lib/working-days';

/** Rebuild the engine's cash policy from the persisted case columns. */
export function cashPolicyOf(c: {
  cashPolicy: MaturityCase['cashPolicy'];
  cashCapPerDayPaise: bigint | null;
}): CashPolicy {
  if (c.cashPolicy === 'CASH_CAP') {
    return { kind: 'CASH_CAP', cashCapPerDayPaise: c.cashCapPerDayPaise ?? 0n };
  }
  return { kind: c.cashPolicy };
}

export interface PersistScheduleArgs {
  tx: Queryable;
  caseRow: MaturityCase;
  calendar: WorkingDayCalendar;
  /** The approval date — the anchor. Defaults to the case's approvedOn. */
  anchorDate?: string;
  branchDailyCashComfortPaise?: bigint;
}

/**
 * Compute the schedule SERVER-SIDE from the stored parameters and write it.
 *
 * The client never supplies instalment rows — only the parameters. That is what makes a
 * tampered browser incapable of creating a schedule that does not sum to the maturity amount.
 */
export async function persistSchedule({
  tx,
  caseRow,
  calendar,
  anchorDate,
  branchDailyCashComfortPaise,
}: PersistScheduleArgs): Promise<ScheduleResult> {
  const anchor = anchorDate ?? caseRow.approvedOn;
  if (!anchor) throw new Error('Cannot generate a schedule before the case is approved');

  const result = generateSchedule({
    totalPaise: caseRow.maturityAmountPaise,
    days: caseRow.windowDays,
    roundingPaise: caseRow.roundingPaise,
    startDate: anchor,
    calendar,
    distribution: caseRow.distribution,
    cashPolicy: cashPolicyOf(caseRow),
    startOnNextWorkingDay: caseRow.startOnNextWorkingDay,
    policyMaxDays: caseRow.windowDays,
    branchDailyCashComfortPaise,
  });

  const version = caseRow.scheduleVersion + 1;

  await tx.insert(payoutInstalments).values(
    result.installments.map((i) => ({
      id: newId('inst'),
      caseId: caseRow.id,
      scheduleVersion: version,
      seq: i.seq,
      dueOn: i.dueDate,
      amountPaise: i.amountPaise,
      cashLegPaise: i.cashLegPaise,
      onlineLegPaise: i.onlineLegPaise,
      isFinal: i.isFinal,
      status: 'PENDING' as const,
    })),
  );

  await tx
    .update(maturityCases)
    .set({
      scheduleVersion: version,
      scheduleGeneratedAt: new Date(),
      firstPayoutOn: result.firstPayoutDate,
      deadlineOn: deriveDeadline(anchor, caseRow.windowDays, calendar, caseRow.startOnNextWorkingDay),
      updatedAt: new Date(),
    })
    .where(eq(maturityCases.id, caseRow.id));

  return result;
}

/**
 * Re-plan the unpaid remainder over the working days that are left, keeping the promised
 * completion date. Paid and part-paid instalments are never touched.
 */
export async function persistReschedule({
  tx,
  caseRow,
  calendar,
  fromDate,
  branchDailyCashComfortPaise,
}: {
  tx: Queryable;
  caseRow: MaturityCase;
  calendar: WorkingDayCalendar;
  fromDate?: string;
  branchDailyCashComfortPaise?: bigint;
}): Promise<{ result: ReturnType<typeof rescheduleRemaining>; carriedOverPaise: bigint } | null> {
  const paid = caseRow.paidCashPaise + caseRow.paidOnlinePaise;
  const remaining = caseRow.maturityAmountPaise - paid;
  if (remaining <= 0n) return null;

  const today = fromDate ?? todayISO();

  // Rows that keep their identity: anything already carrying money.
  const live = await tx
    .select()
    .from(payoutInstalments)
    .where(
      and(
        eq(payoutInstalments.caseId, caseRow.id),
        eq(payoutInstalments.scheduleVersion, caseRow.scheduleVersion),
      ),
    );

  const settled = live.filter((i) => i.paidCashPaise + i.paidOnlinePaise > 0n);
  const settledTotal = settled.reduce((a, i) => a + i.paidCashPaise + i.paidOnlinePaise, 0n);
  const carriedOverPaise = caseRow.maturityAmountPaise - settledTotal;

  const openIds = live
    .filter((i) => i.paidCashPaise + i.paidOnlinePaise === 0n)
    .map((i) => i.id);

  if (openIds.length > 0) {
    await tx
      .update(payoutInstalments)
      .set({ status: 'SUPERSEDED', supersededAt: new Date(), updatedAt: new Date() })
      .where(inArray(payoutInstalments.id, openIds));
  }
  // Part-paid rows from the old version are frozen at what was actually paid.
  const partial = settled.filter((i) => i.paidCashPaise + i.paidOnlinePaise < i.amountPaise);
  for (const p of partial) {
    await tx
      .update(payoutInstalments)
      .set({
        amountPaise: p.paidCashPaise + p.paidOnlinePaise,
        cashLegPaise: p.paidCashPaise,
        onlineLegPaise: p.paidOnlinePaise,
        status: 'PAID',
        updatedAt: new Date(),
      })
      .where(eq(payoutInstalments.id, p.id));
  }

  const deadline =
    caseRow.deadlineOn ??
    deriveDeadline(caseRow.approvedOn ?? today, caseRow.windowDays, calendar, caseRow.startOnNextWorkingDay);

  const result = rescheduleRemaining({
    remainingPaise: remaining,
    fromDate: today,
    deadlineDate: deadline,
    roundingPaise: caseRow.roundingPaise,
    calendar,
    distribution: caseRow.distribution,
    cashPolicy: cashPolicyOf(caseRow),
    branchDailyCashComfortPaise,
  });

  const version = caseRow.scheduleVersion + 1;
  // New rows must start after the HIGHEST sequence number carried forward, not after the
  // count of them. If day 1 and day 3 were paid but day 2 was missed, `settled.length` is 2
  // and the first new row would be numbered 3 — colliding with the day-3 row being carried
  // into the same version, and violating (caseId, scheduleVersion, seq).
  const offset = settled.reduce((max, i) => (i.seq > max ? i.seq : max), 0);

  await tx.insert(payoutInstalments).values(
    result.installments.map((i) => ({
      id: newId('inst'),
      caseId: caseRow.id,
      scheduleVersion: version,
      seq: offset + i.seq,
      dueOn: i.dueDate,
      amountPaise: i.amountPaise,
      cashLegPaise: i.cashLegPaise,
      onlineLegPaise: i.onlineLegPaise,
      isFinal: i.isFinal,
      status: 'PENDING' as const,
    })),
  );

  // Carry the already-settled rows forward into the new version so one query still
  // returns the complete picture of the case.
  if (settled.length > 0) {
    await tx
      .update(payoutInstalments)
      .set({ scheduleVersion: version, updatedAt: new Date() })
      .where(
        inArray(
          payoutInstalments.id,
          settled.map((s) => s.id),
        ),
      );
  }

  await tx
    .update(maturityCases)
    .set({ scheduleVersion: version, scheduleGeneratedAt: new Date(), updatedAt: new Date() })
    .where(eq(maturityCases.id, caseRow.id));

  return { result, carriedOverPaise };
}

/**
 * Change the withdrawal window and rebuild unpaid days from `fromDate`.
 * Paid instalments are frozen. Remaining rupees still sum to the unpaid total (INV-2).
 */
export async function persistReplanWindow({
  tx,
  caseRow,
  calendar,
  windowDays,
  fromDate,
  branchDailyCashComfortPaise,
}: {
  tx: Queryable;
  caseRow: MaturityCase;
  calendar: WorkingDayCalendar;
  windowDays: number;
  fromDate: string;
  branchDailyCashComfortPaise?: bigint;
}): Promise<{ result: ReturnType<typeof rescheduleRemaining>; carriedOverPaise: bigint } | null> {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
    throw new Error('Window must be between 1 and 366 working days.');
  }
  const deadline = deriveDeadline(fromDate, windowDays, calendar, false);
  await tx
    .update(maturityCases)
    .set({
      windowDays,
      deadlineOn: deadline,
      updatedAt: new Date(),
    })
    .where(eq(maturityCases.id, caseRow.id));

  return persistReschedule({
    tx,
    caseRow: { ...caseRow, windowDays, deadlineOn: deadline },
    calendar,
    fromDate,
    branchDailyCashComfortPaise,
  });
}

/** Mark past-due unpaid instalments as MISSED so the dashboards can see drift. */
export async function markMissedInstalments(tx: Queryable, asOf = todayISO()): Promise<number> {
  const res = await tx
    .update(payoutInstalments)
    .set({ status: 'MISSED', updatedAt: new Date() })
    .where(
      and(
        sql`${payoutInstalments.dueOn} < ${asOf}`,
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
        ne(payoutInstalments.status, 'SUPERSEDED'),
      ),
    );
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}
