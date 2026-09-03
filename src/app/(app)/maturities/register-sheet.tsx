'use client';

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Columns3,
  Download,
  FileSpreadsheet,
  Plus,
  Printer,
  Search,
  Trash2,
  Upload,
  UserCog,
  Wallet,
  X,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { saveRegisterLayoutAction } from '@/actions/admin';
import { setInstalmentAmountAction, setInstalmentLegsAction } from '@/actions/cases';
import { importRegisterAction } from '@/actions/import';
import {
  createRegisterRowWithFieldsAction,
  bulkAssignAgentAction,
  bulkSetFormSubmittedAction,
  bulkSetTodayAction,
  confirmCloseDayAction,
  confirmRegisterTakenAction,
  correctRegisterDayPaidAction,
  markNotTakenAction,
  removeRegisterRowsAction,
  reopenDayAction,
  requestCloseDayAction,
  saveDayCashAction,
  saveRegisterFieldsAction,
  settleRegisterRowAction,
} from '@/actions/register';
import { AdminDateCell } from '@/components/domain/admin-date-cell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { PRODUCT_NAME } from '@/lib/brand';
import { excelCellRaw } from '@/lib/excel-register';
import {
  BULK_TODAY_LABEL,
  DAY_STATE_LABEL,
  DATE_FIELD_LABEL,
  DATE_PRESETS,
  DATE_PRESET_LABEL,
  DATE_PRESET_SHORT,
  EMPTY_RANGE,
  SORT_LABEL,
  TAB_HINT,
  TAB_LABEL,
  activeDatePreset,
  autoSortFor,
  compareTodayFigures,
  dayStateOf,
  groupIndian,
  hasMissedPayment,
  leftoverOnPayoutDay,
  paidOnDate,
  unpaidPayoutDays,
  isDueToday,
  isOnTodaysList,
  isRangeActive,
  payoutOnDate,
  plannedOnDate,
  recommendedPerDay,
  resolveDatePreset,
  rowStateOf,
  rowInDateRange,
  summariseDueToday,
  summariseSelection,
  type BulkTodayMode,
  type DayState,
  type DateField,
  type DateRange,
  type RegisterTab,
  type PayoutDayView,
  type SortKey,
} from '@/lib/register-view';
import {
  columnsThatFit,
  visibleRegisterCols,
  REGISTER_GUTTER_REM,
  type RegisterColDef,
  type RegisterColId,
  type RegisterLayout,
  REGISTER_COL_DEFS,
} from '@/lib/register-layout';
import { formatPaise, tryParseRupeesToPaise } from '@/lib/money';
import { payoutPlanFor, windowDaysForPayoutCount } from '@/lib/payout-policy';
import { cn } from '@/lib/utils';
import { formatDMY } from '@/lib/working-days';
import type { Role } from '@/db/schema';
import { canOverrideDates } from '@/lib/rbac';
import { TakePaymentDialog } from './take-payment-dialog';

export interface RegisterRow {
  id: string;
  accountNumber: string | null;
  customerName: string;
  instrumentMaturityOn: string | null;
  formSubmittedOn: string;
  paymentOn: string | null;
  maturityPaise: string;
  paidPaise: string;
  remainingPaise: string;
  todayPaise: string;
  todayCashPaise: string;
  todayOnlinePaise: string;
  windowDays: number;
  agentName: string;
  agentId: string;
  status: string;
  formSubmitted: boolean;
  approved: boolean;
  /** The case has a live schedule. A fact, not a checkbox — see the Sched. column. */
  scheduled: boolean;

  // ── What the generated schedule says about this row ──────────────────────────
  /** The live instalment falling due today, or null when the schedule plans nothing for today. */
  todayInstalmentId: string | null;
  /** What that day is meant to pay, in paise. The recommendation, not a typed figure. */
  todayDuePaise: string;
  /** How much of it has actually gone out. */
  todayPaidTakenPaise: string;
  /** Transactions recorded on the selected working day. */
  paidTodayActualPaise: string;
  paidCashTodayPaise: string;
  paidOnlineTodayPaise: string;
  paidByDate?: Record<string, { cash: string; online: string }>;
  /** Its status, straight from the database: PENDING · PARTIAL · PAID · MISSED. */
  todayStatus: string | null;
  /** The legs the engine planned for today. */
  todayCashDuePaise: string;
  todayOnlineDuePaise: string;
  /** Earlier days still unpaid — the backlog behind this row. */
  overdueCount: number;
  /** What that backlog is worth, in paise. */
  overduePaise: string;
  payoutDays: PayoutDayView[];
}

function inr(p: bigint) {
  return formatPaise(p, { decimals: false, symbol: false });
}
function rupeesStr(p: bigint) {
  return (p / 100n).toString();
}

const th =
  'border border-[var(--hairline)] bg-[var(--surface-solid)] px-1 py-1.5 text-left text-[0.62rem] font-bold uppercase leading-tight tracking-[0.03em] text-[var(--muted-fg)]';
const td = 'border border-[var(--hairline)] p-0 align-middle';
const num = 'text-right tabular-nums';
const cell =
  'box-border h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-1 text-[0.7rem] leading-none text-[var(--page-fg)] outline-none focus:bg-[var(--input-bg)] focus:shadow-[inset_0_0_0_2px_var(--ring)] disabled:cursor-default disabled:opacity-60';

function SortTh({
  label,
  hint,
  col,
  sortKey,
  sortDir,
  onSort,
  right,
  className,
}: {
  label: string;
  /**
   * What this column is for, on hover.
   *
   * Headings on this sheet are abbreviated to four or five characters because fourteen of them
   * have to fit across a branch monitor, and an abbreviation only reads to whoever chose it.
   * The sort control keeps its own tooltip when there is nothing better to say.
   */
  hint?: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortKey) => void;
  right?: boolean;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={cn(th, right && num, className)} title={hint}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'inline-flex items-center gap-1 whitespace-normal leading-tight hover:text-[var(--page-fg)]',
          right && 'w-full justify-end',
          active && 'text-[var(--page-fg)]',
        )}
      >
        {label}
        <span className="text-[0.6rem] opacity-60" aria-hidden>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}

function CellInput({
  value,
  disabled,
  className,
  placeholder,
  title,
  group,
  rowKey,
  cellKey,
  ariaLabel,
  onChange,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
  /** Show Indian digit grouping while the cell is at rest. Editing always shows raw digits. */
  group?: boolean;
  rowKey: string;
  cellKey: string;
  ariaLabel?: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  // 1000000 and 10,00,000 in adjacent columns made the sheet hard to scan, but grouping a cell
  // that someone is typing into fights the caret. So: grouped at rest, raw the moment it has focus.
  const [focused, setFocused] = useState(false);
  return (
    <input
      className={cn(cell, className)}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      aria-label={ariaLabel ?? title ?? placeholder ?? 'Editable register cell'}
      data-register-cell="true"
      data-register-row={rowKey}
      data-register-column={cellKey}
      value={!focused && group ? groupIndian(value) : value}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onClick={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        const direction = e.key === 'Enter' ? 'ArrowDown' : e.key;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(direction)) return;

        // Arrow keys belong to the spreadsheet while a cell has focus. Even at an edge there is
        // nowhere for the page to scroll to and no reason to drop the cell selection.
        e.preventDefault();
        e.stopPropagation();

        const current = e.currentTarget;
        const table = current.closest('table');
        if (!table) return;
        const all = Array.from(
          table.querySelectorAll<HTMLInputElement>('input[data-register-cell="true"]:not(:disabled)'),
        );
        const vertical = direction === 'ArrowUp' || direction === 'ArrowDown';
        const peers = vertical
          ? all.filter((el) => el.dataset.registerColumn === cellKey)
          : all.filter((el) => el.dataset.registerRow === rowKey);
        const at = peers.indexOf(current);
        const delta = direction === 'ArrowUp' || direction === 'ArrowLeft' ? -1 : 1;
        const next = peers[at + delta];
        if (!next) return;
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        next.select();
      }}
    />
  );
}

/**
 * A checkbox with a third state: "some of these, not all".
 *
 * `indeterminate` is a DOM property, not an attribute, so React cannot set it from JSX — it has
 * to be written to the node. Without it a partly-ticked page reads as "nothing selected", and the
 * next click on the header silently clears a selection the clerk spent a minute building.
 */
function TriCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={className}
      aria-label={label}
      title={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** A popover anchored under its trigger. See the `.glass` trap in CLAUDE.md — wrapper positions. */
function Popover({
  open,
  label,
  width = 'w-64',
  children,
}: {
  open: boolean;
  label: string;
  width?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className={cn('absolute left-0 top-full z-40 mt-1.5', width)}>
      <div
        role="dialog"
        aria-label={label}
        className="rounded-[12px] border border-[var(--glass-border)] bg-[var(--page-bg)] p-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The tint a row carries, and the words that explain it.
 *
 * Green and red are the only meaningful colour on this sheet, so they are defined once, here,
 * and every row, legend and tab reads them from this table. `due` and `none` are deliberately
 * absent: an unanswered day is not a verdict, and a day the schedule skips is not a failure.
 */
const DAY_TINT: Partial<Record<DayState, string>> = {
  taken:
    'bg-[var(--row-taken)] shadow-[inset_3px_0_0_0_var(--row-taken-edge)] hover:bg-[var(--row-taken-strong)]',
  missed:
    'bg-[var(--row-missed)] shadow-[inset_3px_0_0_0_var(--row-missed-edge)] hover:bg-[var(--row-missed-strong)]',
  partial:
    'bg-[var(--row-partial)] shadow-[inset_3px_0_0_0_var(--row-partial-edge)] hover:bg-[var(--row-partial-strong)]',
};

/** The pill printed in the Today column once a day has been answered for. */
const DAY_PILL: Partial<Record<DayState, string>> = {
  taken: 'bg-[var(--row-taken-strong)] text-[var(--row-taken-fg)]',
  missed: 'bg-[var(--row-missed-strong)] text-[var(--row-missed-fg)]',
  partial: 'bg-[var(--row-partial-strong)] text-[var(--row-partial-fg)]',
};

/**
 * What the Today cell says about itself once the schedule owns it.
 *
 * The figure is not typed any more, and a cell that silently stops accepting input reads as
 * broken unless it says why. Each state also names where the number can still be changed, so
 * "I need to give them less today" has an answer that is not "type over it".
 */
const SCHEDULED_TODAY_HINT: Record<DayState, string> = {
  due: 'The schedule\u2019s figure for today. To change it, move the money on the Plan board \u2014 the other days absorb it.',
  taken: 'Paid in full today. Reverse it on the case page if that was wrong.',
  partial: 'Part of today has gone out. The figure shown is what is still owed today.',
  missed: 'Marked not paid. Still owed \u2014 it stays on the payout list.',
  none: 'The schedule plans nothing for today.',
};

/**
 * Taken / Not taken on a row.
 *
 * ✓ opens the payment list so the clerk can tick days and confirm an amount. ✗ records a
 * no-show without writing the money off. A recorded payout is corrected by Admin / CMD / CEO,
 * not by un-clicking Taken.
 */
function DayMark({
  state,
  instalmentId,
  hasUnpaid,
  disabled,
  busy,
  onPay,
  onNotTaken,
}: {
  state: DayState;
  instalmentId: string | null;
  hasUnpaid: boolean;
  disabled: boolean;
  busy: boolean;
  onPay: () => void;
  onNotTaken: (instalmentId: string, clear: boolean) => void;
}) {
  if (!hasUnpaid && state === 'taken') {
    return (
      <span
        className={cn(
          'inline-flex h-6 w-full items-center justify-center gap-1 whitespace-nowrap rounded-[6px] text-[0.65rem] font-medium',
          DAY_PILL.taken,
        )}
        title={`${DAY_STATE_LABEL.taken} — Admin / CMD / CEO can correct a mistaken amount`}
      >
        <Check className="h-3 w-3" />
        Paid
      </span>
    );
  }

  if (!hasUnpaid && (state === 'none' || !instalmentId)) {
    return (
      <span className="text-[0.65rem] text-[var(--faint-fg)]" title={DAY_STATE_LABEL.none}>
        &mdash;
      </span>
    );
  }

  return (
    <div className="relative flex items-center gap-0.5">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={onPay}
        title="Opens this customer’s payment list — tick days and confirm what was given"
        aria-label="Record payment"
        className="inline-flex h-6 flex-1 items-center justify-center rounded-[6px] bg-[var(--row-taken)] text-[var(--row-taken-fg)] transition-colors hover:bg-[var(--row-taken-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      {instalmentId && state !== 'taken' && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => onNotTaken(instalmentId, false)}
          title="Not paid — the customer did not collect today. The amount remains owed."
          aria-label="Mark today's scheduled payment as not paid"
          className="inline-flex h-6 flex-1 items-center justify-center rounded-[6px] bg-[var(--row-missed)] text-[var(--row-missed-fg)] transition-colors hover:bg-[var(--row-missed-strong)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

type Tab = RegisterTab;

type ExtraMode = 'today' | 'all';

/** Which bulk popover is open, if any. */
type BulkMenu = 'today' | 'agent' | 'remove' | null;

/** Mirrors MAX_BLANK_ROWS_PER_CALL in register-service. The server enforces the real limit. */
const MAX_ADD_ROWS = 100;

/**
 * How many rows the sheet shows when nobody has asked for more.
 *
 * Counting the rows that already exist: with 80 real rows a clerk gets 20 empty ones to type
 * into, not 100 on top. They cost nothing — an empty row lives in the browser until somebody
 * types in it, and only then becomes a case.
 */
const DEFAULT_SHEET_LENGTH = 100;

/**
 * One of the sheet's empty rows.
 *
 * It holds its own drafts and writes nothing until the clerk leaves the row — tabbing between
 * cells inside it must not create a case after the first field, or the row would be replaced by
 * a real one mid-sentence and the focus would jump out from under them. Leaving the row with
 * anything typed creates the case and applies every field at once.
 *
 * `onCommitted` refreshes the sheet; the new row then arrives as a normal row from the server.
 */
function BlankRow({
  cols,
  extrasCol,
  disabled,
  onCommit,
}: {
  cols: RegisterColDef[];
  extrasCol: boolean;
  disabled: boolean;
  onCommit: (patch: Record<string, string>) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rowKey = useId();

  const commit = async () => {
    const patch: Record<string, string> = {};
    for (const [id, v] of Object.entries(vals)) {
      const field = COL_PATCH_FIELD[id as RegisterColId];
      if (field && v.trim()) patch[field] = v.trim();
    }
    if (!Object.keys(patch).length) return;
    setSaving(true);
    await onCommit(patch);
    setVals({});
    setSaving(false);
  };

  return (
    <tr
      data-register-row={rowKey}
      className="border-b border-[var(--hairline)] hover:bg-[var(--glass-bg-subtle)]"
      onBlur={(e) => {
        // Only when focus actually leaves this row — not when it moves to the next cell in it.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        void commit();
      }}
    >
      <td className={cn(td, 'print:hidden')} />
      {cols.map((c) => {
        const typed = COL_PATCH_FIELD[c.id] != null;
        return (
          <td key={c.id} className={cn(td, c.right && num)}>
            {typed && !disabled ? (
              <CellInput
                rowKey={rowKey}
                cellKey={c.id}
                ariaLabel={`${c.label} for new register row`}
                value={vals[c.id] ?? ''}
                onChange={(v) => setVals((p) => ({ ...p, [c.id]: v }))}
                // The row commits on the way out; a per-cell commit would create the case
                // after the first field and yank the row out from under the caret.
                onCommit={() => {}}
                disabled={saving}
                className={c.right ? num : undefined}
                title={`${c.label} — new row`}
              />
            ) : null}
          </td>
        );
      })}
      <td className={cn(td, 'print:hidden')} />
      <td className={cn(td, 'print:hidden')} />
      {extrasCol && <td className={cn(td, 'print:hidden')} />}
    </tr>
  );
}

/** Which patch field a typed column writes into. Columns absent here are derived, not typed. */
const COL_PATCH_FIELD: Partial<Record<RegisterColId, string>> = {
  account: 'accountNumber',
  customer: 'customerName',
  agent: 'agentName',
  maturityDate: 'instrumentMaturityOn',
  formDate: 'formSubmittedOn',
  paymentDate: 'paymentOn',
  amount: 'maturityRupees',
  paid: 'paidRupees',
  days: 'windowDays',
  today: 'todayRupees',
  cash: 'todayCashRupees',
  online: 'todayOnlineRupees',
};

/** Mirrors MAX_BULK_ROWS in register-bulk. The server enforces the real limit. */
const MAX_BULK = 500;

/** A thin vertical rule between groups of controls or figures. */
function Div({ className }: { className?: string }) {
  return <span className={cn('h-6 w-px shrink-0 bg-[var(--hairline)]', className)} aria-hidden />;
}

/**
 * One figure on the desk rail.
 *
 * `tone` is the whole highlighting vocabulary: money that has gone out is green, a shortfall is
 * amber, everything else is plain. A shortfall of zero is deliberately passed as 'plain' by the
 * caller — an amber ₹0 every morning teaches the clerk to stop seeing amber.
 */
/**
 * One column of the desk: a heading and a short list of figures under it.
 *
 * The desk used to be a flex row of loose stats with `justify-end` groups, which balanced the
 * ends and left a hole in the middle — ~430px of nothing on the cash line at 1366. Columns of a
 * shared grid have no middle to leave empty: each one takes a defined share of the width, and
 * the label/value rows inside justify to both of its edges.
 */
function DeskZone({
  title,
  extra,
  children,
  className,
  tinted,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tinted?: boolean;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[10px] px-2.5 py-1.5',
        tinted && 'bg-[var(--color-brand-50)]',
        className,
      )}
    >
      <div className="mb-1 flex h-4 items-center justify-between gap-2">
        <span
          className={cn(
            'truncate text-[0.6rem] font-semibold uppercase tracking-[0.07em]',
            tinted ? 'text-[var(--color-brand-700)]' : 'text-[var(--faint-fg)]',
          )}
        >
          {title}
        </span>
        {extra}
      </div>
      {/*
        Capped so a wide monitor does not strand a label at one end of the column and its figure
        at the other — past about this width the pair stops reading as one line.
      */}
      <div className="max-w-[17rem] space-y-[3px]">{children}</div>
    </div>
  );
}

/**
 * A label on the left, its figure on the right, justified to the column's full width so the
 * numbers form a straight edge you can read down.
 */
function DeskRow({
  label,
  value,
  tone = 'plain',
  title,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'plain' | 'money' | 'warn';
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={title}>
      <span className="truncate text-[0.7rem] leading-tight text-[var(--muted-fg)]">{label}</span>
      <span
        className={cn(
          'shrink-0 text-[0.8125rem] font-semibold leading-tight tabular-nums',
          tone === 'money' && 'text-[var(--color-money-500)]',
          tone === 'warn' && 'text-[var(--color-warn-600)]',
          tone === 'plain' && 'text-[var(--page-fg)]',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A `DeskRow` whose figure the clerk types. Same shape, so the column edge stays straight. */
function DeskInputRow({
  label,
  value,
  onChange,
  onCommit,
  disabled,
  title,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2" title={title}>
      <span className="truncate text-[0.7rem] leading-tight text-[var(--muted-fg)]">{label}</span>
      <span className="flex w-[6.25rem] shrink-0 items-center gap-1 rounded-[7px] border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 focus-within:border-[color-mix(in_oklab,var(--ring)_55%,transparent)]">
        <span className="text-[0.7rem] leading-none text-[var(--faint-fg)]">₹</span>
        <input
          value={value}
          disabled={disabled}
          inputMode="numeric"
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          className="h-5 w-full min-w-0 bg-transparent text-right text-[0.8125rem] font-semibold leading-none tabular-nums outline-none disabled:cursor-not-allowed disabled:opacity-55"
        />
      </span>
    </label>
  );
}

/**
 * Report a bulk outcome once, in one toast.
 *
 * A partial result is the normal case, not the exception — "38 rows removed, 2 could not be" is
 * the honest summary, and naming the first couple of failures saves the clerk hunting for them.
 */
function reportBulk(
  result: { ok: true; data: { done: number; failed: { label: string; error: string }[] } } | { ok: false; error: string },
  verb: string,
) {
  if (!result.ok) {
    toast.error(result.error);
    return false;
  }
  const { done, failed } = result.data;
  if (failed.length === 0) {
    toast.success(`${done} ${done === 1 ? 'row' : 'rows'} ${verb}`);
    return true;
  }
  const named = failed.slice(0, 3).map((f) => `${f.label} — ${f.error}`).join('\n');
  const more = failed.length > 3 ? `\n…and ${failed.length - 3} more` : '';
  if (done === 0) {
    toast.error(`Nothing was ${verb}`, { description: `${named}${more}`, duration: 9000 });
    return false;
  }
  toast.warning(`${done} ${done === 1 ? 'row' : 'rows'} ${verb}, ${failed.length} could not be`, {
    description: `${named}${more}`,
    duration: 9000,
  });
  return true;
}


export function RegisterSheet(props: {
  role: Role;
  branchLabel: string;
  branchId: string;
  /** HQ compiled bank — every branch together, read-only. */
  compiledView?: boolean;
  branchSwitch?: {
    path: string;
    allowAll?: boolean;
    branches: { id: string; code: string; name: string }[];
  };
  today: string;
  dayStatus: string;
  cashLimitPaise: string;
  cashInHandPaise: string;
  plannedOnlinePaise: string;
  withdrawalsToday: number;
  paidTodayPaise: string;
  canEdit: boolean;
  canSchedule: boolean;
  canPay: boolean;
  /** Admin / CMD / CEO may correct a recorded payout. Cashiers type, then confirm Taken. */
  canCorrectPay?: boolean;
  canSubmit: boolean;
  canImport: boolean;
  canCreate: boolean;
  canSetCash: boolean;
  canRequestClose: boolean;
  canConfirmClose: boolean;
  canLayout: boolean;
  /** May remove rows from the register — `case.cancel`, checked again per row on the server. */
  canRemove: boolean;
  columnLayout: RegisterLayout;
  agents: { id: string; name: string }[];
  rows: RegisterRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  /*
    Whoever records payouts opens on the work: who is expected at the counter today. Everybody
    else opens on the live book. Nothing keys off approval any more — there is no approval.
  */
  // Do not open on an empty operational view while live scheduled cases exist. Before the first
  // payout date that made a successful import look like it had vanished from the Register.
  const initialTab: Tab = props.canPay && props.rows.some(isDueToday) ? 'due' : 'all';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [extraMode, setExtraMode] = useState<ExtraMode>('today');
  const [agentId, setAgentId] = useState('');
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [dateField, setDateField] = useState<DateField>('payment');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  /** Anchor for shift-click range ticking. Holds the last row the user clicked directly. */
  const anchorRef = useRef<string | null>(null);
  const [bulkMenu, setBulkMenu] = useState<BulkMenu>(null);
  const [bulkAmount, setBulkAmount] = useState('');
  const [bulkAgent, setBulkAgent] = useState('');
  const [removeReason, setRemoveReason] = useState('');
  /** Set for the instant the browser's print dialog is being prepared. */
  const [printScope, setPrintScope] = useState<'view' | 'selection' | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cashHand, setCashHand] = useState(rupeesStr(BigInt(props.cashInHandPaise)));
  const [onlinePlan, setOnlinePlan] = useState(rupeesStr(BigInt(props.plannedOnlinePaise)));
  const [draft, setDraft] = useState<Record<string, Partial<Record<string, string>>>>({});
  const restoreFocusRef = useRef<{ row: string; column: string } | null>(null);
  const initialSort = autoSortFor(initialTab, '', 'payment');
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort.dir);
  const [colsOpen, setColsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addCount, setAddCount] = useState('5');
  const [draftLayout, setDraftLayout] = useState<RegisterLayout>(props.columnLayout);
  const visCols = visibleRegisterCols(props.columnLayout);

  useEffect(() => {
    const target = restoreFocusRef.current;
    if (!target) return;
    restoreFocusRef.current = null;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `input[data-register-row="${CSS.escape(target.row)}"][data-register-column="${CSS.escape(target.column)}"]`,
      );
      el?.focus({ preventScroll: true });
      el?.select();
    });
  }, [props.rows]);

  /**
   * How long the sheet should be, counting the rows that already exist.
   *
   * A register with 80 real rows shows 20 empty ones after them; "Add rows" raises this number
   * and the empty block grows immediately, because an empty row costs nothing until it is typed
   * in. Rows already in the database never come out of the count — 100 means a hundred-row sheet,
   * not a hundred blanks on top of what is there.
   */
  const [sheetLength, setSheetLength] = useState(DEFAULT_SHEET_LENGTH);

  /** Rows whose off-screen columns are expanded. */
  const [openExtras, setOpenExtras] = useState<Record<string, boolean>>({});

  /**
   * Width available to the table, measured rather than guessed.
   *
   * Starts at 0, which yields the required columns only. That is the correct first paint on a
   * narrow screen; on a wide one the observer corrects it before the browser paints.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    ro.observe(el);
    setGridWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  /**
   * The columns this screen can actually hold, and the ones that moved into the row expander.
   *
   * Deciding this here rather than in CSS is what removes the sideways scrollbar: a clerk who
   * scrolls right to read the cash figure loses the customer's name off the left edge, which is
   * exactly the moment a payout goes onto the wrong account.
   */
  /**
   * Everything in the row that is not a data column: the select box and two ticks
   * (REGISTER_GUTTER_REM), the Given column when this role records payouts, and the overflow
   * expander. The expander is reserved unconditionally — whether it exists depends on the
   * answer, so budgeting for it is the only way out of the circle, and the cost when nothing
   * overflows is a little slack.
   */
  const reservedRem = REGISTER_GUTTER_REM + 8 + 2.5;
  const fit = useMemo(
    () => columnsThatFit(visCols, gridWidth, reservedRem),
    [visCols, gridWidth, reservedRem],
  );
  const shownCols = printScope ? visCols : fit.shown;
  const hasExtras = !printScope && fit.dropped.length > 0;


  const closed = props.dayStatus === 'CLOSED';
  const closeRequested = props.dayStatus === 'CLOSE_REQUESTED';

  /** Read a cell's uncommitted draft value, falling back to what the server sent. */
  const d = useCallback(
    (id: string, key: string, fallback: string) => draft[id]?.[key] ?? fallback,
    [draft],
  );

  /** Change a filter and re-apply the sort that filter implies. */
  function applyFilter(next: { tab?: Tab; range?: DateRange; dateField?: DateField }) {
    const t = next.tab ?? tab;
    const r = next.range ?? range;
    const df = next.dateField ?? dateField;
    if (next.tab !== undefined) setTab(next.tab);
    if (next.range !== undefined) setRange(next.range);
    if (next.dateField !== undefined) setDateField(next.dateField);
    // autoSortFor only asks "is a day filter on?" — any bound answers that.
    const s = autoSortFor(t, r.from || r.to, df);
    setSortKey(s.key);
    setSortDir(s.dir);
  }

  const preset = activeDatePreset(range, props.today);
  const dateFilterOn = isRangeActive(range);
  /** An exact payout-day filter changes the sheet's amount columns to that day. */
  const selectedPayoutDate =
    dateField === 'payout' && range.from && range.from === range.to ? range.from : null;
  const viewDay = selectedPayoutDate ?? props.today;

  function toggleSort(col: SortKey) {
    if (sortKey === col) setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(col);
      setSortDir(col === 'amount' || col === 'paid' || col === 'remaining' || col === 'today' ? 'desc' : 'asc');
    }
  }

  /**
   * The sort, lifted out of the filter so the ticked rows can be ordered the same way.
   *
   * Printing a selection has to show it in the order the clerk was reading it, and re-deriving
   * that from the filtered list would silently drop any ticked row the current filter hides.
   */
  const sortRows = useCallback(
    (list: readonly RegisterRow[]) => {
      const dir = sortDir === 'asc' ? 1 : -1;
    const asBig = (v: string) => {
      try {
        return BigInt(v);
      } catch {
        return 0n;
      }
    };
    const cmpStr = (a: string, b: string) => a.localeCompare(b, 'en-IN', { numeric: true, sensitivity: 'base' });
    const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
    const perDay = (r: RegisterRow) =>
      recommendedPerDay(
        asBig(r.remainingPaise),
        asBig(r.maturityPaise),
        Number(d(r.id, 'windowDays', String(r.windowDays))) || r.windowDays,
      );

    return [...list].sort((a, b) => {
      let c = 0;
      switch (sortKey) {
        case 'formTick':
          c = Number(a.formSubmitted) - Number(b.formSubmitted);
          break;
        case 'approved':
          c = Number(a.scheduled) - Number(b.scheduled);
          break;
        case 'account':
          c = cmpStr(a.accountNumber ?? '', b.accountNumber ?? '');
          break;
        case 'customer':
          c = cmpStr(a.customerName, b.customerName);
          break;
        case 'maturityDate':
          c = cmpStr(a.instrumentMaturityOn ?? '', b.instrumentMaturityOn ?? '');
          break;
        case 'formDate':
          c = cmpStr(a.formSubmittedOn, b.formSubmittedOn);
          break;
        case 'paymentDate':
          c = cmpStr(a.paymentOn ?? '', b.paymentOn ?? '');
          break;
        case 'amount':
          c = cmpBig(asBig(a.maturityPaise), asBig(b.maturityPaise));
          break;
        case 'paid':
          c = cmpBig(asBig(a.paidPaise), asBig(b.paidPaise));
          break;
        case 'remaining':
          c = cmpBig(asBig(a.remainingPaise), asBig(b.remainingPaise));
          break;
        case 'agent':
          c = cmpStr(a.agentName, b.agentName);
          break;
        case 'days':
          c = (Number(d(a.id, 'windowDays', String(a.windowDays))) || 0) - (Number(d(b.id, 'windowDays', String(b.windowDays))) || 0);
          break;
        case 'perDay':
          c = cmpBig(perDay(a), perDay(b));
          break;
        case 'today':
          // Scheduled rows display the engine's live figure, so sorting must read that same
          // figure. Using the legacy typed field made the dropdown say "Today descending"
          // while the numbers on screen were visibly unordered.
          c = selectedPayoutDate
            ? cmpBig(plannedOnDate(a, selectedPayoutDate).total, plannedOnDate(b, selectedPayoutDate).total)
            : compareTodayFigures(a, b, 'today');
          break;
        case 'cash':
          c = selectedPayoutDate
            ? cmpBig(plannedOnDate(a, selectedPayoutDate).cash, plannedOnDate(b, selectedPayoutDate).cash)
            : compareTodayFigures(a, b, 'cash');
          break;
        case 'online':
          c = selectedPayoutDate
            ? cmpBig(plannedOnDate(a, selectedPayoutDate).online, plannedOnDate(b, selectedPayoutDate).online)
            : compareTodayFigures(a, b, 'online');
          break;
        case 'paidToday':
          c = cmpBig(asBig(a.paidTodayActualPaise), asBig(b.paidTodayActualPaise));
          break;
        case 'paidCashToday':
          c = cmpBig(asBig(a.paidCashTodayPaise), asBig(b.paidCashTodayPaise));
          break;
        case 'paidOnlineToday':
          c = cmpBig(asBig(a.paidOnlineTodayPaise), asBig(b.paidOnlineTodayPaise));
          break;
        case 'given':
          c = Number(asBig(a.remainingPaise) <= 0n) - Number(asBig(b.remainingPaise) <= 0n);
          break;
      }
      return c * dir;
    });
    },
    [sortKey, sortDir, d, selectedPayoutDate, viewDay],
  );

  /**
   * How many rows are carrying a not-taken day, counted across EVERY row rather than the
   * filtered view — the same rule as "due today". A backlog that shrank because somebody
   * filtered to one agent would be a lie in the one place the branch cannot afford one.
   */
  const missedCount = useMemo(
    () => props.rows.filter(hasMissedPayment).length,
    [props.rows],
  );

  const visible = useMemo(() => {
    let list: readonly RegisterRow[] = props.rows;
    // No role-specific row filter here. A cashier used to be shown approved rows only, which
    // emptied the whole sheet whenever nothing had been approved yet — the register is the
    // branch's book and everyone reads all of it. Marking a day is still gated on the row
    // having a live instalment, so seeing an unscheduled row does not make it payable.
    if (tab === 'pending') list = list.filter((r) => !r.scheduled);
    if (tab === 'today') list = list.filter((r) => BigInt(r.remainingPaise) > 0n);
    // The whole of today's work, including the rows already answered for — see isOnTodaysList.
    // The cash figure in the header still sums only what is left to find.
    if (tab === 'due') list = list.filter(isOnTodaysList);
    // Everyone who did not withdraw on a day they were due. Note this is a *view* of the same
    // rows, not a second list: the user's rule is that a missed payment is never removed from
    // the twelve-day sheet, only coloured. This tab is the shortcut to them, not their home.
    if (tab === 'missed') list = list.filter(hasMissedPayment);
    if (agentId) list = list.filter((r) => r.agentId === agentId);
    if (isRangeActive(range)) list = list.filter((r) => rowInDateRange(r, dateField, range));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.customerName.toLowerCase().includes(s) ||
          (r.accountNumber ?? '').includes(s) ||
          r.agentName.toLowerCase().includes(s),
      );
    }
    return sortRows(list);
  }, [props.rows, tab, agentId, q, range, dateField, sortRows]);

  const totals = visible.reduce(
    (a, r) => {
      const remaining = BigInt(r.remainingPaise);
      const days = Math.max(1, Number(d(r.id, 'windowDays', String(r.windowDays))) || 1);
      const scheduledDay = payoutOnDate(r, viewDay);
      const planned = plannedOnDate(r, selectedPayoutDate);
      const fallback = recommendedPerDay(remaining, BigInt(r.maturityPaise), days);
      const recommendation = scheduledDay ? planned.total : fallback;
      return {
        maturity: a.maturity + BigInt(r.maturityPaise),
        paid: a.paid + BigInt(r.paidPaise),
        remaining: a.remaining + remaining,
        today: a.today + (scheduledDay ? planned.total :
          (tryParseRupeesToPaise(d(r.id, 'today', rupeesStr(BigInt(r.todayPaise)))) ?? BigInt(r.todayPaise))),
        rec: a.rec + recommendation,
      };
    },
    { maturity: 0n, paid: 0n, remaining: 0n, today: 0n, rec: 0n },
  );

  /**
   * Today's obligation for the whole branch.
   *
   * Deliberately derived from `props.rows` and not from `visible`: this is the number the
   * branch has to fund before opening, and it must not move when somebody filters to one
   * agent to check something.
   */
  const dueStats = useMemo(() => summariseDueToday(props.rows, props.today), [props.rows, props.today]);

  const paidTodayP = BigInt(props.paidTodayPaise);
  const stillToGive = dueStats.total > paidTodayP ? dueStats.total - paidTodayP : 0n;

  const allRemaining = props.rows.reduce((a, r) => a + BigInt(r.remainingPaise), 0n);
  const cashHandP = tryParseRupeesToPaise(cashHand) ?? 0n;
  const onlineP = tryParseRupeesToPaise(onlinePlan) ?? 0n;
  const need = extraMode === 'today' ? totals.today : dateFilterOn ? totals.remaining : allRemaining;
  const extraAfterCash = need > cashHandP ? need - cashHandP : 0n;
  const extraOpening = extraAfterCash > onlineP ? extraAfterCash - onlineP : 0n;

  /*
   * Cover: what the branch can actually pay out today against what it owes today.
   * The four figures beside it are the workings; this is the answer, and it is the one
   * thing the clerk used to have to compute in their head before opening the till.
   * Ratio is taken in paise and only then narrowed to a Number, so no money touches float.
   */
  const coverHave = cashHandP + onlineP;
  const covered = coverHave >= need;
  const coverPct = need > 0n ? Math.min(100, Number((coverHave * 1000n) / need) / 10) : 100;

  const agentTotals = useMemo(() => {
    if (!agentId) return null;
    const list = props.rows.filter((r) => r.agentId === agentId);
    return {
      n: list.length,
      live: list.filter((r) => BigInt(r.remainingPaise) > 0n).length,
      amount: list.reduce((a, r) => a + BigInt(r.maturityPaise), 0n),
      paid: list.reduce((a, r) => a + BigInt(r.paidPaise), 0n),
      remaining: list.reduce((a, r) => a + BigInt(r.remainingPaise), 0n),
    };
  }, [props.rows, agentId]);

  // ── Selection ────────────────────────────────────────────────────────────

  /**
   * The ticked rows, in the order the sheet is sorted.
   *
   * Drawn from `props.rows` rather than `visible` on purpose: a tick survives a filter change, so
   * a clerk can gather rows across several days, or across two agents, before acting on them. It
   * is also the only way `selected` cannot silently rot — a row that no longer exists after a
   * refresh simply drops out of this list, and the count in the toolbar corrects itself.
   */
  const selectedRows = useMemo(
    () => sortRows(props.rows.filter((r) => selected[r.id])),
    [props.rows, selected, sortRows],
  );
  const selCount = selectedRows.length;
  const selIds = useMemo(() => selectedRows.map((r) => r.id), [selectedRows]);
  const sel = useMemo(() => summariseSelection(selectedRows), [selectedRows]);
  const selOffView = useMemo(() => {
    const onView = new Set(visible.map((r) => r.id));
    return selectedRows.filter((r) => !onView.has(r.id)).length;
  }, [selectedRows, visible]);

  const visibleSelectedCount = selCount - selOffView;
  const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;

  const clearSelection = useCallback(() => {
    setSelected({});
    setBulkMenu(null);
    anchorRef.current = null;
  }, []);

  /** Esc drops the selection — the fastest way out of a mis-click on 107 rows. */
  useEffect(() => {
    if (selCount === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selCount, clearSelection]);

  function setAllVisible(on: boolean) {
    setSelected((s) => {
      const next = { ...s };
      for (const r of visible) {
        if (on) next[r.id] = true;
        else delete next[r.id];
      }
      return next;
    });
    anchorRef.current = null;
  }

  /**
   * Tick one row — or, with Shift held, everything between it and the last row clicked.
   *
   * The range runs over `visible`, which is what the clerk can actually see, so shift-clicking
   * down a filtered day selects that day and nothing hidden behind the filter.
   */
  function toggleRow(id: string, on: boolean, shift: boolean) {
    const anchor = anchorRef.current;
    if (shift && anchor && anchor !== id) {
      const from = visible.findIndex((r) => r.id === anchor);
      const to = visible.findIndex((r) => r.id === id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelected((s) => {
          const next = { ...s };
          for (let i = lo; i <= hi; i += 1) {
            if (on) next[visible[i].id] = true;
            else delete next[visible[i].id];
          }
          return next;
        });
        anchorRef.current = id;
        return;
      }
    }
    setSelected((s) => {
      const next = { ...s };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });
    anchorRef.current = id;
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────

  /** Run one bulk action, report it once, and drop the selection only if something changed. */
  async function runBulkAction(
    key: string,
    verb: string,
    call: () => Promise<
      { ok: true; data: { done: number; failed: { label: string; error: string }[] } } | { ok: false; error: string }
    >,
    opts: { keepSelection?: boolean } = {},
  ) {
    if (selCount === 0) return;
    if (selCount > MAX_BULK) {
      return toast.error(`Select at most ${MAX_BULK} rows at a time.`);
    }
    setBusy(key);
    const result = await call();
    setBusy(null);
    const changed = reportBulk(result, verb);
    setBulkMenu(null);
    if (changed) {
      if (!opts.keepSelection) clearSelection();
      router.refresh();
    }
  }

  async function save(id: string, patch: Parameters<typeof saveRegisterFieldsAction>[1]) {
    const r = await saveRegisterFieldsAction(id, patch);
    if (!r.ok) toast.error(r.error);
    else {
      const active = document.activeElement as HTMLInputElement | null;
      if (active?.dataset.registerRow && active.dataset.registerColumn) {
        restoreFocusRef.current = {
          row: active.dataset.registerRow,
          column: active.dataset.registerColumn,
        };
      }
      router.refresh();
    }
  }

  function rememberGridFocus() {
    const active = document.activeElement as HTMLInputElement | null;
    if (active?.dataset.registerRow && active.dataset.registerColumn) {
      restoreFocusRef.current = {
        row: active.dataset.registerRow,
        column: active.dataset.registerColumn,
      };
    }
  }

  async function savePlannedAmount(row: RegisterRow, amountRupees: string, instalmentId = row.todayInstalmentId) {
    if (!instalmentId) {
      toast.error(`This row has no scheduled payment for ${selectedPayoutDate ? formatDMY(selectedPayoutDate) : 'today'}.`);
      return;
    }
    const result = await setInstalmentAmountAction(row.id, instalmentId, amountRupees || '0');
    if (!result.ok) toast.error(result.error);
    else { rememberGridFocus(); router.refresh(); }
  }

  async function saveLegs(row: RegisterRow, cashRupees: string, onlineRupees: string, instalmentId: string | null) {
    if (!instalmentId) {
      toast.error('This row has no scheduled payment for that day.');
      return;
    }
    const result = await setInstalmentLegsAction(row.id, instalmentId, cashRupees || '0', onlineRupees || '0');
    if (!result.ok) toast.error(result.error);
    else { rememberGridFocus(); router.refresh(); }
  }

  /**
   * The counter's one box: what this customer was handed today, in total.
   *
   * The figure is not bound to today's instalment any more. A customer who missed Monday and
   * comes in on Tuesday owing two days is paid once, and `settleRegisterRow` decides which days
   * that clears — oldest first. So the cell stays open when nothing is scheduled for today but
   * earlier days are still red, which is exactly the case it used to refuse.
   *
   * A reason is asked for in two situations, and the server insists on it independently: when a
   * figure already recorded today is being changed, and when the amount reaches past today into
   * days that are not due yet.
   */
  async function savePaidSplit(row: RegisterRow, cashRupees: bigint, onlineRupees: bigint) {
    const total = cashRupees + onlineRupees;
    /*
      What this figure is allowed to reach, measured as the server will measure it.

      The box REPLACES today's total rather than adding to it, so the server first rolls back
      everything already taken today and then allocates the new figure. Capacity is therefore the
      arrears and today's day as they stand, PLUS whatever today has already paid — that money is
      about to be handed back to the pool before the new figure is placed. Leaving the last term
      out is what would make a cashier correcting ₹26,000 down to ₹20,000 get asked to authorise
      paying ahead.
    */
    const dueTodayOutstanding = (() => {
      const due = BigInt(row.todayDuePaise) - BigInt(row.todayPaidTakenPaise);
      return due > 0n ? due : 0n;
    })();
    const capacity =
      dueTodayOutstanding + BigInt(row.overduePaise) + BigInt(row.paidTodayActualPaise);

    if (capacity === 0n && total > 0n && !row.todayInstalmentId) {
      toast.error('Nothing is due on this row today or earlier.');
      return;
    }

    const reference = onlineRupees > 0n
      ? window.prompt('Enter UTR / transfer reference for the online amount:')
      : null;
    if (onlineRupees > 0n && !reference?.trim()) return;

    const replacing = BigInt(row.paidTodayActualPaise) > 0n;
    const payingAhead = total * 100n > capacity;
    let reason: string | null = 'Register entry';
    if (payingAhead) {
      reason = window.prompt(
        `Only ₹${inr(capacity)} is due today and earlier on this row. Paying more settles days ` +
          'that have not come round yet. Reason for authorising it:',
      );
      if (!reason?.trim()) return;
    } else if (replacing) {
      reason = window.prompt('Reason for correcting the recorded payment:', 'Register correction');
      if (!reason?.trim()) return;
    }

    const result = await settleRegisterRowAction(
      row.id,
      cashRupees.toString(),
      onlineRupees.toString(),
      reference?.trim() || null,
      reason?.trim() || null,
    );
    if (!result.ok) toast.error(result.error);
    else { rememberGridFocus(); router.refresh(); }
  }

  /**
   * Which days are mid-flight.
   *
   * Marking is one click on a row in a hundred-row sheet, and the answer only lands after the
   * server round-trip and a refresh. Without this a clerk working down the page clicks the same
   * row twice because nothing changed yet — and the second click would be a second payout.
   * The server would reject it on INV-4, but the right place to stop it is before it is sent.
   */
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const [payRow, setPayRow] = useState<RegisterRow | null>(null);
  const [paying, setPaying] = useState(false);

  async function confirmPay(input: {
    instalmentIds: string[];
    cashRupees: string | null;
    onlineRupees: string | null;
    reference: string | null;
    reason: string | null;
    valueDate: string;
    replaceVisit: boolean;
    corrections: {
      instalmentId: string;
      paidRupees: string;
      cashRupees: string;
      onlineRupees: string;
      previousPaidRupees: string;
    }[];
  }) {
    if (!payRow || paying) return;
    setPaying(true);
    for (const correction of input.corrections) {
      if (correction.paidRupees === correction.previousPaidRupees) continue;
      const result = await correctRegisterDayPaidAction(
        correction.instalmentId,
        correction.cashRupees,
        input.reason || 'Register correction',
        input.reference,
        correction.onlineRupees,
        input.valueDate,
      );
      if (!result.ok) {
        setPaying(false);
        toast.error(result.error);
        return;
      }
    }
    if (!input.replaceVisit && input.instalmentIds.length > 0) {
      const result = await confirmRegisterTakenAction(
        payRow.id,
        input.instalmentIds,
        input.cashRupees,
        input.onlineRupees,
        input.reference,
        input.reason,
        input.valueDate,
      );
      if (!result.ok) {
        setPaying(false);
        toast.error(result.error);
        return;
      }
    }
    setPaying(false);
    toast.success(input.replaceVisit || input.corrections.length ? 'Payment updated' : 'Payment recorded');
    setPayRow(null);
    router.refresh();
  }

  async function onNotTaken(instalmentId: string, clear: boolean) {
    if (marking[instalmentId]) return;
    setMarking((m) => ({ ...m, [instalmentId]: true }));
    const r = await markNotTakenAction(instalmentId, clear);
    setMarking((m) => ({ ...m, [instalmentId]: false }));
    if (!r.ok) toast.error(r.error);
    else {
      toast.success(clear ? 'Not-paid mark cleared' : 'Marked not paid');
      router.refresh();
    }
  }

  async function onImport(file: File) {
    if (!props.branchId) return toast.error('No branch');
    setBusy('import');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('No sheet');
      const grid: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const line: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          line[col - 1] = excelCellRaw(cell.value);
        });
        grid.push(line);
      });
      const r = await importRegisterAction(props.branchId, grid);
      if (!r.ok) toast.error(r.error);
      else {
        const warnings = r.data?.warnings ?? [];
        const errors = r.data?.errors ?? [];
        const extra = [
          r.data?.skipped ? `${r.data.skipped} skipped` : '',
          warnings.length ? `${warnings.length} note${warnings.length === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        toast.success(`Imported ${r.data?.created ?? 0} rows`, { description: extra || undefined, duration: 8000 });
        for (const note of [...warnings, ...errors].slice(0, 6)) toast.message(note);
      }
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read file');
    }
    setBusy(null);
  }

  function exportValue(col: RegisterColId, r: RegisterRow): string | number {
    switch (col) {
      case 'account':
        return r.accountNumber ?? '';
      case 'customer':
        return r.customerName;
      case 'maturityDate':
        return r.instrumentMaturityOn ? formatDMY(r.instrumentMaturityOn) : '';
      case 'formDate':
        return formatDMY(r.formSubmittedOn);
      case 'paymentDate':
        return r.paymentOn ? formatDMY(r.paymentOn) : '';
      case 'amount':
        return inr(BigInt(r.maturityPaise));
      case 'paid':
        return inr(BigInt(r.paidPaise));
      case 'remaining':
        return inr(BigInt(r.remainingPaise));
      case 'agent':
        return r.agentName;
      case 'days':
        return r.windowDays;
      case 'perDay': {
        const per = recommendedPerDay(BigInt(r.remainingPaise), BigInt(r.maturityPaise), r.windowDays);
        return per > 0n ? inr(per) : '0';
      }
      case 'today':
        return inr(payoutOnDate(r, viewDay) ? plannedOnDate(r, selectedPayoutDate).total : BigInt(r.todayPaise));
      case 'cash':
        return inr(payoutOnDate(r, viewDay) ? plannedOnDate(r, selectedPayoutDate).cash : BigInt(r.todayCashPaise));
      case 'online':
        return inr(payoutOnDate(r, viewDay) ? plannedOnDate(r, selectedPayoutDate).online : BigInt(r.todayOnlinePaise));
      case 'paidToday':
        return inr(paidOnDate(r, viewDay, props.today).total);
      case 'paidCashToday':
        return inr(paidOnDate(r, viewDay, props.today).cash);
      case 'paidOnlineToday':
        return inr(paidOnDate(r, viewDay, props.today).online);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c') return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ids = Object.keys(selected).filter((id) => selected[id]);
      if (ids.length === 0) return;
      const lines = ids.map((id) => {
        const row = props.rows.find((item) => item.id === id);
        if (!row) return '';
        return visCols.map((col) => String(exportValue(col.id, row))).join('\t');
      });
      void navigator.clipboard.writeText(lines.join('\n'));
      toast.success(`Copied ${ids.length} row${ids.length === 1 ? '' : 's'}`);
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, props.rows, visCols]);

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking immediately can beat the download in some browsers; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** The rows an export or a print should cover, and what to call the file. */
  function exportScope(scope: 'view' | 'selection') {
    const list = scope === 'selection' ? selectedRows : visible;
    const suffix = scope === 'selection' ? `selection-${list.length}` : 'view';
    return { list, name: `register-${props.today}-${suffix}` };
  }

  function exportCsv(scope: 'view' | 'selection') {
    const { list, name } = exportScope(scope);
    if (list.length === 0) return toast.error('Nothing to export');
    const header = visCols.map((c) => c.excel);
    const body = list.map((r) => visCols.map((c) => exportValue(c.id, r)));
    const csv = [header, ...body]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // A BOM, or Excel reads the customer names as mojibake.
    download(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    toast.success(`${list.length} ${list.length === 1 ? 'row' : 'rows'} exported to CSV`);
  }

  /**
   * Excel export, built in the browser from the rows already on screen.
   *
   * Deliberately not a round-trip to `/api/export/cases`: that route exports everything the actor
   * may see, which is the opposite of what "export the eight rows I ticked" means. exceljs is
   * already in the bundle for import, so this costs nothing extra.
   */
  async function exportXlsx(scope: 'view' | 'selection') {
    const { list, name } = exportScope(scope);
    if (list.length === 0) return toast.error('Nothing to export');
    setBusy('export');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = PRODUCT_NAME;
      const ws = wb.addWorksheet('Register', { views: [{ state: 'frozen', ySplit: 1 }] });
      const header = visCols.map((c) => c.excel);
      ws.addRow(header);
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      for (const r of list) ws.addRow(visCols.map((c) => exportValue(c.id, r)));
      ws.columns.forEach((col, i) => {
        col.width = Math.max(12, (header[i]?.length ?? 10) + 4);
        if (visCols[i]?.right) col.numFmt = '#,##,##0';
      });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
      const buf = await wb.xlsx.writeBuffer();
      download(
        new Blob([buf], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${name}.xlsx`,
      );
      toast.success(`${list.length} ${list.length === 1 ? 'row' : 'rows'} exported to Excel`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the file');
    }
    setBusy(null);
  }

  /**
   * Print, restricted to a scope.
   *
   * `window.print()` blocks, so the state that narrows the table has to be committed to the DOM
   * before the call \u2014 hence the double rAF. `afterprint` puts the sheet back; a timeout backs it
   * up because Safari does not always fire it.
   */
  function doPrint(scope: 'view' | 'selection') {
    const list = scope === 'selection' ? selectedRows : visible;
    if (list.length === 0) return toast.error('Nothing to print');
    setBulkMenu(null);
    setPrintScope(scope);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.print();
        setTimeout(() => setPrintScope(null), 500);
      }),
    );
  }

  useEffect(() => {
    const done = () => setPrintScope(null);
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);

  /** What the table renders: the view, or just the ticked rows while a selection print runs. */
  const tableRows = printScope === 'selection' ? selectedRows : visible;

  /**
   * The days this customer was due and did not take, oldest first.
   *
   * Not paid used to list the CASE — the same row Due today already shows, with today's figures
   * on it, which told a clerk that somebody was behind without ever saying which day or how much.
   * The backlog is a list of days, so this returns days: each with its own date, its own
   * outstanding amount, and its own ✓ / ✗, while the case keeps one row in the sheet.
   */
  function missedDaysOf(r: RegisterRow): (PayoutDayView & { outstandingPaise: bigint })[] {
    return (r.payoutDays ?? [])
      .filter((day) => day.dueOn < props.today && day.status !== 'PAID')
      .map((day) => ({ ...day, outstandingPaise: BigInt(day.amountPaise) - BigInt(day.paidPaise) }))
      .filter((day) => day.outstandingPaise > 0n)
      .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  }

  const locked = closed && !canOverrideDates(props.role);
  const editDates = props.canEdit && (!locked || canOverrideDates(props.role));

  /**
   * Blank rows belong on an unfiltered sheet and nowhere else.
   *
   * "Due today" padded out to a hundred rows would be ninety-odd empty ones under a heading that
   * says how much cash the branch must open with — the filter would stop meaning anything. So
   * they appear on All, with no search, agent or date narrowing, and only for someone who could
   * have created the row anyway.
   */
  const sheetUnfiltered = tab === 'all' && !q.trim() && !agentId && !isRangeActive(range);
  const blankRowCount =
    sheetUnfiltered && props.canEdit && props.canCreate && !locked
      ? Math.max(0, sheetLength - props.rows.length)
      : 0;

  /** Both desk money fields write the same row, so they commit through one call. */
  async function commitDayCash() {
    const r = await saveDayCashAction(props.branchId, props.today, cashHand, onlinePlan);
    if (!r.ok) toast.error(r.error);
    else router.refresh();
  }

  const liveCount = props.rows.filter((r) => BigInt(r.remainingPaise) > 0n).length;

  return (
    <div className="space-y-3 print:space-y-2">
      {printScope && (
        <style>{`
          @page { size: A4 landscape; margin: 8mm; }
          @media print {
            input[data-register-cell] {
              border: none !important;
              background: transparent !important;
              box-shadow: none !important;
              color: #000 !important;
              -webkit-text-fill-color: #000 !important;
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }
          }
        `}</style>
      )}
      {/*
        One command bar, where there used to be three bands under a mostly-empty app bar.
        Identity moved up into the top bar (topbar.tsx prints the page name now), so what is
        left here is only what acts on the sheet: which rows, which days, which order, and the
        two buttons that put rows in it. Groups are told apart by hairline rules rather than by
        giving each one its own line of glass.
      */}
      <Glass className="print:hidden">
        {/* The visible page name lives in the app top bar; this keeps the document heading. */}
        <h1 className="sr-only">Register — {props.branchLabel}</h1>
        <div className="flex flex-col gap-1.5 px-3 py-2">
          {/* Which rows the sheet is showing — and the two buttons that put rows in it. */}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2">
              <div className="flex max-w-full overflow-x-auto rounded-[10px] border border-[var(--input-border)] p-0.5">
                {(['due', 'missed', 'today', 'pending', 'all'] as Tab[]).map((t) => {
                  const badge = t === 'due' ? dueStats.count : t === 'missed' ? missedCount : 0;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        applyFilter(
                          t === 'due'
                            ? { tab: t, range: EMPTY_RANGE }
                            : { tab: t },
                        )
                      }
                      title={TAB_HINT[t]}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[0.8125rem] whitespace-nowrap',
                        tab === t
                          ? 'bg-[var(--glass-bg-strong)] font-medium text-[var(--page-fg)]'
                          : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
                        t === 'due' && tab !== t && badge > 0 && 'text-[var(--color-brand-600)]',
                        // A backlog is the one thing on this bar worth colouring red, and it
                        // matches the rows it leads to.
                        t === 'missed' && tab !== t && badge > 0 && 'text-[var(--row-missed-edge)]',
                      )}
                    >
                      {TAB_LABEL[t]}
                      {badge > 0 && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-px text-[0.65rem] font-semibold tabular-nums',
                            t === 'missed'
                              ? 'bg-[var(--row-missed-strong)] text-[var(--row-missed-fg)]'
                              : tab === t
                                ? 'bg-[var(--color-brand-500)] text-white'
                                : 'bg-[var(--color-brand-100)] text-[var(--color-brand-700)]',
                          )}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/*
                Search and the agent filter travel together. Left loose they wrapped one at a
                time, so a narrow window put "All agents" on a line of its own and the bar looked
                broken rather than merely full.
              */}
              <div className="flex min-w-[13rem] flex-1 items-center gap-2">
              <label className="relative min-w-[7rem] flex-1">
                <span className="sr-only">Search name, account or agent</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, A/c, agent"
                  className="!h-7 !py-1 pl-8 !text-[0.8125rem] !leading-none"
                  style={{ paddingLeft: '2rem' }}
                />
              </label>

              <label className="min-w-[6rem] flex-1">
                <span className="sr-only">Filter by agent</span>
                <select
                  className="mf-input !h-7 !py-1 !text-[0.8125rem] !leading-none"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                >
                  <option value="">All agents</option>
                  {props.agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              </div>
              <Div className="hidden lg:block" />

                <ArrowUpDown className="hidden h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)] 2xl:block" aria-hidden />
                <select
                  className="mf-input !h-7 !w-auto !py-1 !text-[0.75rem] !leading-none"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  aria-label="Sort column"
                  title="Sort column"
                >
                  {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABEL[k]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortDir((v) => (v === 'asc' ? 'desc' : 'asc'))}
                  title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
                  className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[var(--input-border)] px-2 text-[0.78rem] text-[var(--muted-fg)] hover:text-[var(--page-fg)]"
                >
                  {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                  {/*
                    The words are the first thing to go when the bar runs out of room — the arrow
                    still says which way, the tooltip spells it out, and the table header repeats
                    it on the sorted column. Keeping them cost a whole extra line on a laptop.
                  */}
                  <span className="hidden 2xl:inline">
                    {sortDir === 'asc' ? 'Low → high' : 'High → low'}
                  </span>
                </button>

            </div>

            <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-1.5 sm:justify-end xl:w-auto">
              {/*
                On a laptop this bar has no width to spare, so the branch name gives way first
                and the code carries the identity. Nothing is lost: the full label is in the
                tooltip, and the top bar prints it for anyone scoped to a single branch.
              */}
              {props.branchSwitch && props.branchSwitch.branches.length > 0 ? (
                <label className="flex items-center gap-1.5 text-[0.72rem] text-[var(--muted-fg)]">
                  <span className="sr-only">Branch</span>
                  <select
                    className="mf-input h-8 max-w-[14rem] py-0 text-[0.75rem]"
                    value={props.branchId || 'all'}
                    onChange={(event) => {
                      const next = event.target.value;
                      const path = props.branchSwitch!.path;
                      router.push(next === 'all' ? `${path}?branch=all` : `${path}?branch=${next}`);
                    }}
                    aria-label="Working branch"
                    title="All branches shows every row. Pick one branch to type into that register."
                  >
                    {props.branchSwitch.allowAll && <option value="all">All branches</option>}
                    {props.branchSwitch.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                  <span className="tabular-nums text-[var(--faint-fg)]">
                    {liveCount} live / {props.rows.length}
                  </span>
                </label>
              ) : (
              <span
                className="whitespace-nowrap text-[0.72rem] text-[var(--muted-fg)]"
                title={props.branchLabel}
              >
                <span className="hidden 2xl:inline">{props.branchLabel}</span>
                <span className="2xl:hidden">{props.branchLabel.split(' · ')[0]}</span>
                <span className="tabular-nums text-[var(--faint-fg)]">
                  {' '}
                  · {liveCount} live / {props.rows.length}
                </span>
              </span>
              )}

              <Div />


              {props.canCreate && (
                <div className="relative">
                  <Button
                    variant="glass"
                    size="sm"
                    disabled={locked}
                    onClick={() => setAddOpen((v) => !v)}
                    aria-expanded={addOpen}
                    aria-haspopup="dialog"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add rows
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </Button>
                  {addOpen && (
                    // `.glass` sets `position: relative` and is declared outside any @layer, so it
                    // beats Tailwind's layered `absolute` utility — putting the class and the
                    // positioning on one element drops the popover back into the flex flow and
                    // shreds the toolbar. Position the wrapper; style the panel inside it.
                    <div className="absolute right-0 top-full z-30 mt-1.5 w-60">
                      <div
                        role="dialog"
                        aria-label="Add blank rows"
                        className="rounded-[12px] border border-[var(--glass-border)] bg-[var(--page-bg)] p-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.35)]"
                      >
                      <p className="mb-2 text-[0.75rem] text-[var(--muted-fg)]">
                        How many blank rows?
                      </p>
                      <div className="mb-2 flex gap-1">
                        {[1, 5, 10, 25].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setAddCount(String(n))}
                            className={cn(
                              'h-7 flex-1 rounded-[7px] border border-[var(--input-border)] text-[0.75rem] tabular-nums',
                              addCount === String(n)
                                ? 'bg-[var(--glass-bg-strong)] font-medium'
                                : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
                            )}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                      <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const n = Number(addCount);
                          if (!Number.isFinite(n) || n < 1) return toast.error('Enter a number of rows.');
                          if (n > MAX_ADD_ROWS) return toast.error(`At most ${MAX_ADD_ROWS} rows at a time.`);
                          // Lengthen the sheet rather than writing n DRAFT cases. Each row
                          // becomes real the moment somebody types in it, so this is instant
                          // and costs nothing if the clerk asked for more than they needed.
                          setSheetLength((len) => Math.max(len, props.rows.length) + n);
                          // The blank rows only render unfiltered, so go where they are.
                          setTab('all');
                          setQ('');
                          setAgentId('');
                          setRange(EMPTY_RANGE);
                          setAddOpen(false);
                          toast.success(n === 1 ? 'Row added' : `${n} rows added`);
                        }}
                      >
                        <Input
                          autoFocus
                          inputMode="numeric"
                          value={addCount}
                          onChange={(e) => setAddCount(e.target.value.replace(/[^\d]/g, ''))}
                          className="!h-7 !py-1 text-center !text-[0.8125rem] tabular-nums"
                          aria-label="Number of rows to add"
                        />
                        <Button type="submit" variant="primary" size="sm" loading={busy === 'add'}>
                          Add
                        </Button>
                      </form>
                      <p className="mt-2 text-[0.68rem] text-[var(--faint-fg)]">
                        Up to {MAX_ADD_ROWS} at once. They appear as blank draft rows.
                      </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {props.canImport && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onImport(f);
                      e.target.value = '';
                    }}
                  />
                  <Button variant="primary" size="sm" loading={busy === 'import'} onClick={() => fileRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" />
                    Import
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Which days, in what order, and where a copy of it goes. */}
          <div className="flex flex-col gap-2 xl:flex-row xl:items-start">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)]" aria-hidden />
              <select
                className="mf-input !h-7 !w-auto !py-1 !text-[0.75rem] !leading-none"
                value={dateField}
                onChange={(e) => applyFilter({ dateField: e.target.value as DateField })}
                aria-label="Which date to filter on"
              >
                {(Object.keys(DATE_FIELD_LABEL) as DateField[]).map((f) => (
                  <option key={f} value={f}>
                    {DATE_FIELD_LABEL[f]}
                  </option>
                ))}
              </select>

              {/*
                Picking a from-date with an empty to-date is a single day (to follows from). Fill
                both boxes for a span. The chips write both ends, so a preset always shows the
                dates it actually applied rather than hiding them behind a label.
              */}
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  className="mf-input !h-7 !w-[7.9rem] !py-1 !text-[0.75rem] !leading-none tabular-nums"
                  value={range.from}
                  max={range.to || undefined}
                  onChange={(e) => {
                    const from = e.target.value;
                    // An empty "to" means a single day, which is what picking one date is for.
                    const wasSingle = !range.to || range.to === range.from;
                    applyFilter({ range: { from, to: wasSingle ? from : range.to } });
                  }}
                  aria-label="From date"
                  title="From this date"
                />
                <span className="text-[0.78rem] text-[var(--faint-fg)]">→</span>
                <input
                  type="date"
                  className="mf-input !h-7 !w-[7.9rem] !py-1 !text-[0.75rem] !leading-none tabular-nums"
                  value={range.to}
                  min={range.from || undefined}
                  onChange={(e) => applyFilter({ range: { from: range.from, to: e.target.value } })}
                  aria-label="To date"
                  title="To this date — leave empty to include every later date"
                />
              </div>

              <div className="flex flex-wrap gap-1">
                {DATE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      applyFilter({
                        tab: 'all',
                        dateField: 'payout',
                        range: preset === p ? EMPTY_RANGE : resolveDatePreset(p, props.today),
                      })
                    }
                    aria-pressed={preset === p}
                    title={DATE_PRESET_LABEL[p]}
                    className={cn(
                      'h-7 rounded-[7px] border border-[var(--input-border)] px-1.5 text-[0.75rem] whitespace-nowrap',
                      preset === p
                        ? 'bg-[var(--glass-bg-strong)] font-medium text-[var(--page-fg)]'
                        : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
                      p === 'overdue' && preset !== p && 'text-[var(--color-warn-600)]',
                    )}
                  >
                    {DATE_PRESET_SHORT[p]}
                  </button>
                ))}
                {dateFilterOn && (
                  <button
                    type="button"
                    onClick={() => applyFilter({ range: EMPTY_RANGE })}
                    className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2 text-[0.78rem] text-[var(--muted-fg)] hover:text-[var(--page-fg)]"
                  >
                    <X className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/*
              Row 2 closes with what this view is and where a copy of it goes: how many rows the
              filter left, then the four ways out of the screen. They sit here rather than beside
              Add rows / Import so the first row has the width to hold the sort control without
              spilling onto a third line — and so this row ends on something instead of air.
            */}
            <div className="flex w-full shrink-0 items-center justify-end gap-1.5 self-center xl:w-auto">
              <p className="whitespace-nowrap text-right text-[0.72rem] leading-tight text-[var(--faint-fg)]">
                <span className="font-semibold tabular-nums text-[var(--muted-fg)]">
                  {visible.length}
                </span>{' '}
                of <span className="tabular-nums">{props.rows.length}</span> rows
                {selCount > 0 && (
                  <span className="text-[var(--color-brand-600)]"> · {selCount} selected</span>
                )}
              </p>
                {props.canImport && (
                  <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Download a blank Excel template">
                    <a href={`/api/export/template?branch=${props.branchId}`} aria-label="Download blank Excel template">
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  loading={busy === 'export'}
                  onClick={() => void exportXlsx('view')}
                  title={`Export these ${visible.length} rows to Excel — tick rows to export just those`}
                  aria-label="Export this view to Excel"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => doPrint('view')}
                  title={`Print these ${visible.length} rows`}
                  aria-label="Print this view"
                >
                  <Printer className="h-3.5 w-3.5" />
                </Button>
                {props.canLayout && (
                  <Button
                    variant={colsOpen ? 'glass' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    title="Choose and reorder columns"
                    aria-label="Columns"
                    onClick={() => {
                      setDraftLayout(props.columnLayout);
                      setColsOpen((v) => !v);
                    }}
                  >
                    <Columns3 className="h-3.5 w-3.5" />
                  </Button>
                )}
            </div>
          </div>
        </div>

        {/*
          The desk. What must go out on the left, the money to meet it in the middle, the book
          totals on the right — then one bar underneath saying whether the middle covers the
          left. The two cash fields used to sit in a four-column panel *below* the table, which
          meant the branch could not see what it had to open with until it scrolled past every
          row. They are the first thing anyone needs in the morning, so they are up here now.
        */}
        {/*
          The desk, as five columns of one grid rather than loose stats in two flex rows.

          Each column answers one question, in the order the morning actually goes: what is owed
          today, how much of it has gone out, what there is to pay the rest with, what is missing,
          and what the whole book is worth. The grid is what removes the blank space — a flex row
          with `justify-end` balanced the two ends and left a hole in the middle, but a column
          takes a defined share of the width and the label/value rows inside justify to both of
          its edges, so the figures line up in a readable right-hand column.
        */}
        <div className="grid grid-cols-1 gap-x-2 gap-y-1 border-t border-[var(--hairline)] px-2 py-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <button
            type="button"
            onClick={() => applyFilter({ tab: 'due', range: EMPTY_RANGE })}
            title="Show only the rows due today"
            className={cn(
              'min-w-0 rounded-[10px] px-2.5 py-1.5 text-left transition-colors',
              dueStats.count > 0
                ? 'bg-[var(--color-brand-50)] hover:bg-[var(--color-brand-100)]'
                : 'hover:bg-[var(--glass-bg-subtle)]',
            )}
          >
            <span className="mb-1 flex h-4 items-center">
              <span className="text-[0.6rem] font-semibold uppercase tracking-[0.07em] text-[var(--color-brand-700)]">
                Due today
              </span>
            </span>
            <span className="block truncate text-[1.35rem] font-semibold leading-none tabular-nums text-[var(--page-fg)]">
              ₹{inr(dueStats.total)}
            </span>
            <span className="mt-1 block truncate text-[0.68rem] leading-tight text-[var(--muted-fg)]">
              {dueStats.count} {dueStats.count === 1 ? 'withdrawal' : 'withdrawals'}
            </span>
            <span className="block truncate text-[0.65rem] leading-tight text-[var(--faint-fg)]">
              cash ₹{inr(dueStats.cash)} · online ₹{inr(dueStats.online)}
            </span>
          </button>

          <DeskZone
            title="Paid so far"
            extra={
              dueStats.unsetCount > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    applyFilter({
                      tab: 'all',
                      range: resolveDatePreset('today', props.today),
                      dateField: 'payment',
                    })
                  }
                  title={`${dueStats.unsetCount} rows are dated today but have no amount set for today`}
                  className="shrink-0 rounded-[6px] bg-[var(--color-warn-500)]/12 px-1.5 text-[0.62rem] font-semibold tabular-nums text-[var(--color-warn-600)] hover:bg-[var(--color-warn-500)]/20"
                >
                  {dueStats.unsetCount} unset
                </button>
              ) : undefined
            }
          >
            <DeskRow
              label="Given today"
              tone="money"
              value={`₹${inr(paidTodayP)}`}
              title="Paid out so far today"
            />
            <DeskRow
              label="Still to give"
              value={`₹${inr(stillToGive)}`}
              title="Due today and not yet paid"
            />
            <DeskRow
              label="Withdrawals"
              value={props.withdrawalsToday}
              title="Payments recorded today"
            />
          </DeskZone>

          <DeskZone title="Cash to pay with">
            <DeskInputRow
              label="In hand"
              value={cashHand}
              onChange={setCashHand}
              onCommit={commitDayCash}
              disabled={!props.canSetCash || locked}
              title="Cash the branch is opening with today (approximate)"
            />
            <DeskInputRow
              label="Online"
              value={onlinePlan}
              onChange={setOnlinePlan}
              onCommit={commitDayCash}
              disabled={!props.canSetCash || locked}
              title="Amount planned to go out by online transfer"
            />
            <DeskRow
              label="Total to hand"
              value={`₹${inr(coverHave)}`}
              title="Cash in hand plus the planned online transfer"
            />
          </DeskZone>

          <DeskZone
            title="Shortfall"
            extra={
              <span className="flex shrink-0 rounded-[6px] border border-[var(--input-border)] p-px">
                {(['today', 'all'] as ExtraMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    title={
                      m === 'today'
                        ? "Measure against this view's total for today"
                        : 'Measure against everything still outstanding'
                    }
                    className={cn(
                      'rounded-[5px] px-1.5 text-[0.6rem] font-medium',
                      extraMode === m
                        ? 'bg-[var(--glass-bg-strong)] text-[var(--page-fg)]'
                        : 'text-[var(--faint-fg)] hover:text-[var(--page-fg)]',
                    )}
                    onClick={() => setExtraMode(m)}
                  >
                    {m === 'today' ? 'Today' : 'All'}
                  </button>
                ))}
              </span>
            }
          >
            <DeskRow
              label="Short of cash"
              tone={extraAfterCash > 0n ? 'warn' : 'plain'}
              value={`₹${inr(extraAfterCash)}`}
              title={`${extraMode === 'today' ? "This view's total for today" : dateFilterOn ? "This view's remaining" : 'All remaining'} less cash in hand`}
            />
            <DeskRow
              label="After online"
              tone={extraOpening > 0n ? 'warn' : 'plain'}
              value={`₹${inr(extraOpening)}`}
              title="Still to arrange once the planned online transfer lands"
            />
            {/*
              Cover, sitting under the two figures it settles. Amber only when the branch is
              genuinely short — an amber bar every morning is a bar nobody reads — and no bar at
              all when nothing is due, because a full green track would read as a full till.
            */}
            <div
              className="flex items-center gap-1.5 pt-0.5"
              title={
                need === 0n
                  ? 'Nothing is due in this view.'
                  : `₹${inr(coverHave)} to hand against ₹${inr(need)} due.`
              }
            >
              {need > 0n && (
                <span
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(coverPct)}
                  aria-label="Cash and online transfer against what is due"
                  className="h-1.5 min-w-[1.5rem] flex-1 overflow-hidden rounded-full bg-[var(--glass-bg-subtle)] ring-1 ring-inset ring-[var(--hairline)]"
                >
                  <span
                    className={cn(
                      'block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none',
                      covered ? 'bg-[var(--color-money-500)]' : 'bg-[var(--color-warn-500)]',
                    )}
                    style={{ width: `${coverPct}%` }}
                  />
                </span>
              )}
              <span className="shrink-0 whitespace-nowrap text-[0.65rem] font-semibold tabular-nums">
                {need === 0n ? (
                  <span className="text-[var(--faint-fg)]">Nothing due</span>
                ) : covered ? (
                  <span className="text-[var(--color-money-500)]">Covered</span>
                ) : (
                  <span className="text-[var(--color-warn-600)]">{Math.round(coverPct)}% covered</span>
                )}
              </span>
            </div>
          </DeskZone>

          {agentTotals ? (
            <DeskZone title={props.agents.find((a) => a.id === agentId)?.name ?? 'Agent'}>
              <DeskRow label="Live" value={`${agentTotals.live} / ${agentTotals.n}`} />
              <DeskRow label="Paid" tone="money" value={`₹${inr(agentTotals.paid)}`} />
              <DeskRow label="Remaining" value={`₹${inr(agentTotals.remaining)}`} />
            </DeskZone>
          ) : (
            <DeskZone title="The book">
              <DeskRow label="Maturity" value={`₹${inr(totals.maturity)}`} />
              <DeskRow label="Paid" tone="money" value={`₹${inr(totals.paid)}`} />
              <DeskRow label="Remaining" value={`₹${inr(totals.remaining)}`} />
            </DeskZone>
          )}
        </div>
      </Glass>

      {colsOpen && props.canLayout && (
        <Glass className="px-3 py-3 print:hidden">
          <p className="mb-2 text-[0.75rem] text-[var(--muted-fg)]">
            Drag the order with the arrows. Untick to hide. The Excel template follows this layout.
          </p>
          <ol className="space-y-1">
            {draftLayout.order.map((id, i) => {
              const def = REGISTER_COL_DEFS[id];
              const hidden = draftLayout.hidden.includes(id);
              return (
                <li key={id} className="flex items-center gap-2 rounded-[8px] px-1 py-0.5 hover:bg-[var(--glass-bg-subtle)]">
                  <input
                    type="checkbox"
                    checked={!hidden}
                    disabled={Boolean(def.required)}
                    onChange={(e) => {
                      setDraftLayout((cur) => ({
                        ...cur,
                        hidden: e.target.checked
                          ? cur.hidden.filter((h) => h !== id)
                          : [...cur.hidden, id],
                      }));
                    }}
                  />
                  <span className={cn('flex-1 text-[0.8125rem]', hidden && 'text-[var(--faint-fg)] line-through')}>
                    {def.label}
                    <span className="ml-2 text-[0.7rem] text-[var(--faint-fg)]">{def.excel}</span>
                  </span>
                  <button
                    type="button"
                    className="rounded p-1 text-[var(--muted-fg)] disabled:opacity-30"
                    disabled={i === 0}
                    onClick={() => {
                      setDraftLayout((cur) => {
                        const order = [...cur.order];
                        [order[i - 1], order[i]] = [order[i], order[i - 1]];
                        return { ...cur, order };
                      });
                    }}
                    aria-label="Move up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-[var(--muted-fg)] disabled:opacity-30"
                    disabled={i === draftLayout.order.length - 1}
                    onClick={() => {
                      setDraftLayout((cur) => {
                        const order = [...cur.order];
                        [order[i + 1], order[i]] = [order[i], order[i + 1]];
                        return { ...cur, order };
                      });
                    }}
                    aria-label="Move down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={async () => {
                const r = await saveRegisterLayoutAction(props.branchId, draftLayout.order, draftLayout.hidden);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success('Column layout saved — template will match');
                  setColsOpen(false);
                  router.refresh();
                }
              }}
            >
              Save layout
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setColsOpen(false)}>
              Cancel
            </Button>
          </div>
        </Glass>
      )}

      {closed && (
        <Callout tone="warn" title="This day is closed">
          Entries are read-only until Admin, CMD or CEO reopens the day.
          {props.canConfirmClose && (
            <Button
              className="mt-2"
              variant="glass"
              size="sm"
              onClick={async () => {
                const r = await reopenDayAction(props.branchId, props.today);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success('Day reopened');
                  router.refresh();
                }
              }}
            >
              Reopen day
            </Button>
          )}
        </Callout>
      )}
      {closeRequested && !closed && (
        <Callout tone="warn" title="Close requested — waiting for Admin / Ops">
          The day will not close until Admin, CMD or CEO confirms.
          {props.canConfirmClose && (
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={async () => {
                  const r = await confirmCloseDayAction(props.branchId, props.today, true);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success('Day closed');
                    router.refresh();
                  }
                }}
              >
                Confirm close
              </Button>
              <Button
                variant="glass"
                size="sm"
                onClick={async () => {
                  const r = await confirmCloseDayAction(props.branchId, props.today, false);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success('Close cancelled');
                    router.refresh();
                  }
                }}
              >
                Reject
              </Button>
            </div>
          )}
        </Callout>
      )}

      {props.compiledView && props.branchSwitch && (
        <p className="px-1 text-[0.8125rem] text-[var(--muted-fg)] print:hidden">
          This list is every branch together. Choose one branch to add or change rows.
        </p>
      )}
      {!props.compiledView && props.branchSwitch && props.rows.length === 0 && (
        <p className="px-1 text-[0.8125rem] text-[var(--muted-fg)] print:hidden">
          This branch has no rows yet. Choose All branches to see the existing register.
        </p>
      )}

      {/*
        Print header. Screen-hidden; on paper it is the only thing that says what this sheet is,
        which day it covers and what it adds up to — a printout with no total is a printout the
        counter cannot check itself against.
      */}
      {printScope && (
        <div className="hidden print:block">
          <h1 className="text-[1.1rem] font-semibold">
            Register — {props.branchLabel}
            {printScope === 'selection' ? ` · ${tableRows.length} selected rows` : ''}
          </h1>
          <p className="text-[0.8rem]">
            {DATE_FIELD_LABEL[dateField]}
            {dateFilterOn
              ? `: ${range.from ? formatDMY(range.from) : 'any'} → ${range.to ? formatDMY(range.to) : 'any'}`
              : ': all dates'}
            {agentId ? ` · ${props.agents.find((a) => a.id === agentId)?.name}` : ''} · printed{' '}
            {formatDMY(viewDay)}
          </p>
          <p className="text-[0.8rem] font-semibold">
            {tableRows.length} rows · today ₹
            {inr(tableRows.reduce((a, r) => a + BigInt(r.todayPaise), 0n))} · remaining ₹
            {inr(tableRows.reduce((a, r) => a + BigInt(r.remainingPaise), 0n))}
          </p>
        </div>
      )}

      {/*
        The selection bar. It replaces nothing — it appears under the toolbar the moment a row is
        ticked and states what is ticked before offering to act on it, because "38 rows · ₹4,20,000"
        is the sentence a clerk needs to read before pressing Remove.
      */}
      {/*
        Parks just under the app top bar (h-12) rather than sliding beneath it, and stays ONE
        line: it sticks over the table as you scroll, so a second line would sit on top of the
        column headings — which is exactly what happened when the totals were first added here.
        Everything inside is `whitespace-nowrap` and compact for that reason.
      */}
      {selCount > 0 && (
        <Glass
          className="mf-rise sticky top-[3.25rem] z-20 flex items-center gap-2 overflow-x-auto px-3 py-2 print:hidden"
          // Inline, not a `bg-*` utility: `.glass` is declared outside any @layer and would win.
          // Opaque because this bar parks over the table's sticky header — see --surface-solid.
          style={{ background: 'var(--surface-solid)' }}
        >
          <span className="flex items-center gap-2 pr-1">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1.5 text-[0.72rem] font-semibold tabular-nums text-white">
              {selCount}
            </span>
            <span className="text-[0.8125rem] leading-tight">
              <span className="font-medium">selected</span>
              {selOffView > 0 && (
                <span className="block text-[0.7rem] text-[var(--faint-fg)]">
                  {selOffView} outside this view
                </span>
              )}
            </span>
          </span>

          {/*
            What is actually in the selection, before offering to act on it. A clerk about to
            press Remove or Set today needs the totals in front of them, not just a count —
            "38 rows, ₹4,20,000 still owed, 12 of them due today" is the sentence that decides it.
          */}
          {/*
            Takes the slack and scrolls inside itself. Without `min-w-0 flex-1` the totals push
            into the buttons instead of yielding, and "online ₹0" ends up printed under Excel.
          */}
          <span className="flex min-w-0 flex-1 items-center gap-x-2 overflow-x-auto text-[0.68rem] tabular-nums">
            {(
              [
                ['mat', sel.maturity],
                ['paid', sel.paid],
                ['rem', sel.remaining],
                ['today', sel.today],
                ['cash', sel.cash],
                ['online', sel.online],
              ] as const
            ).map(([label, v]) => (
              <span key={label} className="whitespace-nowrap">
                <span className="text-[var(--faint-fg)]">{label} </span>
                <span className="font-semibold">₹{inr(v)}</span>
              </span>
            ))}
            {sel.dueCount > 0 && (
              <span className="whitespace-nowrap text-[var(--color-brand-600)]">
                <span className="font-semibold">{sel.dueCount}</span> due
              </span>
            )}
          </span>

          <span className="h-6 w-px shrink-0 bg-[var(--hairline)]" aria-hidden />

          <Button className="shrink-0" variant="ghost" size="sm" onClick={() => void exportXlsx('selection')} loading={busy === 'export'}>
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button className="shrink-0" variant="ghost" size="sm" onClick={() => exportCsv('selection')}>
            CSV
          </Button>
          <Button className="shrink-0" variant="ghost" size="sm" onClick={() => doPrint('selection')}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>

          {props.canEdit && !locked && (
            <div className="relative shrink-0">
              <Button
                variant={bulkMenu === 'today' ? 'glass' : 'ghost'}
                size="sm"
                onClick={() => setBulkMenu((m) => (m === 'today' ? null : 'today'))}
                aria-haspopup="dialog"
                aria-expanded={bulkMenu === 'today'}
                loading={busy === 'bulk-today'}
              >
                <Wallet className="h-3.5 w-3.5" />
                Set today
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
              <Popover open={bulkMenu === 'today'} label="Set today's amount on the selected rows">
                <p className="mb-2 text-[0.75rem] text-[var(--muted-fg)]">
                  Set today’s withdrawable on {selCount} {selCount === 1 ? 'row' : 'rows'}. Each row
                  is capped at what it still owes, and the cash / online split follows the branch
                  cash cap.
                </p>
                <div className="space-y-1">
                  {(['perDay', 'remaining', 'clear'] as BulkTodayMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="w-full rounded-[8px] border border-[var(--input-border)] px-2 py-1.5 text-left text-[0.78rem] hover:bg-[var(--glass-bg-subtle)]"
                      onClick={() =>
                        void runBulkAction('bulk-today', 'updated', () =>
                          bulkSetTodayAction(selIds, m),
                        )
                      }
                    >
                      {BULK_TODAY_LABEL[m]}
                    </button>
                  ))}
                </div>
                <form
                  className="mt-2 flex gap-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runBulkAction('bulk-today', 'updated', () =>
                      bulkSetTodayAction(selIds, 'amount', bulkAmount),
                    );
                  }}
                >
                  <Input
                    inputMode="numeric"
                    value={bulkAmount}
                    onChange={(e) => setBulkAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="Same ₹ on each"
                    className="!h-8 !py-1 !text-[0.8125rem] tabular-nums"
                    aria-label="A fixed amount in rupees for every selected row"
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={!bulkAmount}>
                    Set
                  </Button>
                </form>
              </Popover>
            </div>
          )}

          {props.canSubmit && !locked && (
            <Button
              className="shrink-0"
              variant="ghost"
              size="sm"
              loading={busy === 'bulk-form'}
              onClick={() =>
                void runBulkAction('bulk-form', 'marked form in', () =>
                  bulkSetFormSubmittedAction(selIds, true),
                )
              }
              title="Tick “form in” on every selected row"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Form in
            </Button>
          )}



          {props.canEdit && !locked && props.agents.length > 0 && (
            <div className="relative shrink-0">
              <Button
                variant={bulkMenu === 'agent' ? 'glass' : 'ghost'}
                size="sm"
                onClick={() => setBulkMenu((m) => (m === 'agent' ? null : 'agent'))}
                aria-haspopup="dialog"
                aria-expanded={bulkMenu === 'agent'}
                loading={busy === 'bulk-agent'}
              >
                <UserCog className="h-3.5 w-3.5" />
                Agent
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
              <Popover open={bulkMenu === 'agent'} label="Assign the selected rows to an agent">
                <p className="mb-2 text-[0.75rem] text-[var(--muted-fg)]">
                  Move {selCount} {selCount === 1 ? 'row' : 'rows'} to:
                </p>
                <select
                  className="mf-input !h-8 !py-1 !text-[0.8125rem]"
                  value={bulkAgent}
                  onChange={(e) => setBulkAgent(e.target.value)}
                  aria-label="Agent"
                >
                  <option value="">Choose an agent…</option>
                  {props.agents.map((a) => (
                    <option key={a.id} value={a.name}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button
                  className="mt-2 w-full"
                  variant="primary"
                  size="sm"
                  disabled={!bulkAgent}
                  onClick={() =>
                    void runBulkAction('bulk-agent', 'reassigned', () =>
                      bulkAssignAgentAction(selIds, bulkAgent),
                    )
                  }
                >
                  Assign
                </Button>
              </Popover>
            </div>
          )}

          {props.canRemove && !locked && (
            <div className="relative shrink-0">
              <Button
                variant={bulkMenu === 'remove' ? 'danger' : 'ghost'}
                size="sm"
                onClick={() => setBulkMenu((m) => (m === 'remove' ? null : 'remove'))}
                aria-haspopup="dialog"
                aria-expanded={bulkMenu === 'remove'}
                loading={busy === 'bulk-remove'}
                className={bulkMenu === 'remove' ? undefined : 'text-[var(--color-danger-500)]'}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
              <Popover open={bulkMenu === 'remove'} label="Remove the selected rows" width="w-72">
                <p className="text-[0.8125rem] font-semibold">
                  Remove {selCount} {selCount === 1 ? 'row' : 'rows'} from the register?
                </p>
                <p className="mt-1 text-[0.75rem] leading-relaxed text-[var(--muted-fg)]">
                  They stop appearing here but stay in the case history and the audit trail. Any row
                  that has already been paid against cannot be removed — it will be listed back to
                  you.
                </p>
                {sel.paid > 0n && (
                  <p className="mt-1.5 rounded-[7px] bg-[var(--color-warn-500)]/12 px-2 py-1 text-[0.72rem] text-[var(--color-warn-600)]">
                    ₹{inr(sel.paid)} has already been paid across this selection.
                  </p>
                )}
                <Input
                  value={removeReason}
                  onChange={(e) => setRemoveReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="mt-2 !h-8 !py-1 !text-[0.8125rem]"
                  aria-label="Reason for removing these rows"
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy === 'bulk-remove'}
                    onClick={() =>
                      void runBulkAction('bulk-remove', 'removed', async () => {
                        const r = await removeRegisterRowsAction(selIds, removeReason);
                        setRemoveReason('');
                        return r;
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                  <Button className="shrink-0" variant="ghost" size="sm" onClick={() => setBulkMenu(null)}>
                    Cancel
                  </Button>
                </div>
              </Popover>
            </div>
          )}

          <Button className="ml-auto shrink-0" variant="ghost" size="sm" onClick={clearSelection} title="Esc">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </Glass>
      )}

      <div className="overflow-hidden border border-[var(--hairline)] bg-[var(--surface-solid)]">
        {/*
          No `min-w` and no horizontal scroll: `columnsThatFit` has already chosen a set of
          columns that fits the measured width, and anything it could not fit is one click away
          in the row expander. A sheet that scrolls sideways loses the customer's name off the
          left edge exactly when the clerk is reading the cash figure.
        */}
        <div ref={gridRef} className="min-h-[18rem] max-h-[min(66vh,46rem)] overflow-y-auto overflow-x-hidden overscroll-contain">
          <table className="w-full table-fixed border-collapse text-[0.7rem]">
            <thead className="sticky top-0 z-10 bg-[var(--surface-solid)]">
              <tr>
                <th className={cn(th, 'w-7 print:hidden')}>
                  <TriCheckbox
                    checked={allVisibleSelected}
                    indeterminate={visibleSelectedCount > 0}
                    onChange={setAllVisible}
                    label={
                      allVisibleSelected
                        ? `Untick all ${visible.length} rows on this view`
                        : `Tick all ${visible.length} rows on this view`
                    }
                  />
                </th>
                {shownCols.map((c) => (
                  <SortTh
                    key={c.id}
                    label={c.label}
                    hint={c.hint}
                    col={c.id}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    right={c.right}
                    className={c.w}
                  />
                ))}
                {/*
                  Not "Given" — the question is whether the customer came, not how it was handed
                  over. Rendered for every role, including the ones that cannot answer it: this
                  is the column that puts a word next to the green and the red, and a role that
                  saw the colours without it would be looking at a sheet nobody had explained.
                */}
                <th className={cn(th, 'w-16 text-center text-[var(--row-taken-fg)] print:hidden')}>Taken</th>
                <th className={cn(th, 'w-16 text-center text-[var(--row-missed-fg)] print:hidden')}>Not taken</th>
                {hasExtras && <th className={cn(th, 'w-9 print:hidden')} aria-label="More columns" />}
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-[var(--muted-fg)]" colSpan={18}>
                    {dateFilterOn
                      ? `No rows with ${DATE_FIELD_LABEL[dateField].toLowerCase()} ${
                          range.from && range.from === range.to
                            ? formatDMY(range.from)
                            : [range.from ? formatDMY(range.from) : null, range.to ? formatDMY(range.to) : null]
                                .filter(Boolean)
                                .join(' – ')
                        }. Clear the date, or switch the date column.`
                      : q.trim() || agentId
                        ? 'No rows match this filter. Clear the search to see the rest.'
                        : tab === 'due'
                          ? 'Nothing is due today. Open All to see the rest of the register.'
                          : tab !== 'all'
                            ? `No ${TAB_LABEL[tab].toLowerCase()} rows.`
                            : props.compiledView
                              ? 'No rows in the register.'
                              : props.branchSwitch
                                ? 'No rows in this branch. Choose All branches to see the existing register, or type a new row here.'
                                : 'No rows. Add a row or import the Excel template.'}
                  </td>
                </tr>
              )}
              {tableRows.map((r) => {
                const arrears = missedDaysOf(r);
                const missedDays = tab === 'missed' ? arrears : [];
                const arrearsPay = arrears[0] ?? null;
                const daysN = Math.max(1, Number(d(r.id, 'windowDays', String(r.windowDays))) || 1);
                const paidDraft = d(r.id, 'paid', rupeesStr(BigInt(r.paidPaise)));
                const amtDraft = d(r.id, 'amount', rupeesStr(BigInt(r.maturityPaise)));
                const paidP = tryParseRupeesToPaise(paidDraft) ?? BigInt(r.paidPaise);
                const amtP = tryParseRupeesToPaise(amtDraft) ?? BigInt(r.maturityPaise);
                const liveRemaining = amtP > paidP ? amtP - paidP : 0n;
                const selectedInstalment = payoutOnDate(r, viewDay);
                /*
                  What this row is actually going to hand over today, and how it divides.

                  On a scheduled row these come from the engine, and the three cells below are
                  read-only because of it: the ✓ button pays the instalment, so letting a clerk
                  type a different figure into Today would show them one number and hand over
                  another. Changing what a day pays is a change to the SCHEDULE — it has to move
                  the difference onto the remaining days — and that lives on the Plan board,
                  which is what schedule-edit.ts is for.
                */
                const planned = plannedOnDate(r, selectedPayoutDate);
                const scheduled = Boolean(selectedInstalment);
                const rec = recommendedPerDay(liveRemaining, amtP, daysN);
                const selectedInstalmentId = selectedInstalment?.id ?? null;
                const scheduledAmount = selectedInstalment
                  ? BigInt(selectedInstalment.amountPaise)
                  : planned.total;
                const recCash = selectedInstalment
                  ? BigInt(selectedInstalment.cashPaise)
                  : BigInt(r.todayCashPaise);
                const recOnline = selectedInstalment
                  ? BigInt(selectedInstalment.onlinePaise)
                  : BigInt(r.todayOnlinePaise);
                const paidView = paidOnDate(r, viewDay, props.today);
                const edit = props.canEdit && !locked;
                const datesOpen = editDates;
                const matShown = r.instrumentMaturityOn ? formatDMY(r.instrumentMaturityOn) : '';
                const formShown = formatDMY(r.formSubmittedOn);
                const payShown = r.paymentOn ? formatDMY(r.paymentOn) : '';
                const dueNow = isDueToday(r);
                const ticked = Boolean(selected[r.id]);
                const dayState = dayStateOf(r);
                const rowState = rowStateOf(r);

                /*
                  Exactly ONE background class, chosen here rather than layered.
                  Two `bg-*` utilities on the same element do not resolve by the order they
                  appear in the string — they resolve by their order in Tailwind’s generated
                  stylesheet, which nothing in this file controls. So the precedence is decided
                  in JavaScript, where it is readable and cannot silently invert:

                    ticked   — while a selection is live, what is IN it is what the clerk is
                               tracking down the page, whatever else the row says.
                    verdict  — green if they took today’s money, red if they did not.
                    due      — the brand tint for a day still waiting on an answer.
                */
                const tint = ticked
                  ? 'bg-[var(--color-brand-100)]/80 shadow-[inset_3px_0_0_0_var(--color-brand-600)] hover:bg-[var(--color-brand-100)]'
                  : (DAY_TINT[rowState] ??
                    (dueNow
                      ? 'bg-[var(--color-brand-50)]/70 shadow-[inset_3px_0_0_0_var(--color-brand-500)] hover:bg-[var(--color-brand-100)]/70'
                      : ''));

                const row = (
                  <tr
                    key={r.id}
                    data-register-row={r.id}
                    className={cn(
                      'odd:bg-[var(--surface-solid)] even:bg-[var(--glass-bg-subtle)] hover:bg-[color-mix(in_oklab,var(--color-brand-500)_7%,var(--surface-solid))]',
                      tint,
                    )}
                  >
                    <td className={cn(td, 'print:hidden')}>
                      <input
                        type="checkbox"
                        checked={ticked}
                        aria-label={`Select ${r.customerName}`}
                        // React's change event for a checkbox IS the click event underneath, so
                        // the modifier key lives on nativeEvent. Reading it here instead of adding
                        // a second onClick handler keeps one owner of the state — and ticking with
                        // the keyboard still arrives with shiftKey false, which is correct.
                        onChange={(e) => {
                          const native = e.nativeEvent as MouseEvent;
                          toggleRow(r.id, e.target.checked, Boolean(native.shiftKey));
                        }}
                      />
                    </td>
                    {shownCols.map((c) => (
                      <td key={c.id} className={cn(td, c.right && num)}>
                        {c.id === 'account' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            className="tabular-nums"
                            disabled={!edit}
                            value={d(r.id, 'account', r.accountNumber ?? '')}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], account: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === (r.accountNumber ?? '').trim()) return;
                              void save(r.id, { accountNumber: v });
                            }}
                          />
                        )}
                        {c.id === 'customer' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            disabled={!edit}
                            value={d(r.id, 'name', r.customerName)}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], name: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === r.customerName.trim()) return;
                              void save(r.id, { customerName: v });
                            }}
                          />
                        )}
                        {c.id === 'maturityDate' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            className="tabular-nums"
                            disabled={!datesOpen}
                            placeholder="dd/mm/yyyy"
                            value={d(r.id, 'mat', matShown)}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], mat: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === matShown) return;
                              void save(r.id, { instrumentMaturityOn: v.trim() || null });
                            }}
                          />
                        )}
                        {c.id === 'formDate' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            className="tabular-nums"
                            disabled={!datesOpen}
                            placeholder="dd/mm/yyyy"
                            value={d(r.id, 'form', formShown)}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], form: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === formShown) return;
                              void save(r.id, { formSubmittedOn: v.trim() || formShown });
                            }}
                          />
                        )}
                        {c.id === 'paymentDate' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            className="tabular-nums"
                            disabled={!datesOpen}
                            placeholder="dd/mm/yyyy"
                            value={d(r.id, 'pay', payShown)}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], pay: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === payShown) return;
                              void save(r.id, { paymentOn: v.trim() || null });
                            }}
                          />
                        )}
                        {c.id === 'amount' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            group
                            className={num}
                            disabled={!edit}
                            value={amtDraft}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], amount: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === rupeesStr(BigInt(r.maturityPaise))) return;
                              void save(r.id, { maturityRupees: v });
                            }}
                          />
                        )}
                        {c.id === 'paid' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            group
                            className={num}
                            disabled={!edit}
                            value={paidDraft}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], paid: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === rupeesStr(BigInt(r.paidPaise))) return;
                              void save(r.id, { paidRupees: v });
                            }}
                          />
                        )}
                        {c.id === 'remaining' && <span className="font-semibold">{inr(liveRemaining)}</span>}
                        {c.id === 'agent' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            disabled={!edit}
                            value={d(r.id, 'agent', r.agentName)}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], agent: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === r.agentName.trim()) return;
                              void save(r.id, { agentName: v });
                            }}
                          />
                        )}
                        {c.id === 'days' && (
                          <CellInput
                            rowKey={r.id}
                            cellKey={c.id}
                            ariaLabel={`${c.label} for ${r.customerName}`}
                            className="text-center tabular-nums"
                            disabled={!edit}
                            title="Payout days — 12 daily if ₹1 lakh+, 6 alternate if below. Type a custom count to split across that many days."
                            value={d(
                              r.id,
                              'payoutDaysCount',
                              String(
                                (() => {
                                  try {
                                    return payoutPlanFor(amtP, daysN).payoutDays;
                                  } catch {
                                    return daysN;
                                  }
                                })(),
                              ),
                            )}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], payoutDaysCount: v } }))}
                            onCommit={(v) => {
                              const n = Math.max(1, Number(v) || 12);
                              let shown = daysN;
                              try {
                                shown = payoutPlanFor(amtP, daysN).payoutDays;
                              } catch {
                                shown = daysN;
                              }
                              if (n === shown) return;
                              void save(r.id, { windowDays: windowDaysForPayoutCount(amtP, n) });
                            }}
                          />
                        )}
                        {c.id === 'perDay' && (
                          <span
                            className={cn(num, 'flex h-7 items-center justify-end px-1 text-[0.7rem] text-[var(--muted-fg)]')}
                            title="Advice only — remaining money spread over the days that pay. Not today’s due amount."
                          >
                            {inr(rec)}
                          </span>
                        )}
                        {c.id === 'today' &&
                          (scheduled ? (
                            <CellInput
                              rowKey={r.id}
                              cellKey={c.id}
                              ariaLabel={`${c.label} for ${r.customerName}`}
                              group
                              className={cn(num, dayState === 'due' && 'font-semibold text-[var(--color-brand-700)]')}
                              disabled={!props.canSchedule}
                              title="Scheduled amount for this day. Later unpaid days rebalance. You can edit this even after the day is paid."
                              value={d(r.id, 'todayDue', rupeesStr(scheduledAmount))}
                              onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], todayDue: v.replace(/[^0-9]/g, '') } }))}
                              onCommit={(v) => {
                                const original = rupeesStr(scheduledAmount);
                                if (v.trim() === original) return;
                                void savePlannedAmount(r, v, selectedInstalmentId);
                              }}
                            />
                          ) : (
                            <CellInput
                              rowKey={r.id}
                              cellKey={c.id}
                              ariaLabel={`${c.label} for ${r.customerName}`}
                              group
                              className={cn(num, dueNow && 'font-semibold text-[var(--color-brand-700)]')}
                              disabled={!edit}
                              title="No schedule yet — submit the row and the system works this out"
                              value={d(r.id, 'today', rupeesStr(BigInt(r.todayPaise)))}
                              onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], today: v } }))}
                              onCommit={(v) => {
                                if (v.trim() === rupeesStr(BigInt(r.todayPaise))) return;
                                void save(r.id, { todayRupees: v });
                              }}
                            />
                          ))}
                        {c.id === 'cash' && (
                            <CellInput
                              rowKey={r.id}
                              cellKey={c.id}
                              ariaLabel={`${c.label} for ${r.customerName}`}
                              group
                              className={num}
                              disabled={scheduled ? !props.canSchedule : !edit}
                              title="Cash half of this day's schedule"
                              value={d(r.id, 'tcash', rupeesStr(recCash))}
                              onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], tcash: v.replace(/[^0-9]/g, '') } }))}
                              onCommit={(v) => {
                                const onlineNow = d(r.id, 'tonline', rupeesStr(recOnline));
                                if (v.trim() === rupeesStr(recCash) && onlineNow === rupeesStr(recOnline)) return;
                                if (scheduled) void saveLegs(r, v, onlineNow, selectedInstalmentId);
                                else void save(r.id, { todayCashRupees: v, todayOnlineRupees: onlineNow });
                              }}
                            />
                          )}
                        {c.id === 'online' && (
                            <CellInput
                              rowKey={r.id}
                              cellKey={c.id}
                              ariaLabel={`${c.label} for ${r.customerName}`}
                              group
                              className={num}
                              disabled={scheduled ? !props.canSchedule : !edit}
                              title="Online half of this day's schedule"
                              value={d(r.id, 'tonline', rupeesStr(recOnline))}
                              onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], tonline: v.replace(/[^0-9]/g, '') } }))}
                              onCommit={(v) => {
                                const cashNow = d(r.id, 'tcash', rupeesStr(recCash));
                                if (cashNow === rupeesStr(recCash) && v.trim() === rupeesStr(recOnline)) return;
                                if (scheduled) void saveLegs(r, cashNow, v, selectedInstalmentId);
                                else void save(r.id, { todayCashRupees: cashNow, todayOnlineRupees: v });
                              }}
                            />
                          )}
                        {c.id === 'paidToday' && (
                          <CellInput
                            rowKey={r.id} cellKey={c.id} ariaLabel={`${c.label} for ${r.customerName}`}
                            group className={cn(num, 'font-semibold')}
                            disabled={!props.canPay}
                            title={
                              props.canCorrectPay
                                ? 'Correct a recorded amount — you will be asked for a reason'
                                : 'Type what was actually given, then press Taken to confirm'
                            }
                            value={d(r.id, 'paidTodayActual', rupeesStr(paidView.total))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], paidTodayActual: v.replace(/[^0-9]/g, '') } }))}
                            onCommit={(v) => {
                              if (!props.canCorrectPay) return;
                              if (v.trim() === rupeesStr(paidView.total)) return;
                              const total = BigInt(v || '0');
                              const currentOnline = BigInt(d(r.id, 'paidOnlineActual', rupeesStr(paidView.online)) || '0');
                              const online = currentOnline > total ? 0n : currentOnline;
                              void savePaidSplit(r, total - online, online);
                            }}
                          />
                        )}
                        {c.id === 'paidCashToday' && (
                          <CellInput
                            rowKey={r.id} cellKey={c.id} ariaLabel={`${c.label} for ${r.customerName}`}
                            group className={num}
                            disabled={!props.canCorrectPay}
                            value={d(r.id, 'paidCashActual', rupeesStr(paidView.cash))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], paidCashActual: v.replace(/[^0-9]/g, '') } }))}
                            onCommit={(v) => {
                              if (!props.canCorrectPay) return;
                              if (v.trim() === rupeesStr(paidView.cash)) return;
                              const online = BigInt(d(r.id, 'paidOnlineActual', rupeesStr(paidView.online)) || '0');
                              void savePaidSplit(r, BigInt(v || '0'), online);
                            }}
                          />
                        )}
                        {c.id === 'paidOnlineToday' && (
                          <CellInput
                            rowKey={r.id} cellKey={c.id} ariaLabel={`${c.label} for ${r.customerName}`}
                            group className={num}
                            disabled={!props.canCorrectPay}
                            value={d(r.id, 'paidOnlineActual', rupeesStr(paidView.online))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], paidOnlineActual: v.replace(/[^0-9]/g, '') } }))}
                            onCommit={(v) => {
                              if (!props.canCorrectPay) return;
                              if (v.trim() === rupeesStr(paidView.online)) return;
                              const cash = BigInt(d(r.id, 'paidCashActual', rupeesStr(paidView.cash)) || '0');
                              void savePaidSplit(r, cash, BigInt(v || '0'));
                            }}
                          />
                        )}
                      </td>
                    ))}
                    <td className={cn(td, 'print:hidden')} colSpan={2}>
                      <DayMark
                        state={arrearsPay && !r.todayInstalmentId ? 'due' : dayState}
                        instalmentId={r.todayInstalmentId ?? arrearsPay?.id ?? null}
                        hasUnpaid={unpaidPayoutDays(r.payoutDays ?? [], props.today).length > 0}
                        disabled={!props.canPay}
                        busy={paying && payRow?.id === r.id}
                        onPay={() => setPayRow(r)}
                        onNotTaken={(id, clear) => void onNotTaken(id, clear)}
                      />
                    </td>
                    {hasExtras && (
                      <td className={cn(td, 'print:hidden')}>
                        <button
                          type="button"
                          className="h-5 w-full rounded-[5px] text-[0.62rem] font-medium text-[var(--muted-fg)] hover:bg-[var(--glass-bg-strong)] hover:text-[var(--page-fg)]"
                          aria-expanded={Boolean(openExtras[r.id])}
                          title={`${fit.dropped.map((c) => c.label).join(', ')}`}
                          onClick={() => setOpenExtras((s) => ({ ...s, [r.id]: !s[r.id] }))}
                        >
                          {openExtras[r.id] ? '−' : `+${fit.dropped.length}`}
                        </button>
                      </td>
                    )}
                  </tr>
                );
                /*
                  On Not paid, the days themselves — the point of the tab. One line per missed
                  date carrying that day's outstanding amount and its own ✓ / ✗, so marking a
                  Monday that was never taken does not touch Tuesday. The case row above keeps
                  showing today, which is what the cashier settles against.
                */
                return missedDays.length === 0 ? row : (
                  <Fragment key={`m-${r.id}`}>
                    {row}
                    <tr className="border-b border-[var(--hairline)] bg-[var(--glass-bg-subtle)]">
                      <td className={cn(td, 'print:hidden')} />
                      <td colSpan={shownCols.length + 2 + (hasExtras ? 1 : 0)} className="px-2 py-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="text-[0.65rem] font-medium text-[var(--faint-fg)]">
                            Not taken on {missedDays.length === 1 ? 'this day' : `these ${missedDays.length} days`}:
                          </span>
                          {missedDays.map((day) => (
                            <span
                              key={day.id}
                              className="inline-flex items-center gap-2 rounded-[7px] border border-[var(--row-missed-edge)] bg-[var(--glass-bg)] py-0.5 pl-2 pr-0.5"
                            >
                              {canOverrideDates(props.role) ? (
                                <AdminDateCell
                                  kind="instalment"
                                  id={day.id}
                                  value={day.dueOn}
                                  ariaLabel={`Missed payment date for ${r.customerName}`}
                                  className="h-7 text-[0.68rem]"
                                />
                              ) : (
                                <span className="text-[0.68rem] font-medium tabular-nums">{formatDMY(day.dueOn)}</span>
                              )}
                              <span className="text-[0.68rem] font-semibold tabular-nums text-[var(--row-missed-edge)]">
                                ₹{inr(day.outstandingPaise)}
                              </span>
                              <DayMark
                                state={day.status === 'PAID' ? 'taken' : day.status === 'PARTIAL' ? 'partial' : 'due'}
                                instalmentId={day.id}
                                hasUnpaid={leftoverOnPayoutDay(day) > 0n}
                                disabled={!props.canPay}
                                busy={paying && payRow?.id === r.id}
                                onPay={() => setPayRow(r)}
                                onNotTaken={(id, clear) => void onNotTaken(id, clear)}
                              />
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}

              {/*
                The columns this screen was too narrow to hold, for the one row the clerk asked
                about. Rendered as its own row so the table keeps its column widths.
              */}
              {hasExtras &&
                visible
                  .filter((r) => openExtras[r.id])
                  .map((r) => (
                    <tr key={`x-${r.id}`} className="border-b border-[var(--hairline)] bg-[var(--glass-bg-subtle)]">
                      <td className={cn(td, 'print:hidden')} />
                      <td colSpan={shownCols.length + 2} className="px-2 py-1.5">
                        <span className="mr-2 text-[0.65rem] font-medium text-[var(--faint-fg)]">
                          {r.customerName || 'This row'}:
                        </span>
                        <span className="inline-flex flex-wrap gap-x-4 gap-y-1">
                          {fit.dropped.map((c) => (
                            <span key={c.id} className="text-[0.68rem]">
                              <span className="text-[var(--faint-fg)]">{c.label} </span>
                              <span className="font-medium tabular-nums">{String(exportValue(c.id, r) || '—')}</span>
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}

              {/*
                The empty rows. They exist only here — nothing reaches the database until a clerk
                types in one and leaves it. Shown only on the unfiltered "All" view: padding a
                filtered sheet with blanks would put 100 empty rows under "Due today".
              */}
              {blankRowCount > 0 &&
                Array.from({ length: blankRowCount }, (_, i) => (
                  <BlankRow
                    key={`blank-${i}`}
                    cols={shownCols}
                    extrasCol={hasExtras}
                    disabled={!props.canEdit || locked || !props.canCreate}
                    onCommit={async (patch) => {
                      const res = await createRegisterRowWithFieldsAction(props.branchId, patch);
                      if (!res.ok) toast.error(res.error);
                      else router.refresh();
                    }}
                  />
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {props.canRequestClose && !closed && !closeRequested && (
          <Button
            variant="glass"
            onClick={async () => {
              const r = await requestCloseDayAction(props.branchId, props.today);
              if (!r.ok) toast.error(r.error);
              else {
                toast.success('Close requested — waiting for Admin / Ops');
                router.refresh();
              }
            }}
          >
            Save and close today
          </Button>
        )}
        {/*
          The row count and the date range moved up to the filter bar, where the controls that
          set them are. What is left here is the money this view represents — the one figure that
          belongs beside the button that closes the day on it.
        */}
        <p className="text-[0.75rem] text-[var(--faint-fg)]">
          This view · {viewDay === props.today ? 'today' : formatDMY(viewDay)}{' '}
          <span className="font-semibold tabular-nums text-[var(--muted-fg)]">
            ₹{inr(totals.today)}
          </span>{' '}
          · remaining{' '}
          <span className="font-semibold tabular-nums text-[var(--muted-fg)]">
            ₹{inr(totals.remaining)}
          </span>
        </p>
      </div>

      {payRow && (
        <TakePaymentDialog
          row={payRow}
          today={props.today}
          draftPaidRupees={d(payRow.id, 'paidTodayActual', rupeesStr(BigInt(payRow.paidTodayActualPaise)))}
          allowPayAhead={Boolean(props.canCorrectPay)}
          allowCorrectPaid={Boolean(props.canCorrectPay)}
          busy={paying}
          onClose={() => {
            if (!paying) setPayRow(null);
          }}
          onConfirm={confirmPay}
        />
      )}
    </div>
  );
}
