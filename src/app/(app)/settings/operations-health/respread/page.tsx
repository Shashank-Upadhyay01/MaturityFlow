/**
 * Temporary, admin-only repair for plans the old rollover left in the wrong shape.
 *
 * Three faults, one cure. Until the twelve-working-day rule was restored, a case that fell behind
 * was re-planned into whatever days were left before its ORIGINAL deadline and every missed day
 * burned one of its twelve slots, so a ₹3,98,738 maturity with ₹3,18,738 outstanding came to the
 * counter asking for the whole ₹3,18,738 in a single day. The planning board's Apply re-planned
 * from today rather than from the payment date, shifting a whole cohort forward by a day. And
 * Azamgarh's branch calendar had its Saturday rule set to NONE, so payouts were written onto the
 * second and fourth Saturdays the counter is shut.
 *
 * Each of those shows up here as a case whose live plan disagrees with the branch calendar or
 * with its own band, and each is repaired by the ordinary locked, receipt-aware, audited re-plan.
 * It re-plans from the case's own payment date when that is still ahead, and from today when it
 * is not — so correcting a shape never drags a payout the customer was told to come for onto a
 * day nobody agreed to.
 *
 * Idempotent: once run, the list is empty. Delete this page once the register is clean.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { branches, customers, maturityCases, payoutInstalments } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import {
  LARGE_CASE_THRESHOLD_PAISE,
  recommendedWindowDaysFor,
  rolloverPartsFor,
} from '@/lib/payout-policy';
import { activeRole } from '@/lib/rbac';
import { replanWithWindow } from '@/services/case-service';
import { getBranchPolicy } from '@/services/calendar-service';
import { isWorkingDay, todayISO, type WorkingDayCalendar } from '@/lib/working-days';

export const dynamic = 'force-dynamic';

/** A final instalment may legitimately carry a rounding remainder; a fifth of slack absorbs it. */
const TOLERANCE_NUMERATOR = 12n;
const TOLERANCE_DENOMINATOR = 10n;

interface Target {
  id: string;
  caseNumber: string;
  customerName: string;
  maturityPaise: bigint;
  remainingPaise: bigint;
  biggestPaise: bigint;
  perDayPaise: bigint;
  storedWindowDays: number;
  windowDays: number;
  parts: number;
  from: string;
  why: string;
}

async function findTargets(): Promise<Target[]> {
  const today = todayISO();

  const branchRows = await db.select({ id: branches.id }).from(branches);
  const calendars = new Map<string, WorkingDayCalendar>();
  for (const b of branchRows) {
    calendars.set(b.id, (await getBranchPolicy(b.id)).calendar);
  }

  const rows = await db
    .select({
      id: maturityCases.id,
      branchId: maturityCases.branchId,
      caseNumber: maturityCases.caseNumber,
      customerName: customers.name,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      settlementAdjustmentPaise: maturityCases.settlementAdjustmentPaise,
      windowDays: maturityCases.windowDays,
      paymentOn: maturityCases.paymentOn,
      firstPayoutOn: maturityCases.firstPayoutOn,
      biggest: sql<string>`max(${payoutInstalments.amountPaise})::text`,
      dueDates: sql<string[]>`array_agg(${payoutInstalments.dueOn}::text)`,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(
      payoutInstalments,
      and(
        eq(payoutInstalments.caseId, maturityCases.id),
        isNull(payoutInstalments.supersededAt),
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
      ),
    )
    .where(inArray(maturityCases.status, ['APPROVED', 'IN_PROGRESS', 'ON_HOLD']))
    .groupBy(maturityCases.id, customers.name);

  return rows.flatMap((row) => {
    const remaining =
      row.maturityAmountPaise -
      row.paidCashPaise -
      row.paidOnlinePaise -
      row.settlementAdjustmentPaise;
    if (remaining <= 0n) return [];

    // The band comes from the deposit, never from a `windowDays` an earlier rollover shrank.
    const windowDays = recommendedWindowDaysFor(row.maturityAmountPaise);
    const bandParts = row.maturityAmountPaise >= LARGE_CASE_THRESHOLD_PAISE ? 12n : 6n;
    const perDayPaise = (row.maturityAmountPaise + bandParts - 1n) / bandParts;
    const biggestPaise = BigInt(row.biggest);
    const ceiling = (perDayPaise * TOLERANCE_NUMERATOR) / TOLERANCE_DENOMINATOR;

    const calendar = calendars.get(row.branchId);
    const closedDays = calendar
      ? (row.dueDates ?? []).filter((d) => d >= today && !isWorkingDay(d, calendar))
      : [];

    const reasons: string[] = [];
    if (biggestPaise > ceiling) reasons.push('lump sum');
    if (row.windowDays !== windowDays) reasons.push(`window ${row.windowDays}`);
    if (closedDays.length > 0) reasons.push(`closed day ${closedDays.join(', ')}`);
    if (reasons.length === 0) return [];

    const promised = row.paymentOn ?? row.firstPayoutOn;
    return [
      {
        id: row.id,
        caseNumber: row.caseNumber,
        customerName: row.customerName,
        maturityPaise: row.maturityAmountPaise,
        remainingPaise: remaining,
        biggestPaise,
        perDayPaise,
        storedWindowDays: row.windowDays,
        windowDays,
        parts: rolloverPartsFor(row.maturityAmountPaise, remaining, windowDays),
        from: promised && promised > today ? promised : today,
        why: reasons.join(' · '),
      },
    ];
  });
}

async function respread() {
  'use server';
  const { session, actor } = await requireActor();
  if (activeRole(actor.role) !== 'ADMIN') throw new Error('Admin only');
  const targets = await findTargets();
  const meta = await requestMeta();
  let changed = 0;
  const failed: string[] = [];
  for (const t of targets) {
    try {
      await replanWithWindow(
        session,
        t.id,
        t.windowDays,
        'Re-spread to the twelve-working-day rule from the payment date, on the branch calendar.',
        meta,
        t.from,
      );
      changed += 1;
    } catch (error) {
      failed.push(`${t.caseNumber}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed.length > 0) {
    throw new Error(`${changed} re-spread; ${failed.length} failed — ${failed.join(' | ')}`);
  }
  redirect(`/maturities?respread=${changed}`);
}

export default async function RespreadPage() {
  const { actor } = await requireActor();
  if (activeRole(actor.role) !== 'ADMIN') redirect('/dashboard');
  const targets = await findTargets();
  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-xl font-semibold">Re-spread plans</h1>
      <p className="mt-2 text-sm opacity-80">
        {targets.length === 0
          ? 'Nothing to do — every live plan is on the twelve-working-day rule and on an open day.'
          : `${targets.length} plan${targets.length === 1 ? '' : 's'} disagree with the ₹1 lakh rule or with the branch calendar.`}
      </p>
      {targets.length > 0 && (
        <>
          <table className="mt-5 w-full border-collapse text-xs">
            <thead>
              <tr className="text-left opacity-70">
                <th className="py-1 pr-3">Case</th>
                <th className="py-1 pr-3">Customer</th>
                <th className="py-1 pr-3 text-right">Maturity</th>
                <th className="py-1 pr-3 text-right">Left</th>
                <th className="py-1 pr-3 text-right">Biggest day now</th>
                <th className="py-1 pr-3 text-right">Should be</th>
                <th className="py-1 pr-3 text-right">Window</th>
                <th className="py-1 pr-3 text-right">Parts</th>
                <th className="py-1 pr-3">From</th>
                <th className="py-1">Why</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-1 pr-3 whitespace-nowrap">{t.caseNumber}</td>
                  <td className="py-1 pr-3">{t.customerName}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatPaise(t.maturityPaise)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatPaise(t.remainingPaise)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatPaise(t.biggestPaise)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatPaise(t.perDayPaise)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {t.storedWindowDays === t.windowDays
                      ? t.windowDays
                      : `${t.storedWindowDays} → ${t.windowDays}`}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{t.parts}</td>
                  <td className="py-1 pr-3 whitespace-nowrap tabular-nums">{t.from}</td>
                  <td className="py-1 opacity-70">{t.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={respread} className="mt-6">
            <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
              Re-spread {targets.length} plan{targets.length === 1 ? '' : 's'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
