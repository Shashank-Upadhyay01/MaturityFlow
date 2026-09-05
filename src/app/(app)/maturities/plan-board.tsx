'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, CheckCheck, ChevronRight, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { applyPlanAction } from '@/actions/cases';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { formatPaise } from '@/lib/money';
import {
  buildPlanRow,
  defaultPartsFor,
  summariseBand,
  summariseDailyRequirements,
  summariseToday,
  type DayState,
  type PlanBand,
  type PlanCase,
  type PlanInstalment,
  type PlanRow,
} from '@/lib/plan-view';
import { cn } from '@/lib/utils';
import { formatDMY, makeCalendar, weekdayShort, type SaturdayRule } from '@/lib/working-days';

export interface CalendarSnapshot {
  holidays: string[];
  sundaysOff: boolean;
  saturdayRule: SaturdayRule;
}

const inr = (v: bigint) => formatPaise(v, { decimals: false });

/** How each day of a schedule is painted. Paid is settled fact; today is the one that matters now. */
const DAY_STYLE: Record<DayState, string> = {
  PAID: 'bg-[color-mix(in_oklab,var(--color-money-500)_14%,transparent)] text-[var(--color-money-700)] dark:text-[var(--color-money-400)]',
  PARTIAL:
    'bg-[color-mix(in_oklab,var(--color-warn-500)_16%,transparent)] text-[var(--color-warn-600)] dark:text-[var(--color-warn-400)]',
  DUE_TODAY:
    'bg-[color-mix(in_oklab,var(--color-brand-500)_18%,transparent)] font-semibold text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)] ring-1 ring-inset ring-[color-mix(in_oklab,var(--color-brand-500)_45%,transparent)]',
  OVERDUE:
    'bg-[color-mix(in_oklab,var(--color-danger-500)_14%,transparent)] text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]',
  UPCOMING: '',
};

const DAY_LABEL: Record<DayState, string> = {
  PAID: 'given',
  PARTIAL: 'part given',
  DUE_TODAY: 'today',
  OVERDUE: 'missed',
  UPCOMING: '',
};

/** The day-by-day plan for one customer. */
function DayTable({ row }: { row: PlanRow }) {
  if (row.error) {
    return (
      <p className="px-3 py-2 text-[0.72rem] text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]">
        {row.error}
      </p>
    );
  }
  return (
    <div className="px-2 pb-2">
      <table className="w-full border-collapse text-[0.68rem]">
        <thead>
          <tr className="text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">
            <th className="py-1 pr-1 text-left font-medium">#</th>
            <th className="py-1 pr-1 text-left font-medium">Date</th>
            <th className="py-1 pr-1 text-right font-medium">Amount</th>
            <th className="py-1 text-left font-medium" />
          </tr>
        </thead>
        <tbody>
          {row.days.map((d) => (
            <tr key={d.seq} className={cn('border-t border-[var(--hairline)]', DAY_STYLE[d.state])}>
              <td className="py-1 pr-1 tabular-nums">{d.seq}</td>
              <td className="py-1 pr-1 whitespace-nowrap tabular-nums">
                {formatDMY(d.dueOn)}{' '}
                <span className="text-[0.6rem] opacity-70">{weekdayShort(d.dueOn)}</span>
              </td>
              <td className="py-1 pr-1 text-right tabular-nums">{inr(d.amountPaise)}</td>
              <td className="py-1 text-[0.6rem] uppercase tracking-wide">{DAY_LABEL[d.state]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--hairline)] font-semibold">
            <td className="py-1 pr-1" colSpan={2}>
              {row.days.length} part{row.days.length === 1 ? '' : 's'}
            </td>
            <td className="py-1 pr-1 text-right tabular-nums">
              {inr(row.days.reduce((a, d) => a + d.amountPaise, 0n))}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
      <p className="px-1 pt-1.5 text-[0.62rem] text-[var(--faint-fg)]">
        {row.isProjection
          ? row.approvedOn
            ? 'Projected — this is what the plan would become, not what was promised.'
            : 'Projected from today. Real dates are set when the case is approved.'
          : `Approved ${row.approvedOn ? formatDMY(row.approvedOn) : ''}${
              row.deadlineOn ? ` · due by ${formatDMY(row.deadlineOn)}` : ''
            }`}
      </p>
    </div>
  );
}

/** One customer in a band column. */
function CustomerRow({
  row,
  parts,
  onParts,
  open,
  onToggle,
}: {
  row: PlanRow;
  parts: number | '';
  onParts: (v: number | '') => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[var(--hairline)] last:border-0">
      <div className="px-2.5 py-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-start gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)] transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8rem] font-medium">{row.customerName}</span>
            <span className="block truncate text-[0.65rem] text-[var(--faint-fg)]">
              {row.accountNumber ?? row.caseNumber} · {row.agentName}
            </span>
          </span>
          {row.dueTodayPaise > 0n && <Badge tone="brand">today {inr(row.dueTodayPaise)}</Badge>}
        </button>

        <div className="mt-1.5 grid grid-cols-3 gap-1 pl-5 text-[0.68rem] tabular-nums">
          <span>
            <span className="block text-[0.6rem] uppercase tracking-wide text-[var(--faint-fg)]">
              Maturity
            </span>
            {inr(row.maturityPaise)}
          </span>
          <span>
            <span className="block text-[0.6rem] uppercase tracking-wide text-[var(--faint-fg)]">
              Given
            </span>
            <span className="text-[var(--color-money-700)] dark:text-[var(--color-money-400)]">
              {inr(row.givenPaise)}
            </span>
          </span>
          <span>
            <span className="block text-[0.6rem] uppercase tracking-wide text-[var(--faint-fg)]">
              Remaining
            </span>
            <span className="font-semibold">{inr(row.remainingPaise)}</span>
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5">
          <span className="text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">
            Recommended today
          </span>
          <span className="text-[0.78rem] font-semibold tabular-nums text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]">
            {inr(row.perDayPaise)}
          </span>
          <span className="text-[0.62rem] text-[var(--faint-fg)]">scheduled across</span>
          <input
            inputMode="numeric"
            aria-label={`Parts for ${row.customerName}`}
            value={parts}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              onParts(raw === '' ? '' : Number(raw));
            }}
            className="h-5 w-10 rounded-[5px] border border-[var(--input-border)] bg-[var(--input-bg)] px-1 text-center text-[0.7rem] tabular-nums"
          />
          <span className="text-[0.62rem] text-[var(--faint-fg)]">
            {row.cadence === 'ALTERNATE' ? 'alternate days' : 'days'}
          </span>
          {row.isProjection && <Badge tone="neutral">projected</Badge>}
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-1 pl-5" aria-label={`Payout comparisons for ${row.customerName}`}>
          {[12, 6, 3].map((count) => {
            const amount = row.remainingPaise > 0n
              ? (row.remainingPaise + BigInt(count) - 1n) / BigInt(count)
              : 0n;
            return (
              <span key={count} className="rounded-[6px] border border-[var(--hairline)] bg-[var(--glass-bg-subtle)] px-1.5 py-1 text-center">
                <span className="block text-[0.56rem] font-semibold uppercase tracking-wide text-[var(--faint-fg)]">{count} parts</span>
                <span className="block truncate text-[0.66rem] font-semibold tabular-nums" title="Approximate amount; the final part carries any exact remainder">
                  ≈ {inr(amount)}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden bg-[var(--glass-bg-subtle)]"
          >
            <DayTable row={row} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Statuses whose schedule can still be rewritten. A cancelled or completed case has nothing left
 * to re-plan, and the server would refuse it anyway - this is only so the button's count matches
 * what will actually happen.
 */
const REPLANNABLE = new Set(['APPROVED', 'IN_PROGRESS', 'ON_HOLD']);

export function PlanBoard({
  cases,
  instalments,
  calendars,
  today,
  canReplan = false,
  onApplied,
}: {
  cases: PlanCase[];
  instalments: PlanInstalment[];
  calendars: Record<string, CalendarSnapshot>;
  today: string;
  canReplan?: boolean;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState<PlanBand | null>(null);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  /** Null means "show the committed schedule"; a typed value is an explicit what-if. */
  const [bandParts, setBandParts] = useState<Record<PlanBand, number | '' | null>>({
    LARGE: null,
    SMALL: null,
  });
  const [rowParts, setRowParts] = useState<Record<string, number | ''>>({});

  const calendarByBranch = useMemo(() => {
    const mapped = new Map<string, ReturnType<typeof makeCalendar>>();
    for (const [branchId, calendar] of Object.entries(calendars)) {
      mapped.set(
        branchId,
        makeCalendar(calendar.holidays, {
          sundaysOff: calendar.sundaysOff,
          saturdayRule: calendar.saturdayRule,
        }),
      );
    }
    return mapped;
  }, [calendars]);

  const rows = useMemo(
    () =>
      cases.map((c) => {
        const cal = calendarByBranch.get(c.branchId) ?? makeCalendar();
        const band = BigInt(c.maturityAmountPaise) >= 10_000_000n ? 'LARGE' : 'SMALL';
        const own = rowParts[c.caseId];
        const col = bandParts[band as PlanBand];
        // A blank box means "typing" — fall back rather than flashing an error mid-keystroke.
        const chosen = own === '' ? undefined : (own ?? (col === '' || col == null ? undefined : col));
        const fallback = defaultPartsFor(BigInt(c.maturityAmountPaise || '1'), c.windowDays);
        const parts = chosen ?? fallback;
        // Only pass a custom count when it actually differs, so an approved case keeps showing
        // its real, promised schedule instead of a projection of the same shape.
        const isDefault = parts === fallback;
        return buildPlanRow(c, instalments, cal, today, isDefault ? undefined : parts);
      }),
    [cases, instalments, calendarByBranch, today, rowParts, bandParts],
  );

  const visible = rows;

  /*
    What "apply" would actually change.

    A case counts only when the number of parts on screen differs from the number its committed
    window already produces. Re-planning a case to the schedule it is already on would rewrite its
    instalments and add an audit line saying nothing happened, so the untouched rows stay out of
    the batch and out of the count on the button.
  */
  const committedParts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cases) {
      m.set(c.caseId, defaultPartsFor(BigInt(c.maturityAmountPaise || '1'), c.windowDays));
    }
    return m;
  }, [cases]);

  const pendingIn = (candidates: PlanRow[]) =>
    candidates.filter(
      (r) =>
        !r.error &&
        r.remainingPaise > 0n &&
        REPLANNABLE.has(r.status) &&
        r.parts !== committedParts.get(r.caseId),
    );

  /*
    Applying one band at a time.

    The two columns hold different promises - a ₹1 lakh case is paid every working day, a smaller
    one on alternate days - and the office changes them for different reasons: a cash squeeze
    stretches the large cases, a quiet week tightens the small ones. A single button for both
    would have made every one of those a decision about the whole register, so each column commits
    its own what-if and leaves the other exactly as it was.
  */
  async function applyBand(band: PlanBand, title: string, candidates: PlanRow[]) {
    const pending = pendingIn(candidates);
    if (pending.length === 0 || applying) return;

    const names = pending
      .slice(0, 3)
      .map((r) => r.customerName)
      .join(', ');
    const rest = pending.length > 3 ? ` and ${pending.length - 3} more` : '';
    const paidAlready = pending.filter((r) => r.givenPaise > 0n).length;
    const ok = window.confirm(
      `Re-plan ${pending.length} case${pending.length === 1 ? '' : 's'} under "${title}" to the ` +
        `number of parts shown?\n\n${names}${rest}\n\n` +
        (paidAlready > 0
          ? `${paidAlready} of them already ${paidAlready === 1 ? 'has' : 'have'} money paid out. ` +
            'What is already given stays given; only the days still to come are re-spread.\n\n'
          : '') +
        'Cases in the other column are not touched. Every change is recorded against the case ' +
        'and can be re-planned again.',
    );
    if (!ok) return;

    setApplying(band);
    const res = await applyPlanAction(
      pending.map((r) => ({ caseId: r.caseId, parts: r.parts })),
      `Re-planned from the planning board (${title})`,
    );
    setApplying(null);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const { done, failed } = res.data;
    if (done > 0) {
      toast.success(`Re-planned ${done} case${done === 1 ? '' : 's'} — ${title}`, {
        description: failed.length ? `${failed.length} could not be changed` : undefined,
        duration: 7000,
      });
    }
    for (const f of failed.slice(0, 5)) toast.error(`${f.label}: ${f.error}`);
    if (failed.length > 5) toast.message(`${failed.length - 5} more could not be changed.`);
    onApplied?.();
  }

  // Today is computed from EVERY row, never the filtered view — it is the cash the branch must
  // open with, and it would be worse than useless if it moved when somebody searched a name.
  const todayCol = useMemo(() => summariseToday(rows), [rows]);
  const dailyRequirements = useMemo(() => summariseDailyRequirements(rows, today), [rows, today]);
  const large = useMemo(() => summariseBand('LARGE', visible), [visible]);
  const small = useMemo(() => summariseBand('SMALL', visible), [visible]);

  const partsFor = (r: PlanRow): number | '' => {
    const own = rowParts[r.caseId];
    if (own !== undefined) return own;
    const col = bandParts[r.band];
    return col === '' ? '' : (col ?? r.parts);
  };

  const bandColumn = (
    band: PlanBand,
    s: ReturnType<typeof summariseBand>,
    title: string,
    note: string,
    bandPending: PlanRow[],
  ) => (
    <Glass className="flex min-h-0 flex-col overflow-hidden">
      <div className="border-b px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[0.85rem] font-semibold">{title}</h2>
          <span className="text-[0.68rem] tabular-nums text-[var(--faint-fg)]">
            {s.count} case{s.count === 1 ? '' : 's'}
          </span>
        </div>
        <p className="mt-0.5 text-[0.65rem] text-[var(--faint-fg)]">{note}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] tabular-nums">
          <span>
            <span className="text-[var(--faint-fg)]">remaining </span>
            <strong>{inr(s.remainingPaise)}</strong>
          </span>
          <span>
            <span className="text-[var(--faint-fg)]">given </span>
            <span className="text-[var(--color-money-700)] dark:text-[var(--color-money-400)]">
              {inr(s.givenPaise)}
            </span>
          </span>
          {s.dueTodayPaise > 0n && (
            <span className="text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]">
              today <strong>{inr(s.dueTodayPaise)}</strong>
            </span>
          )}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[0.65rem] text-[var(--muted-fg)]">
          What-if: split every case here into
          <input
            inputMode="numeric"
            aria-label={`Default parts for ${title}`}
            value={bandParts[band] ?? (band === 'LARGE' ? 12 : 6)}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              setBandParts((p) => ({ ...p, [band]: raw === '' ? '' : Number(raw) }));
              setRowParts({}); // a new column default clears the per-row overrides it replaces
            }}
            className="h-5 w-11 rounded-[5px] border border-[var(--input-border)] bg-[var(--input-bg)] px-1 text-center tabular-nums"
          />
          parts
        </label>

        {/*
          This column is a simulator until this button. Shown only to somebody who may re-plan,
          and enabled only once the parts on screen differ from the schedules these cases are
          actually on, so it never invites a click that would do nothing. It commits this column
          alone — the other band keeps whatever it is showing.
        */}
        {canReplan && (
          <div className="mt-2">
            <Button
              variant="primary"
              size="sm"
              loading={applying === band}
              disabled={bandPending.length === 0 || (applying !== null && applying !== band)}
              onClick={() => void applyBand(band, title, s.rows)}
              title={
                bandPending.length === 0
                  ? 'Change the number of parts first — nothing in this column differs from the committed schedule'
                  : `Re-plan ${bandPending.length} case${bandPending.length === 1 ? '' : 's'} in this column to the parts shown`
              }
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {bandPending.length === 0
                ? 'Apply to this column'
                : `Apply to ${bandPending.length} case${bandPending.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {s.rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.72rem] text-[var(--muted-fg)]">
            Nothing here yet.
          </p>
        ) : (
          s.rows.map((r) => (
            <CustomerRow
              key={r.caseId}
              row={r}
              parts={partsFor(r)}
              onParts={(v) => setRowParts((p) => ({ ...p, [r.caseId]: v }))}
              open={Boolean(openRows[r.caseId])}
              onToggle={() => setOpenRows((s2) => ({ ...s2, [r.caseId]: !s2[r.caseId] }))}
            />
          ))
        )}
      </div>
    </Glass>
  );

  return (
    <div className="space-y-3">
      <Glass className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b px-3 py-2.5">
          <div>
            <div className="flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5 text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]" />
              <h2 className="text-[0.85rem] font-semibold">Daily withdrawal requirement</h2>
            </div>
            <p className="mt-0.5 text-[0.65rem] text-[var(--faint-fg)]">
              Total across every case · updates instantly when the number of parts changes
            </p>
          </div>
          <span className="text-[0.68rem] tabular-nums text-[var(--muted-fg)]">
            {dailyRequirements.length} payout day{dailyRequirements.length === 1 ? '' : 's'}
          </span>
        </div>

        {dailyRequirements.length === 0 ? (
          <p className="px-3 py-5 text-center text-[0.72rem] text-[var(--muted-fg)]">
            No upcoming withdrawals in the current plan.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex min-w-max divide-x divide-[var(--hairline)]">
              {dailyRequirements.map((day) => (
                <div key={day.dueOn} className="w-[11.5rem] shrink-0 px-3 py-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[0.7rem] font-semibold tabular-nums">
                      {day.dueOn === today ? 'Today' : formatDMY(day.dueOn)}
                    </span>
                    <span className="text-[0.6rem] uppercase tracking-wide text-[var(--faint-fg)]">
                      {weekdayShort(day.dueOn)}
                    </span>
                  </div>
                  <p className="mt-1 text-[1rem] font-semibold tabular-nums text-[var(--page-fg)]">
                    {inr(day.totalPaise)}
                  </p>
                  <p className="text-[0.6rem] uppercase tracking-wide text-[var(--faint-fg)]">
                    total withdrawal
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-[var(--hairline)] pt-1.5 text-[0.67rem] tabular-nums">
                    <span>
                      <span className="block text-[0.58rem] uppercase tracking-wide text-[var(--faint-fg)]">
                        Cash needed
                      </span>
                      <strong className="text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]">
                        {inr(day.cashPaise)}
                      </strong>
                    </span>
                    <span>
                      <span className="block text-[0.58rem] uppercase tracking-wide text-[var(--faint-fg)]">
                        Online
                      </span>
                      {inr(day.onlinePaise)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[0.6rem] text-[var(--faint-fg)]">
                    {day.count} customer{day.count === 1 ? '' : 's'}
                    {day.projectedPaise > 0n ? ' · includes projected' : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Glass>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.1fr)]">
        {/* ── 1. today ───────────────────────────────────────────────── */}
        <Glass className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]" />
              <h2 className="text-[0.85rem] font-semibold">Today&rsquo;s withdrawal</h2>
            </div>
            <p className="mt-1 text-[1.5rem] font-semibold leading-none tabular-nums">
              {inr(todayCol.totalPaise)}
            </p>
            <p className="mt-1 text-[0.65rem] text-[var(--faint-fg)]">
              {todayCol.count} customer{todayCol.count === 1 ? '' : 's'} · {formatDMY(today)}
            </p>
            {todayCol.projectedPaise > 0n && (
              <p className="mt-1 text-[0.65rem] text-[var(--muted-fg)]">
                <strong className="tabular-nums">{inr(todayCol.committedPaise)}</strong> approved ·{' '}
                <span className="tabular-nums">{inr(todayCol.projectedPaise)}</span> projected
              </p>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {todayCol.lines.length === 0 ? (
              <p className="px-3 py-6 text-center text-[0.72rem] text-[var(--muted-fg)]">
                <CalendarClock className="mx-auto mb-1 h-4 w-4 text-[var(--faint-fg)]" />
                Nothing falls due today.
              </p>
            ) : (
              todayCol.lines.map((l) => (
                <Link
                  key={l.caseId}
                  href={`/maturities/${l.caseId}`}
                  className="flex items-center gap-2 border-b border-[var(--hairline)] px-3 py-1.5 last:border-0 hover:bg-[var(--glass-bg-subtle)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.75rem] font-medium">
                      {l.customerName}
                    </span>
                    <span className="block truncate text-[0.62rem] text-[var(--faint-fg)]">
                      {l.accountNumber ?? ''} · {l.agentName}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.78rem] font-semibold tabular-nums">
                    {inr(l.amountPaise)}
                  </span>
                </Link>
              ))
            )}
          </div>
        </Glass>

        {/* ── 2 and 3. the two bands ─────────────────────────────────── */}
        {bandColumn(
          'LARGE',
          large,
          '₹1 lakh and above',
          'Paid every working day — 12 parts across the window by default.',
          pendingIn(large.rows),
        )}
        {bandColumn(
          'SMALL',
          small,
          'Below ₹1 lakh',
          'Paid on alternate working days — 6 parts across the same window.',
          pendingIn(small.rows),
        )}
      </div>
    </div>
  );
}
