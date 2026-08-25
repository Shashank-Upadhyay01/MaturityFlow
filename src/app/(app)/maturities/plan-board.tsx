'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, ChevronRight, Search, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Glass } from '@/components/ui/glass';
import { formatPaise } from '@/lib/money';
import {
  buildPlanRow,
  defaultPartsFor,
  summariseBand,
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
            Recommended
          </span>
          <span className="text-[0.78rem] font-semibold tabular-nums text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]">
            {inr(row.perDayPaise)}
          </span>
          <span className="text-[0.62rem] text-[var(--faint-fg)]">per day over</span>
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

export function PlanBoard({
  cases,
  instalments,
  calendar,
  today,
}: {
  cases: PlanCase[];
  instalments: PlanInstalment[];
  calendar: CalendarSnapshot;
  today: string;
}) {
  const [q, setQ] = useState('');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  /** Per-column default, and a per-customer override on top of it. '' means "typing". */
  const [bandParts, setBandParts] = useState<Record<PlanBand, number | ''>>({
    LARGE: 12,
    SMALL: 6,
  });
  const [rowParts, setRowParts] = useState<Record<string, number | ''>>({});

  const cal = useMemo(
    () =>
      makeCalendar(calendar.holidays, {
        sundaysOff: calendar.sundaysOff,
        saturdayRule: calendar.saturdayRule,
      }),
    [calendar],
  );

  const rows = useMemo(
    () =>
      cases.map((c) => {
        const band = BigInt(c.maturityAmountPaise) >= 10_000_000n ? 'LARGE' : 'SMALL';
        const own = rowParts[c.caseId];
        const col = bandParts[band as PlanBand];
        // A blank box means "typing" — fall back rather than flashing an error mid-keystroke.
        const chosen = own === '' ? undefined : (own ?? (col === '' ? undefined : col));
        const fallback = defaultPartsFor(BigInt(c.maturityAmountPaise || '1'), c.windowDays);
        const parts = chosen ?? fallback;
        // Only pass a custom count when it actually differs, so an approved case keeps showing
        // its real, promised schedule instead of a projection of the same shape.
        const isDefault = parts === fallback;
        return buildPlanRow(c, instalments, cal, today, isDefault ? undefined : parts);
      }),
    [cases, instalments, cal, today, rowParts, bandParts],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(needle) ||
        (r.accountNumber ?? '').toLowerCase().includes(needle) ||
        r.agentName.toLowerCase().includes(needle) ||
        r.caseNumber.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  // Today is computed from EVERY row, never the filtered view — it is the cash the branch must
  // open with, and it would be worse than useless if it moved when somebody searched a name.
  const todayCol = useMemo(() => summariseToday(rows), [rows]);
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
          Split every case here into
          <input
            inputMode="numeric"
            aria-label={`Default parts for ${title}`}
            value={bandParts[band]}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '');
              setBandParts((p) => ({ ...p, [band]: raw === '' ? '' : Number(raw) }));
              setRowParts({}); // a new column default clears the per-row overrides it replaces
            }}
            className="h-5 w-11 rounded-[5px] border border-[var(--input-border)] bg-[var(--input-bg)] px-1 text-center tabular-nums"
          />
          parts
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {s.rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.72rem] text-[var(--muted-fg)]">
            Nothing here{q.trim() ? ' matches that search' : ' yet'}.
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
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a customer, A/c no. or agent"
          aria-label="Search the plan"
          className="mf-input h-8 w-full max-w-sm !pl-8 text-[0.8rem]"
        />
      </div>

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
        )}
        {bandColumn(
          'SMALL',
          small,
          'Below ₹1 lakh',
          'Paid on alternate working days — 6 parts across the same window.',
        )}
      </div>
    </div>
  );
}
