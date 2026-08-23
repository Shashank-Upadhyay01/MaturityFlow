'use client';

import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { saveRegisterLayoutAction } from '@/actions/admin';
import { importRegisterAction } from '@/actions/import';
import {
  addRegisterRowsAction,
  bulkAssignAgentAction,
  bulkSetApprovedAction,
  bulkSetFormSubmittedAction,
  bulkSetTodayAction,
  confirmCloseDayAction,
  markGivenAction,
  removeRegisterRowsAction,
  reopenDayAction,
  requestCloseDayAction,
  saveDayCashAction,
  saveRegisterFieldsAction,
  toggleApprovedAction,
  toggleFormSubmittedAction,
} from '@/actions/register';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { excelCellRaw } from '@/lib/excel-register';
import {
  BULK_TODAY_LABEL,
  DATE_FIELD_LABEL,
  DATE_PRESETS,
  DATE_PRESET_LABEL,
  EMPTY_RANGE,
  SORT_LABEL,
  TAB_LABEL,
  activeDatePreset,
  autoSortFor,
  groupIndian,
  isDueToday,
  isRangeActive,
  resolveDatePreset,
  rowInDateRange,
  summariseDueToday,
  summariseSelection,
  type BulkTodayMode,
  type DateField,
  type DateRange,
  type RegisterTab,
  type SortKey,
} from '@/lib/register-view';
import {
  visibleRegisterCols,
  type RegisterColId,
  type RegisterLayout,
  REGISTER_COL_DEFS,
} from '@/lib/register-layout';
import { formatPaise, tryParseRupeesToPaise } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDMY } from '@/lib/working-days';
import type { Role } from '@/db/schema';

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
}

function inr(p: bigint) {
  return formatPaise(p, { decimals: false, symbol: false });
}
function rupeesStr(p: bigint) {
  return (p / 100n).toString();
}

const th =
  'px-0.5 py-1.5 text-left text-[0.62rem] font-semibold uppercase tracking-[0.04em] text-[var(--faint-fg)] whitespace-nowrap';
const td = 'px-0.5 py-0.5 align-middle';
const num = 'text-right tabular-nums';
const cell =
  'box-border h-7 w-full min-w-0 rounded-[6px] border border-[var(--input-border)] bg-[var(--input-bg)] px-0.5 text-[0.7rem] leading-none text-[var(--page-fg)] outline-none focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60';

function SortTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  right,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortKey) => void;
  right?: boolean;
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={cn(th, right && num, className)}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-[var(--page-fg)]',
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
      value={!focused && group ? groupIndian(value) : value}
      onFocus={() => setFocused(true)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
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

type Tab = RegisterTab;

type ExtraMode = 'today' | 'all';

/** Which bulk popover is open, if any. */
type BulkMenu = 'today' | 'agent' | 'remove' | null;

/** Mirrors MAX_BLANK_ROWS_PER_CALL in register-service. The server enforces the real limit. */
const MAX_ADD_ROWS = 100;

/** Mirrors MAX_BULK_ROWS in register-bulk. The server enforces the real limit. */
const MAX_BULK = 500;

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
  today: string;
  dayStatus: string;
  cashLimitPaise: string;
  cashInHandPaise: string;
  plannedOnlinePaise: string;
  withdrawalsToday: number;
  paidTodayPaise: string;
  canEdit: boolean;
  canPay: boolean;
  canApprove: boolean;
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
  const [tab, setTab] = useState<Tab>(props.canPay && !props.canApprove ? 'due' : props.canApprove ? 'pending' : 'today');
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
  const initialSort = autoSortFor(
    props.canPay && !props.canApprove ? 'due' : props.canApprove ? 'pending' : 'today',
    '',
    'payment',
  );
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort.dir);
  const [colsOpen, setColsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addCount, setAddCount] = useState('5');
  const [draftLayout, setDraftLayout] = useState<RegisterLayout>(props.columnLayout);
  const visCols = visibleRegisterCols(props.columnLayout);

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
    const perDay = (r: RegisterRow) => {
      const rem = asBig(r.remainingPaise);
      const days = Math.max(1, Number(d(r.id, 'windowDays', String(r.windowDays))) || 1);
      return rem / BigInt(days);
    };

    return [...list].sort((a, b) => {
      let c = 0;
      switch (sortKey) {
        case 'formTick':
          c = Number(a.formSubmitted) - Number(b.formSubmitted);
          break;
        case 'approved':
          c = Number(a.approved) - Number(b.approved);
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
          c = cmpBig(asBig(a.todayPaise), asBig(b.todayPaise));
          break;
        case 'cash':
          c = cmpBig(asBig(a.todayCashPaise), asBig(b.todayCashPaise));
          break;
        case 'online':
          c = cmpBig(asBig(a.todayOnlinePaise), asBig(b.todayOnlinePaise));
          break;
        case 'given':
          c = Number(asBig(a.remainingPaise) <= 0n) - Number(asBig(b.remainingPaise) <= 0n);
          break;
      }
      return c * dir;
    });
    },
    [sortKey, sortDir, d],
  );

  const visible = useMemo(() => {
    let list: readonly RegisterRow[] = props.rows;
    if (props.role === 'CASHIER') list = list.filter((r) => r.approved);
    if (tab === 'pending') list = list.filter((r) => !r.approved);
    if (tab === 'today') list = list.filter((r) => BigInt(r.remainingPaise) > 0n);
    if (tab === 'due') list = list.filter(isDueToday);
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
  }, [props.rows, props.role, tab, agentId, q, range, dateField, sortRows]);

  const totals = visible.reduce(
    (a, r) => {
      const remaining = BigInt(r.remainingPaise);
      const days = Math.max(1, Number(d(r.id, 'windowDays', String(r.windowDays))) || 1);
      return {
        maturity: a.maturity + BigInt(r.maturityPaise),
        paid: a.paid + BigInt(r.paidPaise),
        remaining: a.remaining + remaining,
        today:
          a.today +
          (tryParseRupeesToPaise(d(r.id, 'today', rupeesStr(BigInt(r.todayPaise)))) ??
            BigInt(r.todayPaise)),
        rec: a.rec + (remaining > 0n ? remaining / BigInt(days) : 0n),
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
    else router.refresh();
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
      else toast.success(`Imported ${r.data?.created ?? 0} rows`, { description: r.data?.skipped ? `${r.data.skipped} skipped` : undefined });
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
        const rem = BigInt(r.remainingPaise);
        const n = Math.max(1, r.windowDays);
        return rem > 0n ? inr(rem / BigInt(n)) : '0';
      }
      case 'today':
        return inr(BigInt(r.todayPaise));
      case 'cash':
        return inr(BigInt(r.todayCashPaise));
      case 'online':
        return inr(BigInt(r.todayOnlinePaise));
    }
  }

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
      wb.creator = 'MaturityFlow';
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

  const locked = closed;
  const liveCount = props.rows.filter((r) => BigInt(r.remainingPaise) > 0n).length;

  return (
    <div className="space-y-3 print:space-y-2">
      <Glass className="print:hidden">
        {/* Row 1 — identity, view, and the actions that change data. */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="mr-auto min-w-0 max-w-[15rem] pr-1">
            <h1 className="truncate text-[1.125rem] font-semibold leading-tight tracking-[-0.02em]">
              Register
            </h1>
            <p className="truncate text-[0.75rem] text-[var(--muted-fg)]">
              {props.branchLabel}
              <span className="text-[var(--faint-fg)]">
                {' '}
                · {liveCount} live / {props.rows.length}
              </span>
            </p>
          </div>

          <div className="flex rounded-[10px] border border-[var(--input-border)] p-0.5">
            {(['due', 'today', 'pending', 'all'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => applyFilter({ tab: t })}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[0.8125rem] whitespace-nowrap',
                  tab === t
                    ? 'bg-[var(--glass-bg-strong)] font-medium text-[var(--page-fg)]'
                    : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
                  t === 'due' && tab !== t && dueStats.count > 0 && 'text-[var(--color-brand-600)]',
                )}
              >
                {TAB_LABEL[t]}
                {t === 'due' && dueStats.count > 0 && (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-px text-[0.65rem] font-semibold tabular-nums',
                      tab === t
                        ? 'bg-[var(--color-brand-500)] text-white'
                        : 'bg-[var(--color-brand-100)] text-[var(--color-brand-700)]',
                    )}
                  >
                    {dueStats.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <label className="relative min-w-[7.5rem] max-w-[11rem] flex-1">
            <span className="sr-only">Search name, account or agent</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, A/c, agent"
              className="!h-9 !py-1.5 pl-8 !text-[0.8125rem] !leading-none"
            />
          </label>

          <label className="min-w-[7rem] max-w-[9.5rem] flex-1">
            <span className="sr-only">Filter by agent</span>
            <select
              className="mf-input !h-9 !py-1.5 !text-[0.8125rem] !leading-none"
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
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const n = Number(addCount);
                      if (!Number.isFinite(n) || n < 1) return toast.error('Enter a number of rows.');
                      if (n > MAX_ADD_ROWS) return toast.error(`At most ${MAX_ADD_ROWS} rows at a time.`);
                      setBusy('add');
                      const r = await addRegisterRowsAction(props.branchId, n);
                      setBusy(null);
                      if (!r.ok) toast.error(r.error);
                      else {
                        toast.success(
                          r.data?.added === 1 ? 'Row added' : `${r.data?.added ?? n} rows added`,
                        );
                        setAddOpen(false);
                        router.refresh();
                      }
                    }}
                  >
                    <Input
                      autoFocus
                      inputMode="numeric"
                      value={addCount}
                      onChange={(e) => setAddCount(e.target.value.replace(/[^\d]/g, ''))}
                      className="!h-8 !py-1 text-center !text-[0.8125rem] tabular-nums"
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

        {/* Row 2 — pick a day or a span of days, and see the sort that choice implies. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--hairline)] px-3 py-2">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)]" aria-hidden />
          <select
            className="mf-input !h-8 !w-auto !py-1 !text-[0.78rem] !leading-none"
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
            One control, two shapes. Setting only "from" narrows to a single day — the common
            case, and what the Today / Tomorrow chips write — while filling both gives a span.
            The chips and the boxes are the same state, so a preset always shows you the dates
            it actually applied rather than hiding them behind a label.
          */}
          <div className="flex items-center gap-1">
            <input
              type="date"
              className="mf-input !h-8 !w-auto !py-1 !text-[0.78rem] !leading-none tabular-nums"
              value={range.from}
              max={range.to || undefined}
              onChange={(e) => applyFilter({ range: { from: e.target.value, to: range.to } })}
              aria-label="From date"
              title="From this date"
            />
            <span className="text-[0.78rem] text-[var(--faint-fg)]">→</span>
            <input
              type="date"
              className="mf-input !h-8 !w-auto !py-1 !text-[0.78rem] !leading-none tabular-nums"
              value={range.to}
              min={range.from || undefined}
              onChange={(e) => applyFilter({ range: { from: range.from, to: e.target.value } })}
              aria-label="To date"
              title="To this date — leave empty for a single day"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {DATE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  applyFilter({
                    range: preset === p ? EMPTY_RANGE : resolveDatePreset(p, props.today),
                  })
                }
                aria-pressed={preset === p}
                className={cn(
                  'h-8 rounded-[8px] border border-[var(--input-border)] px-2.5 text-[0.78rem] whitespace-nowrap',
                  preset === p
                    ? 'bg-[var(--glass-bg-strong)] font-medium text-[var(--page-fg)]'
                    : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
                  p === 'overdue' && preset !== p && 'text-[var(--color-warn-600)]',
                )}
              >
                {DATE_PRESET_LABEL[p]}
              </button>
            ))}
            {dateFilterOn && (
              <button
                type="button"
                onClick={() => applyFilter({ range: EMPTY_RANGE })}
                className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[0.78rem] text-[var(--muted-fg)] hover:text-[var(--page-fg)]"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {props.canImport && (
              <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="Download a blank Excel template">
                <a href={`/api/export/template?branch=${props.branchId}`} aria-label="Download blank Excel template">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
              className="h-8 w-8"
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
                className="h-8 w-8"
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
            <span className="mx-0.5 h-5 w-px bg-[var(--hairline)]" aria-hidden />
            <span className="text-[0.72rem] text-[var(--faint-fg)]">Sorted by</span>
            <select
              className="mf-input !h-8 !w-auto !py-1 !text-[0.78rem] !leading-none"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort column"
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
              className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[var(--input-border)] px-2 text-[0.78rem] text-[var(--muted-fg)] hover:text-[var(--page-fg)]"
            >
              {sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              {sortDir === 'asc' ? 'Low → high' : 'High → low'}
            </button>
          </div>
        </div>

        {/* Row 3 — today's obligation, stated once and stated loudly. */}
        <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2 border-t border-[var(--hairline)] px-3 py-2.5">
          <button
            type="button"
            onClick={() => applyFilter({ tab: 'due', range: EMPTY_RANGE })}
            title="Show only these rows"
            className={cn(
              'flex items-center gap-3 rounded-[10px] border-l-[3px] py-1 pl-2.5 pr-3 text-left transition-colors',
              dueStats.count > 0
                ? 'border-l-[var(--color-brand-500)] bg-[var(--color-brand-50)] hover:bg-[var(--color-brand-100)]'
                : 'border-l-[var(--hairline)] hover:bg-[var(--glass-bg-subtle)]',
            )}
          >
            <span>
              <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-[var(--color-brand-700)]">
                Due today
              </span>
              <span className="block text-[0.78rem] leading-tight text-[var(--muted-fg)]">
                <span className="font-semibold tabular-nums text-[var(--page-fg)]">{dueStats.count}</span>{' '}
                {dueStats.count === 1 ? 'withdrawal' : 'withdrawals'}
              </span>
            </span>
            <span className="border-l border-[var(--hairline)] pl-3">
              <span className="block text-[1.35rem] font-semibold leading-none tabular-nums text-[var(--page-fg)]">
                ₹{inr(dueStats.total)}
              </span>
              <span className="block pt-1 text-[0.68rem] leading-none text-[var(--faint-fg)]">
                cash ₹{inr(dueStats.cash)} · online ₹{inr(dueStats.online)}
              </span>
            </span>
          </button>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
            <span>
              <span className="text-[var(--faint-fg)]">Given today</span>{' '}
              <span className="font-semibold tabular-nums text-[var(--color-money-500)]">
                {props.withdrawalsToday} · ₹{inr(paidTodayP)}
              </span>
            </span>
            <span>
              <span className="text-[var(--faint-fg)]">Still to give</span>{' '}
              <span className="font-semibold tabular-nums">₹{inr(stillToGive)}</span>
            </span>
            {dueStats.unsetCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  applyFilter({
                    tab: 'all',
                    range: resolveDatePreset('today', props.today),
                    dateField: 'payment',
                  })
                }
                className="rounded-[7px] bg-[var(--color-warn-500)]/12 px-2 py-0.5 text-[0.75rem] text-[var(--color-warn-600)] hover:bg-[var(--color-warn-500)]/20"
                title="Payment date is today but no amount has been set for today"
              >
                {dueStats.unsetCount} dated today with no amount set
              </button>
            )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.8125rem]">
            {agentTotals ? (
              <>
                <span className="font-medium">{props.agents.find((a) => a.id === agentId)?.name}</span>
                <span>
                  <span className="text-[var(--faint-fg)]">Live</span>{' '}
                  <span className="tabular-nums">{agentTotals.live}</span>
                  <span className="text-[var(--faint-fg)]">/{agentTotals.n}</span>
                </span>
                <span>
                  <span className="text-[var(--faint-fg)]">Remaining</span>{' '}
                  <span className="font-semibold tabular-nums">₹{inr(agentTotals.remaining)}</span>
                </span>
                <span>
                  <span className="text-[var(--faint-fg)]">Paid</span>{' '}
                  <span className="tabular-nums text-[var(--color-money-500)]">₹{inr(agentTotals.paid)}</span>
                </span>
              </>
            ) : (
              <>
                <span>
                  <span className="text-[var(--faint-fg)]">Maturity</span>{' '}
                  <span className="font-semibold tabular-nums">₹{inr(totals.maturity)}</span>
                </span>
                <span>
                  <span className="text-[var(--faint-fg)]">Paid</span>{' '}
                  <span className="font-semibold tabular-nums text-[var(--color-money-500)]">₹{inr(totals.paid)}</span>
                </span>
                <span>
                  <span className="text-[var(--faint-fg)]">Remaining</span>{' '}
                  <span className="font-semibold tabular-nums">₹{inr(totals.remaining)}</span>
                </span>
              </>
            )}
          </div>
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
          Entries are read-only until Admin or Operations Head reopens the day.
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
          The day will not close until Admin or Operations Head confirms.
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
            {formatDMY(props.today)}
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
      {selCount > 0 && (
        <Glass className="mf-rise sticky top-1 z-20 flex flex-wrap items-center gap-2 px-3 py-2 print:hidden">
          <span className="flex items-center gap-2 pr-1">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1.5 text-[0.72rem] font-semibold tabular-nums text-white">
              {selCount}
            </span>
            <span className="text-[0.8125rem] leading-tight">
              <span className="font-medium">selected</span>
              <span className="block text-[0.7rem] text-[var(--faint-fg)] tabular-nums">
                remaining ₹{inr(sel.remaining)} · today ₹{inr(sel.today)}
                {selOffView > 0 && ` · ${selOffView} outside this view`}
              </span>
            </span>
          </span>

          <span className="h-6 w-px bg-[var(--hairline)]" aria-hidden />

          <Button variant="ghost" size="sm" onClick={() => void exportXlsx('selection')} loading={busy === 'export'}>
            <Download className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => exportCsv('selection')}>
            CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => doPrint('selection')}>
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>

          {props.canEdit && !locked && (
            <div className="relative">
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

          {props.canApprove && !locked && (
            <Button
              variant="ghost"
              size="sm"
              loading={busy === 'bulk-appr'}
              onClick={() =>
                void runBulkAction('bulk-appr', 'approved', () => bulkSetApprovedAction(selIds, true))
              }
              title="Approve every selected row"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Approve
            </Button>
          )}

          {props.canEdit && !locked && props.agents.length > 0 && (
            <div className="relative">
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
            <div className="relative">
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
                  <Button variant="ghost" size="sm" onClick={() => setBulkMenu(null)}>
                    Cancel
                  </Button>
                </div>
              </Popover>
            </div>
          )}

          <Button variant="ghost" size="sm" className="ml-auto" onClick={clearSelection} title="Esc">
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </Glass>
      )}

      <Glass className="overflow-hidden">
        <div className="mf-hscroll min-h-[18rem] max-h-[min(66vh,46rem)]">
          <table className="w-full min-w-[72rem] table-fixed border-collapse text-[0.7rem]">
            <thead className="sticky top-0 z-10 bg-[var(--glass-bg-strong)] backdrop-blur-md">
              <tr className="border-b border-[var(--hairline)]">
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
                {props.canSubmit && (
                  <SortTh label="Form" col="formTick" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-10 print:hidden" />
                )}
                {props.canApprove && (
                  <SortTh label="Appr." col="approved" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-10 print:hidden" />
                )}
                {visCols.map((c) => (
                  <SortTh
                    key={c.id}
                    label={c.label}
                    col={c.id}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    right={c.right}
                    className={c.w}
                  />
                ))}
                {props.canPay && (
                  <SortTh label="Given" col="given" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="print:hidden" />
                )}
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-[var(--muted-fg)]" colSpan={18}>
                    {dateFilterOn || q.trim() || agentId
                      ? 'No rows match this filter. Clear the date or the search to see the rest.'
                      : 'No rows. Add a row or import the Excel template.'}
                  </td>
                </tr>
              )}
              {tableRows.map((r) => {
                const remaining = BigInt(r.remainingPaise);
                const daysN = Math.max(1, Number(d(r.id, 'windowDays', String(r.windowDays))) || 1);
                const rec = remaining > 0n ? remaining / BigInt(daysN) : 0n;
                const paidDraft = d(r.id, 'paid', rupeesStr(BigInt(r.paidPaise)));
                const amtDraft = d(r.id, 'amount', rupeesStr(BigInt(r.maturityPaise)));
                const paidP = tryParseRupeesToPaise(paidDraft) ?? BigInt(r.paidPaise);
                const amtP = tryParseRupeesToPaise(amtDraft) ?? BigInt(r.maturityPaise);
                const liveRemaining = amtP > paidP ? amtP - paidP : 0n;
                const recCash = BigInt(r.todayCashPaise);
                const recOnline = BigInt(r.todayOnlinePaise);
                const edit = props.canEdit && !locked;
                const pay = props.canPay && !locked && r.approved && remaining > 0n;
                const matShown = r.instrumentMaturityOn ? formatDMY(r.instrumentMaturityOn) : '';
                const formShown = formatDMY(r.formSubmittedOn);
                const payShown = r.paymentOn ? formatDMY(r.paymentOn) : '';
                const dueNow = isDueToday(r);
                const ticked = Boolean(selected[r.id]);
                return (
                  <tr
                    key={r.id}
                    className={cn(
                      'border-b border-[var(--hairline)] hover:bg-[var(--glass-bg-subtle)]',
                      dueNow &&
                        'bg-[var(--color-brand-50)]/70 shadow-[inset_3px_0_0_0_var(--color-brand-500)] hover:bg-[var(--color-brand-100)]/70',
                      // Ticked wins over "due today": while a selection is live, what is IN it is
                      // the thing the clerk is tracking down the page.
                      ticked &&
                        'bg-[var(--color-brand-100)]/80 shadow-[inset_3px_0_0_0_var(--color-brand-600)] hover:bg-[var(--color-brand-100)]',
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
                    {props.canSubmit && (
                      <td className={cn(td, 'print:hidden')}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={r.formSubmitted}
                          onChange={async (e) => {
                            const res = await toggleFormSubmittedAction(r.id, e.target.checked);
                            if (!res.ok) toast.error(res.error);
                            else router.refresh();
                          }}
                        />
                      </td>
                    )}
                    {props.canApprove && (
                      <td className={cn(td, 'print:hidden')}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={r.approved}
                          onChange={async (e) => {
                            const res = await toggleApprovedAction(r.id, e.target.checked);
                            if (!res.ok) toast.error(res.error);
                            else router.refresh();
                          }}
                        />
                      </td>
                    )}
                    {visCols.map((c) => (
                      <td key={c.id} className={cn(td, c.right && num)}>
                        {c.id === 'account' && (
                          <CellInput
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
                            className="tabular-nums"
                            disabled={!edit}
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
                            className="tabular-nums"
                            disabled={!edit}
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
                            className="tabular-nums"
                            disabled={!edit}
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
                            className="text-center tabular-nums"
                            disabled={!edit}
                            value={d(r.id, 'windowDays', String(r.windowDays))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], windowDays: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === String(r.windowDays)) return;
                              void save(r.id, { windowDays: Number(v) || 15 });
                            }}
                          />
                        )}
                        {c.id === 'perDay' && <span className="text-[var(--muted-fg)]">{inr(rec)}</span>}
                        {c.id === 'today' && (
                          <CellInput
                            group
                            className={cn(num, dueNow && 'font-semibold text-[var(--color-brand-700)]')}
                            disabled={!edit}
                            value={d(r.id, 'today', rupeesStr(BigInt(r.todayPaise)))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], today: v } }))}
                            onCommit={(v) => {
                              if (v.trim() === rupeesStr(BigInt(r.todayPaise))) return;
                              void save(r.id, { todayRupees: v });
                            }}
                          />
                        )}
                        {c.id === 'cash' && (
                          <CellInput
                            group
                            className={num}
                            disabled={!edit}
                            title="Cash for today"
                            value={d(r.id, 'tcash', rupeesStr(recCash))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], tcash: v } }))}
                            onCommit={(v) => {
                              const onlineNow = d(r.id, 'tonline', rupeesStr(recOnline));
                              if (v.trim() === rupeesStr(recCash) && onlineNow === rupeesStr(recOnline)) return;
                              void save(r.id, { todayCashRupees: v, todayOnlineRupees: onlineNow });
                            }}
                          />
                        )}
                        {c.id === 'online' && (
                          <CellInput
                            group
                            className={num}
                            disabled={!edit}
                            title="Online for today"
                            value={d(r.id, 'tonline', rupeesStr(recOnline))}
                            onChange={(v) => setDraft((s) => ({ ...s, [r.id]: { ...s[r.id], tonline: v } }))}
                            onCommit={(v) => {
                              const cashNow = d(r.id, 'tcash', rupeesStr(recCash));
                              if (cashNow === rupeesStr(recCash) && v.trim() === rupeesStr(recOnline)) return;
                              void save(r.id, { todayCashRupees: cashNow, todayOnlineRupees: v });
                            }}
                          />
                        )}
                      </td>
                    ))}
                    {props.canPay && (
                      <td className={cn(td, 'print:hidden')}>
                        {pay ? (
                          <div className="flex flex-wrap gap-1">
                            <button type="button" className="text-[0.65rem] text-[var(--muted-fg)]" onClick={() => void markGivenAction(r.id, 'CASH').then((res) => { if (!res.ok) toast.error(res.error); else { toast.success('Marked cash given'); router.refresh(); } })}>Cash</button>
                            <button type="button" className="text-[0.65rem] text-[var(--muted-fg)]" onClick={() => void markGivenAction(r.id, 'ONLINE').then((res) => { if (!res.ok) toast.error(res.error); else { toast.success('Marked online given'); router.refresh(); } })}>Online</button>
                            <button type="button" className="text-[0.65rem] font-medium" onClick={() => void markGivenAction(r.id, 'SPLIT').then((res) => { if (!res.ok) toast.error(res.error); else { toast.success('Marked given'); router.refresh(); } })}>Both</button>
                          </div>
                        ) : r.approved ? (
                          <Badge tone="money">done</Badge>
                        ) : (
                          <span className="text-[var(--faint-fg)]">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Glass>

      <Glass className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--muted-fg)]">
          Cash in hand today (approx)
          <Input
            value={cashHand}
            disabled={!props.canSetCash || locked}
            onChange={(e) => setCashHand(e.target.value)}
            onBlur={async () => {
              const r = await saveDayCashAction(props.branchId, props.today, cashHand, onlinePlan);
              if (!r.ok) toast.error(r.error);
              else router.refresh();
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] text-[var(--muted-fg)]">
          Sending via online transfer
          <Input
            value={onlinePlan}
            disabled={!props.canSetCash || locked}
            onChange={(e) => setOnlinePlan(e.target.value)}
            onBlur={async () => {
              const r = await saveDayCashAction(props.branchId, props.today, cashHand, onlinePlan);
              if (!r.ok) toast.error(r.error);
              else router.refresh();
            }}
          />
        </label>
        <div>
          <div className="mb-1 flex items-center justify-between text-[0.75rem] text-[var(--muted-fg)]">
            Short of cash
            <span className="flex rounded-[8px] border border-[var(--input-border)] p-0.5">
              {(['today', 'all'] as ExtraMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={cn('rounded-[6px] px-2 py-0.5 text-[0.7rem]', extraMode === m && 'bg-[var(--glass-bg-strong)]')}
                  onClick={() => setExtraMode(m)}
                >
                  {m === 'today' ? 'Today' : 'All'}
                </button>
              ))}
            </span>
          </div>
          <p className="text-[1.25rem] font-semibold tabular-nums">₹{inr(extraAfterCash)}</p>
          <p className="text-[0.7rem] text-[var(--faint-fg)]">
            {extraMode === 'today' ? "This view's today total" : dateFilterOn ? "This view's remaining" : 'All remaining'}{' '}
            minus cash in hand
          </p>
        </div>
        <div>
          <p className="mb-1 text-[0.75rem] text-[var(--muted-fg)]">Extra opening to arrange</p>
          <p className="text-[1.25rem] font-semibold tabular-nums">₹{inr(extraOpening)}</p>
          <p className="text-[0.7rem] text-[var(--faint-fg)]">
            Still short once the online transfer lands
          </p>
        </div>
      </Glass>

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
        <p className="text-[0.75rem] text-[var(--faint-fg)]">
          {visible.length} of {props.rows.length} rows
          {dateFilterOn && (
            <>
              {' '}
              · {DATE_FIELD_LABEL[dateField].toLowerCase()}{' '}
              {range.from && range.to && range.from === range.to
                ? formatDMY(range.from)
                : `${range.from ? formatDMY(range.from) : 'any'} → ${range.to ? formatDMY(range.to) : 'any'}`}
            </>
          )}{' '}
          · today ₹{inr(totals.today)} · remaining ₹{inr(totals.remaining)}
          {selCount > 0 && ` · ${selCount} selected`}
        </p>
      </div>
    </div>
  );
}
