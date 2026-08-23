'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Banknote, CalendarDays, Info, Send, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { formatPaise } from '@/lib/money';
import {
  type CashPolicy,
  type Distribution,
  type ScheduleResult,
  generateSchedule,
} from '@/lib/payout-engine';
import {
  type SaturdayRule,
  formatISODate,
  formatISODateShort,
  makeCalendar,
  weekdayShort,
} from '@/lib/working-days';
import { cn } from '@/lib/utils';

export interface CalendarSnapshot {
  holidays: string[];
  sundaysOff: boolean;
  saturdayRule: SaturdayRule;
}

export interface SchedulePreviewInput {
  totalPaise: bigint | null;
  days: number;
  roundingPaise: bigint;
  startDate: string;
  distribution: Distribution;
  cashPolicy: CashPolicy;
  startOnNextWorkingDay: boolean;
  calendar: CalendarSnapshot;
  policyMaxDays?: number;
}

/**
 * Runs the very same pure engine the server will run at approval, so the number the
 * approver sees here is the number that gets written. Nothing is estimated.
 */
export function useSchedule(input: SchedulePreviewInput): {
  result: ScheduleResult | null;
  error: string | null;
} {
  const {
    totalPaise,
    days,
    roundingPaise,
    startDate,
    distribution,
    startOnNextWorkingDay,
    calendar,
    policyMaxDays,
  } = input;
  const cashKind = input.cashPolicy.kind;
  const cashCap = input.cashPolicy.cashCapPerDayPaise;

  return useMemo(() => {
    if (!totalPaise || totalPaise <= 0n) return { result: null, error: null };
    try {
      const cal = makeCalendar(calendar.holidays, {
        sundaysOff: calendar.sundaysOff,
        saturdayRule: calendar.saturdayRule,
      });
      return {
        result: generateSchedule({
          totalPaise,
          days,
          roundingPaise,
          startDate,
          calendar: cal,
          distribution,
          cashPolicy:
            cashKind === 'CASH_CAP'
              ? { kind: 'CASH_CAP', cashCapPerDayPaise: cashCap ?? 0n }
              : { kind: cashKind },
          startOnNextWorkingDay,
          policyMaxDays: policyMaxDays ?? 15,
        }),
        error: null,
      };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : 'Could not build a schedule' };
    }
  }, [
    totalPaise,
    days,
    roundingPaise,
    startDate,
    distribution,
    cashKind,
    cashCap,
    startOnNextWorkingDay,
    calendar,
    policyMaxDays,
  ]);
}

const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 };

export function SchedulePreview({
  input,
  compact = false,
  title = 'Payout schedule',
}: {
  input: SchedulePreviewInput;
  compact?: boolean;
  title?: string;
}) {
  const { result, error } = useSchedule(input);

  if (error) {
    return (
      <Glass className="p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger-500)]" />
          <div>
            <p className="text-[0.875rem] font-semibold">This schedule cannot be built</p>
            <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">{error}</p>
          </div>
        </div>
      </Glass>
    );
  }

  if (!result) {
    return (
      <Glass className="flex min-h-[18rem] flex-col items-center justify-center p-8 text-center">
        <CalendarDays className="mb-3 h-8 w-8 text-[var(--faint-fg)]" />
        <p className="text-[0.9375rem] font-medium">The day-by-day plan appears here</p>
        <p className="mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
          Enter a maturity amount and the number of days. Every rupee is allocated the moment you
          type — nothing is estimated.
        </p>
      </Glass>
    );
  }

  const spread = result.largestDailyPaise - result.smallestDailyPaise;
  const criticalWarnings = result.warnings.filter((w) => w.severity !== 'INFO');

  return (
    <div className="space-y-4">
      {/* Headline */}
      <Glass className="overflow-hidden">
        <div className="border-b px-5 py-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[var(--faint-fg)]">
            {title}
          </p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <AnimatePresence mode="popLayout">
              <motion.span
                key={String(result.typicalDailyPaise)}
                initial={{ opacity: 0, y: 8, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
                transition={spring}
                className="text-[1.875rem] font-semibold leading-none tracking-[-0.02em] tabular-nums"
              >
                {formatPaise(result.typicalDailyPaise, { decimals: false })}
              </motion.span>
            </AnimatePresence>
            <span className="text-[0.9375rem] text-[var(--muted-fg)]">per day</span>
            <span className="text-[var(--faint-fg)]">·</span>
            <span className="text-[0.9375rem] text-[var(--muted-fg)]">
              {result.effectiveDays} working day{result.effectiveDays === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
            {formatISODate(result.firstPayoutDate)} → <strong className="font-medium text-[var(--page-fg)]">{formatISODate(result.lastPayoutDate)}</strong>
            {result.calendarSpanDays !== result.effectiveDays && (
              <> · {result.calendarSpanDays} calendar days after weekly-offs and holidays</>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 divide-x sm:grid-cols-4">
          <Cell label="Total" value={<Money paise={result.totalPaise} compact />} />
          <Cell
            label="Final day"
            value={<Money paise={result.finalInstallmentPaise} compact />}
            hint="carries any remainder"
          />
          <Cell
            label="Cash"
            value={<Money paise={result.totalCashPaise} compact tone="money" />}
          />
          <Cell
            label="Online"
            value={<Money paise={result.totalOnlinePaise} compact />}
          />
        </div>
      </Glass>

      {/* Warnings */}
      <AnimatePresence initial={false}>
        {criticalWarnings.map((w) => (
          <motion.div
            key={w.code}
            layout
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <div
              className={cn(
                'flex gap-3 rounded-[15px] border px-4 py-3',
                w.severity === 'CRITICAL'
                  ? 'border-[color-mix(in_oklab,var(--color-danger-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-danger-500)_10%,transparent)]'
                  : 'border-[color-mix(in_oklab,var(--color-warn-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-500)_11%,transparent)]',
              )}
            >
              <AlertTriangle
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0',
                  w.severity === 'CRITICAL' ? 'text-[var(--color-danger-500)]' : 'text-[var(--color-warn-500)]',
                )}
              />
              <p className="text-[0.8125rem] leading-relaxed">{w.message}</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Day by day */}
      <Glass className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <p className="text-[0.8125rem] font-semibold">Day by day</p>
          <div className="flex items-center gap-2">
            {spread > 0n && (
              <Badge tone="neutral">±{formatPaise(spread, { decimals: false })} spread</Badge>
            )}
            <Badge tone="brand">{result.effectiveDays} payouts</Badge>
          </div>
        </div>

        <div className={cn('overflow-auto', compact ? 'max-h-[18rem]' : 'max-h-[26rem]')}>
          <table className="w-full min-w-[24rem] text-[0.8125rem]">
            <thead className="mf-sticky-surface sticky top-0 z-10">
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                  Day
                </th>
                <th className="px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                  Date
                </th>
                <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                  Amount
                </th>
                <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                  Cash
                </th>
                <th className="px-3 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                  Online
                </th>
              </tr>
            </thead>
            <tbody>
              {result.installments.map((i, idx) => (
                <motion.tr
                  key={i.seq}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(idx * 0.012, 0.3), duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    'border-b border-[var(--hairline)] tabular-nums last:border-0',
                    i.isFinal && 'bg-[color-mix(in_oklab,var(--color-brand-500)_7%,transparent)]',
                  )}
                >
                  <td className="px-3 py-2 text-[var(--muted-fg)]">{i.seq}</td>
                  <td className="px-2 py-2">
                    <span className="font-medium">{formatISODateShort(i.dueDate)}</span>{' '}
                    <span className="text-[0.75rem] text-[var(--faint-fg)]">{weekdayShort(i.dueDate)}</span>
                    {i.isFinal && (
                      <span className="ml-2 text-[0.6875rem] font-semibold text-[var(--color-brand-500)]">
                        FINAL
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold">
                    {formatPaise(i.amountPaise, { decimals: i.amountPaise % 100n !== 0n })}
                  </td>
                  <td className="px-2 py-2 text-right text-[var(--muted-fg)]">
                    {i.cashLegPaise > 0n ? formatPaise(i.cashLegPaise, { decimals: false }) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--muted-fg)]">
                    {i.onlineLegPaise > 0n ? formatPaise(i.onlineLegPaise, { decimals: false }) : '—'}
                  </td>
                </motion.tr>
              ))}
            </tbody>
            <tfoot className="mf-sticky-surface sticky bottom-0 z-10">
              <tr className="border-t-2 border-[var(--hairline)] font-semibold tabular-nums">
                <td className="px-3 py-2.5" colSpan={2}>
                  Total
                </td>
                <td className="px-2 py-2.5 text-right">{formatPaise(result.totalPaise, { decimals: false })}</td>
                <td className="px-2 py-2.5 text-right text-[var(--color-money-600)] dark:text-[var(--color-money-400)]">
                  {formatPaise(result.totalCashPaise, { decimals: false })}
                </td>
                <td className="px-3 py-2.5 text-right text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]">
                  {formatPaise(result.totalOnlinePaise, { decimals: false })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-2.5 text-[0.75rem] text-[var(--faint-fg)]">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Every instalment is a whole multiple of{' '}
          {formatPaise(result.roundingPaise, { decimals: false })}; the remainder lands on the final
          day. The rows above sum to exactly {formatPaise(result.totalPaise)}.
        </div>
      </Glass>

      {/* Mode legend */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[0.75rem] text-[var(--faint-fg)]">
        <span className="flex items-center gap-1.5">
          <Banknote className="h-3.5 w-3.5 text-[var(--color-money-500)]" />
          Cash from the counter
        </span>
        <span className="flex items-center gap-1.5">
          <Send className="h-3.5 w-3.5 text-[var(--color-brand-500)]" />
          Online transfer to the customer's account
        </span>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">{label}</p>
      <p className="mt-1 text-[0.9375rem] font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[0.6875rem] text-[var(--faint-fg)]">{hint}</p>}
    </div>
  );
}
