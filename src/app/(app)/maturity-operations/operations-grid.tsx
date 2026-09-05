'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Columns3, ExternalLink, FileSpreadsheet, Search, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { setInstalmentAmountAction } from '@/actions/cases';
import {
  createRegisterRowWithFieldsAction,
  markNotTakenAction,
  markTakenAction,
  saveRegisterFieldsAction,
  settleRegisterRowAction,
} from '@/actions/register';
import { DEFAULT_OPERATIONS_MATURITY_ON } from '@/lib/maturity-operations';
import {
  blankRowCount,
  cellAddress,
  cellInSelection,
  cellKey,
  columnLetter,
  fillDownPairs,
  fillRightPairs,
  growSheetLength,
  INITIAL_SHEET_ROWS,
  initialSheetLength,
  jumpToEdge,
  identifiesNewRow,
  matchSheetShortcut,
  MAX_PASTE_ROWS,
  MAX_SHEET_ROWS,
  normalizeRange,
  parseClipboardGrid,
  pasteIsoDate,
  pasteRupees,
  rangeKeys,
  rowMatchesFilter,
  selectionBounds,
  serializeClipboardGrid,
  toggleCellInSelection,
  unionSelection,
  type SheetRange,
} from '@/lib/sheet-grid';
import { cn } from '@/lib/utils';

export interface OperationsRow {
  id: string;
  accountNumber: string;
  customerName: string;
  agentName: string;
  maturityRupees: string;
  maturityOn: string;
  formSubmittedOn: string;
  opsReviewedOn: string;
  paymentOn: string;
  duePaise: string;
  recommendedPaise: string;
  /** Maturity minus everything actually paid. Missed days never reduce it. */
  remainingPaise: string;
  /** Cash and online handed over across the whole case so far. */
  paidPaise: string;
  /** Earlier due days still carrying money — the rolling arrears behind this row. */
  missedPaise: string;
  paidTodayPaise: string;
  paidCashTodayPaise: string;
  paidOnlineTodayPaise: string;
  todayInstalmentId: string | null;
  todayOnlineDuePaise: string;
  todayState: 'DUE' | 'PAID' | 'MISSED' | 'NONE';
  needsReview: boolean;
}

/**
 * The Maturities sheet, left to right, as the office fixed it.
 *
 * Read as a sentence: who the customer is, what matured and when, the three dates the case moves
 * through, then the money — what is still owed, what has gone out, what was missed, what today
 * asks for, and what the two of those add up to. Actual paid is the only money cell that takes a
 * figure; Given is the control that commits it.
 *
 * Cash / online legs and the recommended figure are deliberately not here. They are reference
 * numbers a clerk can derive, and every column past the first screenful costs a horizontal
 * scroll on a branch monitor.
 */
const COLUMNS = [
  ['account', 'Account number'], ['customer', 'Customer name'], ['agent', 'Agent name'],
  ['amount', 'Maturity amount'], ['maturity', 'Maturity date'], ['form', 'Form submission date'],
  ['review', 'Approval date'], ['payment', 'Payment date'],
  ['remaining', 'Remaining'], ['paid', 'Paid'], ['missed', 'Missed amount'],
  ['due', "Today's amount"], ['total', 'Total amount'], ['paidToday', 'Actual paid'],
  ['given', 'Given'],
] as const;
type ColumnId = (typeof COLUMNS)[number][0];

/** Identity and date fields bulk shortcuts may write. Paid / Taken move money — not Delete or Ctrl+D. */
const BULK_EDIT = new Set<ColumnId>(['account', 'customer', 'agent', 'amount', 'maturity', 'form', 'review', 'payment']);

function wholeCellSelected(input: HTMLInputElement) {
  if (input.value === '') return true;
  return input.selectionStart === 0 && input.selectionEnd === input.value.length;
}

const rupees = (paise: string) => {
  try {
    return (BigInt(paise || '0') / 100n).toString();
  } catch {
    return '0';
  }
};
const inputClass = 'h-9 w-full min-w-0 rounded-none border-0 bg-transparent px-1.5 text-[0.7rem] font-medium leading-none text-[var(--page-fg)] outline-none focus:bg-[var(--color-brand-50)] focus:shadow-[inset_0_0_0_2px_var(--ring)] disabled:cursor-default disabled:opacity-75 xl:px-2 xl:text-[0.78rem]';
const head = 'sticky top-0 z-20 h-11 border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--surface-solid))] px-1 py-1.5 text-left text-[0.58rem] font-extrabold uppercase leading-[1.15] tracking-[0.015em] text-[var(--page-fg)] xl:px-1.5 xl:text-[0.65rem]';
const cell = 'border border-[var(--hairline)] p-0 align-middle';

type RegisterPatch = Parameters<typeof saveRegisterFieldsAction>[1];

function blankPatch(vals: Record<string, string>): RegisterPatch | null {
  const patch: RegisterPatch = {};
  const account = vals.account?.trim();
  if (account) patch.accountNumber = account;
  const customer = vals.customer?.trim();
  if (customer) patch.customerName = customer;
  const agent = vals.agent?.trim();
  if (agent) patch.agentName = agent;
  const amount = pasteRupees(vals.amount ?? '');
  if (amount) patch.maturityRupees = amount;
  if (vals.maturity?.trim()) {
    const iso = pasteIsoDate(vals.maturity);
    if (iso) patch.instrumentMaturityOn = iso;
  }
  if (vals.form?.trim()) {
    const iso = pasteIsoDate(vals.form);
    if (iso) patch.formSubmittedOn = iso;
  }
  if (vals.review?.trim()) {
    const iso = pasteIsoDate(vals.review);
    if (iso) patch.opsReviewedOn = iso;
  }
  if (vals.payment?.trim()) {
    const iso = pasteIsoDate(vals.payment);
    if (iso) patch.paymentOn = iso;
  }
  if (Object.keys(patch).length === 0) return null;
  // Amounts and dates alone do not make a case — see identifiesNewRow. Without this a pasted
  // block with an empty name column quietly became a run of "New customer" rows.
  if (!identifiesNewRow(patch)) return null;
  if (patch.instrumentMaturityOn == null) patch.instrumentMaturityOn = DEFAULT_OPERATIONS_MATURITY_ON;
  return patch;
}

function EditableCell({ row, col, rowIndex, value, type = 'text', disabled, selected, persist = true, onCommit, onDraftChange, onGrowDown, onMove }: {
  row: string;
  col: string;
  rowIndex: number;
  value: string;
  type?: 'text' | 'date' | 'money';
  disabled: boolean;
  selected?: boolean;
  persist?: boolean;
  onCommit: (value: string) => Promise<void>;
  onDraftChange?: (value: string) => void;
  onGrowDown?: (nextIndex: number, col: string, shift: boolean) => void;
  onMove?: (nextIndex: number, col: string, shift: boolean) => void;
}) {
  /*
    When the committed value changes underneath this cell — a save came back, a paste rewrote it,
    an undo replayed it — the draft has to follow. Doing that in an effect means React renders the
    stale value once, then re-renders; React's own guidance is to adjust the state during render
    instead, which it re-runs immediately without committing the intermediate paint.
  */
  const [draft, setDraft] = useState(value);
  const [committedValue, setCommittedValue] = useState(value);
  if (committedValue !== value) {
    setCommittedValue(value);
    setDraft(value);
  }
  const commit = async () => { if (persist && draft !== value) await onCommit(draft); };

  return (
    <input
      data-ops-cell="true" data-ops-row={row} data-ops-col={col} data-ops-index={rowIndex} data-ops-committed={value} data-ops-selected={selected ? 'true' : undefined}
      className={cn(
        inputClass,
        type === 'money' && 'font-mono text-[0.64rem] font-semibold text-right tabular-nums xl:text-[0.72rem]',
        type === 'date' && 'px-1 font-mono text-[0.625rem] tabular-nums xl:text-[0.6875rem]',
        col === 'account' && 'font-mono text-[0.65rem] tabular-nums xl:text-[0.72rem]',
        selected && 'bg-[color-mix(in_oklab,var(--color-brand-500)_22%,transparent)]',
      )}
      type={type === 'date' ? 'date' : 'text'} inputMode={type === 'money' ? 'numeric' : undefined}
      value={draft} title={draft} disabled={disabled}
      onPointerDown={(event) => {
        // FocusEvent has no shiftKey — capture modifiers here so Shift/Ctrl-click can select.
        if (event.shiftKey || event.ctrlKey || event.metaKey) event.preventDefault();
      }}
      onFocus={(event) => {
        if (event.currentTarget.dataset.opsSkipSelect === '1') {
          delete event.currentTarget.dataset.opsSkipSelect;
          return;
        }
        event.currentTarget.select();
      }}
      onChange={(event) => {
        const next = type === 'money' ? event.target.value.replace(/[^0-9]/g, '') : event.target.value;
        setDraft(next);
        onDraftChange?.(next);
      }}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setDraft(value); onDraftChange?.(value); return; }
        if (event.ctrlKey || event.metaKey) return;
        const direction = event.key === 'Enter' ? 'ArrowDown' : event.key;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key) && event.key !== 'Enter') return;
        if (event.key === 'Tab') {
          // Tab stays native (next input). From the last cell, grow a row so Tab does not leave the sheet.
          const table = event.currentTarget.closest('table');
          if (!table || event.shiftKey) return;
          const all = Array.from(table.querySelectorAll<HTMLInputElement>('input[data-ops-cell="true"]:not(:disabled)'));
          const at = all.indexOf(event.currentTarget);
          if (at >= 0 && at === all.length - 1) {
            event.preventDefault();
            onGrowDown?.(rowIndex + 1, col, false);
          }
          return;
        }
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(direction)) return;
        event.preventDefault();
        event.stopPropagation();
        const table = event.currentTarget.closest('table');
        if (!table) return;
        const all = Array.from(table.querySelectorAll<HTMLInputElement>('input[data-ops-cell="true"]:not(:disabled)'));
        const peers = direction === 'ArrowUp' || direction === 'ArrowDown'
          ? all.filter((el) => el.dataset.opsCol === col)
          : all.filter((el) => el.dataset.opsRow === row);
        const delta = direction === 'ArrowUp' || direction === 'ArrowLeft' ? -1 : 1;
        const next = peers[peers.indexOf(event.currentTarget) + delta];
        if (!next && direction === 'ArrowDown') {
          onGrowDown?.(rowIndex + 1, col, event.shiftKey);
          return;
        }
        if (!next) return;
        const nextIndex = Number(next.dataset.opsIndex);
        const nextCol = next.dataset.opsCol ?? col;
        onMove?.(Number.isFinite(nextIndex) ? nextIndex : rowIndex + delta, nextCol, event.shiftKey);
        if (event.shiftKey) next.dataset.opsSkipSelect = '1';
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        if (!event.shiftKey) next.select();
      }}
    />
  );
}

function BlankOpsRow({
  rowIndex,
  visColIds,
  show,
  disabled,
  isSelected,
  onGrowDown,
  onMove,
  onCommit,
}: {
  rowIndex: number;
  visColIds: ColumnId[];
  show: (id: ColumnId) => boolean;
  disabled: boolean;
  isSelected: (r: number, c: number) => boolean;
  onGrowDown: (nextIndex: number, col: string, shift: boolean) => void;
  onMove: (nextIndex: number, col: string, shift: boolean) => void;
  onCommit: (patch: RegisterPatch) => Promise<void>;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const rowKey = `blank:${rowIndex}`;
  const setField = (col: string) => (value: string) => setVals((prev) => ({ ...prev, [col]: value }));

  const commit = async () => {
    const patch = blankPatch(vals);
    if (!patch) return;
    setSaving(true);
    await onCommit(patch);
    setVals({});
    setSaving(false);
  };

  const cellFor = (col: ColumnId, type: 'text' | 'date' | 'money' = 'text') => (
    <EditableCell
      row={rowKey}
      col={col}
      rowIndex={rowIndex}
      type={type}
      value={vals[col] ?? ''}
      disabled={disabled || saving}
      persist={false}
      selected={isSelected(rowIndex, visColIds.indexOf(col))}
      onDraftChange={setField(col)}
      onGrowDown={onGrowDown}
      onMove={onMove}
      onCommit={async () => {}}
    />
  );

  const wrap = (col: ColumnId, child: ReactNode) => (
    <td className={cell} data-ops-index={rowIndex} data-ops-col={col}>{child}</td>
  );

  return (
    <tr
      data-ops-blank="true"
      className={cn(
        'group hover:bg-[color-mix(in_oklab,var(--color-brand-500)_7%,var(--surface-solid))]',
        rowIndex % 2 === 0 ? 'bg-[var(--surface-solid)]' : 'bg-[var(--glass-bg-subtle)]',
      )}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        void commit();
      }}
    >
      <td data-ops-rowhead={rowIndex} className={cn(cell, 'cursor-pointer bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--surface-solid))] px-1 text-center font-mono text-[0.62rem] font-semibold text-[var(--faint-fg)]')}>{rowIndex + 1}</td>
      {show('account') && wrap('account', cellFor('account'))}
      {show('customer') && wrap('customer', cellFor('customer'))}
      {show('agent') && wrap('agent', cellFor('agent'))}
      {show('amount') && wrap('amount', cellFor('amount', 'money'))}
      {show('maturity') && wrap('maturity', cellFor('maturity', 'date'))}
      {show('form') && wrap('form', cellFor('form', 'date'))}
      {show('review') && wrap('review', cellFor('review', 'date'))}
      {show('payment') && wrap('payment', cellFor('payment', 'date'))}
      {show('remaining') && wrap('remaining', null)}
      {show('paid') && wrap('paid', null)}
      {show('missed') && wrap('missed', null)}
      {show('due') && wrap('due', cellFor('due', 'money'))}
      {show('total') && wrap('total', null)}
      {show('paidToday') && wrap('paidToday', cellFor('paidToday', 'money'))}
      {show('given') && wrap('given', null)}
    </tr>
  );
}

export function OperationsGrid({ rows, canEdit, canApproveDates, canSchedule, canPay, isAdmin, addRowBranchId }: {
  rows: OperationsRow[];
  canEdit: boolean;
  /** Only a role holding `case.approve` may move the approval date. */
  canApproveDates: boolean;
  canSchedule: boolean;
  canPay: boolean;
  isAdmin: boolean;
  addRowBranchId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'work' | 'unreviewed' | 'blank'>('work');
  const [busy, setBusy] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hidden, setHidden] = useState<ColumnId[]>([]);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const [extra, setExtra] = useState<Set<string>>(() => new Set());
  const undoRef = useRef<{ rowId: string; col: ColumnId; before: string; after: string }[]>([]);
  const redoRef = useRef<{ rowId: string; col: ColumnId; before: string; after: string }[]>([]);
  const pendingFocusRef = useRef<{ index: number; col: string; shift: boolean } | null>(null);
  const draggingRef = useRef(false);
  /*
    How far the clerk has walked the sheet open. Only ever raised deliberately — arrowing off the
    bottom, the scroll sentinel, opening the blank sheet — never by the row list changing under it.
    The length the sheet actually renders is derived from this and the live rows, below.
  */
  const [revealed, setRevealed] = useState(() => initialSheetLength(rows.length));
  const revealSentinelRef = useRef<HTMLTableRowElement>(null);
  const sheetScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /*
      Reading the browser's store on mount is the one case the rule is not describing: this is
      not state derived from props, it is a subscription to something outside React, and it
      cannot move into `useState` because the server render has no `localStorage` and would
      hydrate a different table to the one the Admin left behind.
    */
    try {
      const stored = JSON.parse(localStorage.getItem('maturityflow.ops.hidden-columns') || '[]');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(stored)) setHidden(stored.filter((id): id is ColumnId => COLUMNS.some(([key]) => key === id)));
    } catch { /* Show the complete table if browser storage is invalid. */ }
  }, []);

  useEffect(() => {
    const endDrag = () => { draggingRef.current = false; };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, []);

  const visible = useMemo(() => {
    if (tab === 'blank') return [];
    const base = tab === 'unreviewed' ? rows.filter((row) => row.needsReview) : rows;
    if (!query.trim()) return base;
    return base.filter((row) =>
      rowMatchesFilter([row.accountNumber, row.customerName, row.agentName, row.maturityRupees], query),
    );
  }, [rows, tab, query]);
  const allowBlanks = Boolean(
    canEdit && addRowBranchId && (tab === 'blank' || (tab === 'work' && !query.trim())),
  );
  /*
    Derived, not stored. This used to be an effect that pushed the new length into state every
    time the row list changed, which renders the old length first and the right one a frame later
    — and, because it is a setState inside an effect, stops the React compiler memoising the whole
    grid. It is a pure function of what is on screen, so it is computed here.
  */
  const sheetLength = !allowBlanks
    ? Math.max(revealed, visible.length)
    : tab === 'blank'
      ? Math.max(revealed, INITIAL_SHEET_ROWS)
      : Math.max(revealed, initialSheetLength(visible.length));
  useEffect(() => {
    const sentinel = revealSentinelRef.current;
    const root = sheetScrollRef.current;
    if (!sentinel || !root || !allowBlanks) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setRevealed((len) => growSheetLength({
        currentLength: len,
        filledCount: visible.length,
        targetIndex: len,
      }));
    }, { root, rootMargin: '240px' });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [allowBlanks, sheetLength, visible.length]);
  const blanks = blankRowCount({ sheetLength, filledCount: visible.length, allowBlanks });
  const show = (id: ColumnId) => !hidden.includes(id);
  const visColIds = useMemo(() => COLUMNS.filter(([id]) => show(id)).map(([id]) => id), [hidden]);
  const selection: SheetRange | null = anchor && focus ? normalizeRange(anchor, focus) : null;
  const selectedCells = useMemo(() => unionSelection(selection, extra), [selection, extra]);
  const activeAddr = focus ? cellAddress(focus.c, focus.r) : '';

  const selectCell = useCallback((r: number, c: number, mods: { shift?: boolean; ctrl?: boolean; drag?: boolean }) => {
    if (c < 0) return;
    if (mods.ctrl) {
      setExtra((prev) => toggleCellInSelection(prev, anchor && focus ? normalizeRange(anchor, focus) : null, r, c));
      setAnchor({ r, c });
      setFocus({ r, c });
      return;
    }
    if (mods.shift || mods.drag) {
      setFocus({ r, c });
      setAnchor((current) => current ?? { r, c });
      return;
    }
    setExtra(new Set());
    setAnchor({ r, c });
    setFocus({ r, c });
  }, [anchor, focus]);

  const growFromNav = useCallback((nextIndex: number, col: string, shift = false) => {
    if (!allowBlanks) return;
    setRevealed((current) => {
      const next = growSheetLength({
        currentLength: current,
        filledCount: visible.length,
        targetIndex: nextIndex,
      });
      if (next > current) pendingFocusRef.current = { index: nextIndex, col, shift };
      return next;
    });
  }, [allowBlanks, visible.length]);

  const moveHighlight = useCallback((nextIndex: number, col: string, shift: boolean) => {
    const c = visColIds.indexOf(col as ColumnId);
    if (c < 0) return;
    selectCell(nextIndex, c, { shift });
  }, [selectCell, visColIds]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const focusPending = () => {
      const el =
        document.querySelector<HTMLInputElement>(
          `input[data-ops-index="${pending.index}"][data-ops-col="${pending.col}"]:not(:disabled)`,
        )
        ?? document.querySelector<HTMLInputElement>(
          `input[data-ops-index="${pending.index}"]:not(:disabled)`,
        );
      if (!el) return false;
      pendingFocusRef.current = null;
      if (pending.shift) el.dataset.opsSkipSelect = '1';
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!pending.shift) el.select();
      const c = visColIds.indexOf(pending.col as ColumnId);
      if (c >= 0) selectCell(pending.index, c, { shift: pending.shift });
      return true;
    };
    if (!focusPending()) {
      requestAnimationFrame(() => {
        if (!focusPending()) requestAnimationFrame(focusPending);
      });
    }
  }, [sheetLength, visColIds, selectCell]);

  const valueOf = useCallback((row: OperationsRow, col: ColumnId): string => {
    if (col === 'account') return row.accountNumber;
    if (col === 'customer') return row.customerName;
    if (col === 'agent') return row.agentName;
    if (col === 'amount') return row.maturityRupees;
    if (col === 'maturity') return row.maturityOn || DEFAULT_OPERATIONS_MATURITY_ON;
    if (col === 'form') return row.formSubmittedOn;
    if (col === 'review') return row.opsReviewedOn;
    if (col === 'payment') return row.paymentOn;
    if (col === 'remaining') return rupees(row.remainingPaise);
    if (col === 'paid') return rupees(row.paidPaise);
    if (col === 'missed') return rupees(row.missedPaise);
    if (col === 'due') return rupees(row.duePaise);
    if (col === 'total') return rupees((BigInt(row.missedPaise) + BigInt(row.duePaise)).toString());
    if (col === 'paidToday') return rupees(row.paidTodayPaise);
    return '';
  }, []);

  function isSelected(r: number, c: number) {
    if (c < 0) return false;
    return cellInSelection(r, c, selection, extra);
  }

  function openBlankSheet() {
    if (!addRowBranchId) {
      toast.error('Choose a branch first — a blank sheet has to belong to one register.');
      return;
    }
    const already = tab === 'blank';
    setTab('blank');
    setQuery('');
    setRevealed((len) => Math.max(len, INITIAL_SHEET_ROWS));
    setExtra(new Set());
    setAnchor({ r: 0, c: 0 });
    setFocus({ r: 0, c: 0 });
    pendingFocusRef.current = { index: 0, col: visColIds[0] ?? 'account', shift: false };
    if (!already) {
      toast.success(`Blank sheet — ${MAX_SHEET_ROWS} rows, like the cashbook. Type or paste from Excel. Existing cases stay on Operations work.`);
    }
  }

  function pointerCell(target: EventTarget | null): { r: number; c: number } | null {
    const el = target instanceof Element ? target.closest('[data-ops-index][data-ops-col]') : null;
    if (!el || !(el instanceof HTMLElement)) return null;
    const r = Number(el.dataset.opsIndex);
    const col = el.dataset.opsCol as ColumnId | undefined;
    if (!col || !Number.isFinite(r)) return null;
    const c = visColIds.indexOf(col);
    return c < 0 ? null : { r, c };
  }

  /*
    The drag is followed on the window, not on the table.

    React delivers pointermove through one delegated listener at the root, which only fires while
    the event's target is still inside the mounted tree. Pressing a cell selects it, that
    re-renders the row, and the browser goes on dispatching the rest of the gesture to the element
    it captured at pointerdown — which is no longer the node React is watching. Measured: the
    table's handler ran once for a ten-step drag, so a dragged range only ever selected the cell
    it began in, while Shift-click (one event, no drag) worked perfectly and hid the problem.

    Listening on the window sidesteps both the capture and the re-render: the cell under the
    cursor is resolved from coordinates every time.
  */
  const dragRef = useRef({ selectCell, pointerCell: (t: EventTarget | null) => pointerCell(t) });
  useEffect(() => {
    dragRef.current = { selectCell, pointerCell: (t: EventTarget | null) => pointerCell(t) };
  });

  function beginDrag() {
    draggingRef.current = true;
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const pos = dragRef.current.pointerCell(document.elementFromPoint(event.clientX, event.clientY));
      if (pos) dragRef.current.selectCell(pos.r, pos.c, { drag: true });
    };
    const onEnd = () => {
      draggingRef.current = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
  }

  function onSheetPointerDown(event: ReactPointerEvent<HTMLTableElement>) {
    if (event.button !== 0) return;
    const head = event.target instanceof Element ? event.target.closest('[data-ops-rowhead]') : null;
    if (head instanceof HTMLElement) {
      event.preventDefault();
      const r = Number(head.dataset.opsRowhead);
      if (!Number.isFinite(r)) return;
      const lastC = Math.max(0, visColIds.length - 1);
      if (event.ctrlKey || event.metaKey) {
        setExtra((prev) => {
          const next = new Set(prev);
          if (selection) for (const key of rangeKeys(selection)) next.add(key);
          for (let c = 0; c <= lastC; c++) next.add(cellKey(r, c));
          return next;
        });
        setAnchor({ r, c: 0 });
        setFocus({ r, c: lastC });
        return;
      }
      setExtra(new Set());
      if (event.shiftKey && anchor) {
        setAnchor({ r: anchor.r, c: 0 });
        setFocus({ r, c: lastC });
      } else {
        setAnchor({ r, c: 0 });
        setFocus({ r, c: lastC });
      }
      return;
    }
    const pos = pointerCell(event.target);
    if (!pos) return;
    const ctrl = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    /*
      Take the press away from the input before it can start a text-selection drag.

      `user-select: none` on the table does not reach an `<input>` — inputs stay selectable — so
      pressing inside one and moving begins the browser's own drag, and Chrome answers with a
      pointercancel that ends the gesture after a single move. Measured exactly that: one move,
      then cancel, so a dragged range never grew past its first cell.

      The caret is not lost by this: focusing a cell already selects its whole value, so there is
      no click-to-place-caret behaviour to preserve. Focus is moved by hand below to keep it.
    */
    event.preventDefault();
    selectCell(pos.r, pos.c, { shift, ctrl });
    if (!ctrl) beginDrag();

    const pressed = event.target;
    if (pressed instanceof HTMLInputElement && !pressed.disabled) {
      if (shift) pressed.dataset.opsSkipSelect = '1';
      pressed.focus({ preventScroll: true });
      if (!shift) pressed.select();
    }
  }

  function onSheetPointerUp() {
    draggingRef.current = false;
  }
  const toggleColumn = (id: ColumnId) => {
    const next = hidden.includes(id) ? hidden.filter((key) => key !== id) : [...hidden, id];
    setHidden(next);
    localStorage.setItem('maturityflow.ops.hidden-columns', JSON.stringify(next));
  };

  async function save(id: string, patch: Parameters<typeof saveRegisterFieldsAction>[1]) {
    const result = await saveRegisterFieldsAction(id, patch);
    if (!result.ok) toast.error(result.error); else router.refresh();
    return result.ok;
  }

  function pushUndo(item: { rowId: string; col: ColumnId; before: string; after: string }) {
    if (item.before === item.after) return;
    undoRef.current.push(item);
    redoRef.current = [];
  }

  async function savePlanned(row: OperationsRow, amount: string) {
    if (!row.todayInstalmentId) { toast.error('This row has no scheduled payment for today. Change its Payment Date first.'); return; }
    const result = await setInstalmentAmountAction(row.id, row.todayInstalmentId, amount || '0');
    if (!result.ok) toast.error(result.error); else router.refresh();
  }

  /**
   * One counter payment, exactly as on the register: the amount typed here is what the customer
   * handed over today, and the server spreads it over the oldest unpaid days first before it
   * touches today's. The old call could only ever fill `todayInstalmentId`, so a customer
   * settling a missed day together with today was rejected on this screen while the register
   * accepted it. Both screens now go through `settleRegisterRowAction`, which replaces (not adds
   * to) today's recorded figure — the same semantics the cell already implied.
   */
  async function savePaid(row: OperationsRow, cash: bigint, online: bigint) {
    const reference = online > 0n ? window.prompt('Enter UTR / transfer reference for the online amount:') : null;
    if (online > 0n && !reference?.trim()) return;
    const replacing = BigInt(row.paidTodayPaise) > 0n;
    // Pay-ahead and corrections both need a reason; the server asks again if it disagrees.
    const reason = replacing ? window.prompt('Reason for correcting the recorded payment:', 'Spreadsheet correction') : 'Spreadsheet entry';
    if (replacing && !reason?.trim()) return;
    const result = await settleRegisterRowAction(row.id, cash.toString(), online.toString(), reference?.trim() || null, reason?.trim() || null);
    if (!result.ok) toast.error(result.error); else router.refresh();
  }

  async function mark(row: OperationsRow, taken: boolean) {
    if (!row.todayInstalmentId || busy) return;
    setBusy(row.id);
    const reference = taken && BigInt(row.todayOnlineDuePaise) > 0n ? window.prompt('Enter UTR / transfer reference for the online portion:') : null;
    if (taken && BigInt(row.todayOnlineDuePaise) > 0n && !reference?.trim()) { setBusy(null); return; }
    const result = taken
      ? await markTakenAction(row.todayInstalmentId, 'SPLIT', reference?.trim() || null)
      : await markNotTakenAction(row.todayInstalmentId, false);
    setBusy(null);
    if (!result.ok) toast.error(result.error); else router.refresh();
  }

  async function applyCell(row: OperationsRow, col: ColumnId, raw: string, recordUndo = true) {
    // Derived money and the Given control are never writable — a paste that filled Total would
    // be writing a figure the sheet computes, and Given moves money.
    if (col === 'given' || col === 'remaining' || col === 'paid' || col === 'missed' || col === 'total') return;
    const before = valueOf(row, col);
    let next = raw;
    if (col === 'amount' || col === 'due' || col === 'paidToday') {
      next = pasteRupees(raw);
      if (next === '' && raw.trim() !== '') return;
    }
    if (col === 'maturity' || col === 'form' || col === 'review' || col === 'payment') {
      const iso = pasteIsoDate(raw);
      if (iso == null) return;
      next = iso;
    }
    if (recordUndo) pushUndo({ rowId: row.id, col, before, after: next });
    if (col === 'account') await save(row.id, { accountNumber: next });
    else if (col === 'customer') await save(row.id, { customerName: next });
    else if (col === 'agent') await save(row.id, { agentName: next });
    else if (col === 'amount') await save(row.id, { maturityRupees: next });
    else if (col === 'maturity') await save(row.id, { instrumentMaturityOn: next || null });
    else if (col === 'form') await save(row.id, { formSubmittedOn: next });
    else if (col === 'review') await save(row.id, { opsReviewedOn: next || null });
    else if (col === 'payment') await save(row.id, { paymentOn: next || null });
    else if (col === 'due') await savePlanned(row, next);
    else if (col === 'paidToday') {
      const total = BigInt(next || '0');
      const online = BigInt(row.paidOnlineTodayPaise) / 100n;
      await savePaid(row, total > online ? total - online : total, total > online ? online : 0n);
    }
  }

  async function pasteAt(startR: number, startC: number, text: string) {
    const grid = parseClipboardGrid(text);
    if (grid.length === 0) return;
    if (grid.length > MAX_PASTE_ROWS) {
      toast.error(`Paste at most ${MAX_PASTE_ROWS} rows at a time — each cell is saved with its own audit line.`);
      return;
    }
    const lastIndex = startR + grid.length - 1;
    if (allowBlanks) {
      setRevealed((current) => growSheetLength({
        currentLength: current,
        filledCount: visible.length,
        targetIndex: lastIndex,
      }));
    }
    let written = 0;
    let nameless = 0;
    for (let i = 0; i < grid.length; i++) {
      const line = grid[i] ?? [];
      const live = visible[startR + i];
      if (live) {
        for (let j = 0; j < line.length; j++) {
          const col = visColIds[startC + j];
          if (!col) continue;
          await applyCell(live, col, line[j] ?? '');
          written++;
        }
        continue;
      }
      if (!allowBlanks || !addRowBranchId) continue;
      const vals: Record<string, string> = {};
      for (let j = 0; j < line.length; j++) {
        const col = visColIds[startC + j];
        if (col) vals[col] = line[j] ?? '';
      }
      const patch = blankPatch(vals);
      if (!patch) {
        // Something was on the line but nothing that identifies a customer.
        if (Object.values(vals).some((value) => (value ?? '').trim() !== '')) nameless++;
        continue;
      }
      const result = await createRegisterRowWithFieldsAction(addRowBranchId, patch);
      if (!result.ok) toast.error(result.error);
      else written += Object.keys(vals).filter((key) => (vals[key] ?? '').trim() !== '').length;
    }
    toast.success(`Pasted ${written} cell${written === 1 ? '' : 's'}`);
    if (nameless > 0) {
      toast.message(
        nameless === 1
          ? 'One line had no customer name or account number, so no row was created for it.'
          : `${nameless} lines had no customer name or account number, so no rows were created for them.`,
      );
    }
    if (written > 0) router.refresh();
  }

  const lastSheetRow = Math.max(0, visible.length + blanks - 1);
  const lastSheetCol = Math.max(0, visColIds.length - 1);

  function copySelection() {
    const cells = selectedCells.length > 0 ? selectedCells : (focus ? [focus] : []);
    if (cells.length === 0) return;
    const bounds = selectionBounds(cells);
    if (!bounds) return;
    const picked = new Set(cells.map((pos) => cellKey(pos.r, pos.c)));
    const block: string[][] = [];
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      const row = visible[r];
      const line: string[] = [];
      for (let c = bounds.c0; c <= bounds.c1; c++) {
        if (!picked.has(cellKey(r, c))) {
          line.push('');
          continue;
        }
        const col = visColIds[c];
        line.push(row && col ? valueOf(row, col) : '');
      }
      block.push(line);
    }
    void navigator.clipboard.writeText(serializeClipboardGrid(block));
    toast.success(cells.length === 1 ? 'Copied' : `Copied ${cells.length} cells`);
  }

  function focusSheetCell(r: number, c: number, shift = false) {
    const nextR = Math.max(0, Math.min(lastSheetRow, r));
    const nextC = Math.max(0, Math.min(lastSheetCol, c));
    const col = visColIds[nextC];
    if (!col) return;
    selectCell(nextR, nextC, { shift });
    const el = document.querySelector<HTMLInputElement>(
      `input[data-ops-index="${nextR}"][data-ops-col="${col}"]`,
    );
    if (el) {
      if (shift) el.dataset.opsSkipSelect = '1';
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!shift) el.select();
    } else if (nextR >= visible.length) {
      growFromNav(nextR, col, shift);
    }
  }

  async function clearSelected() {
    if (!canEdit) return;
    const cells = selectedCells.length > 0 ? selectedCells : (focus ? [focus] : []);
    let n = 0;
    for (const pos of cells) {
      const col = visColIds[pos.c];
      if (!col || !BULK_EDIT.has(col)) continue;
      const row = visible[pos.r];
      if (!row) continue;
      await applyCell(row, col, '');
      n++;
    }
    if (n > 0) toast.success(n === 1 ? 'Cleared' : `Cleared ${n} cells`);
  }

  async function applyFillPairs(pairs: { from: { r: number; c: number }; to: { r: number; c: number } }[]) {
    if (!canEdit) return;
    let n = 0;
    for (const pair of pairs) {
      const fromCol = visColIds[pair.from.c];
      const toCol = visColIds[pair.to.c];
      if (!fromCol || !toCol || !BULK_EDIT.has(toCol)) continue;
      const src = visible[pair.from.r];
      const dest = visible[pair.to.r];
      if (!src || !dest) continue;
      await applyCell(dest, toCol, valueOf(src, fromCol));
      n++;
    }
    if (n > 0) toast.success(n === 1 ? 'Filled 1 cell' : `Filled ${n} cells`);
  }

  function undoSheet() {
    const item = undoRef.current.pop();
    if (!item) return false;
    const row = rows.find((r) => r.id === item.rowId);
    if (row) {
      redoRef.current.push(item);
      void applyCell(row, item.col, item.before, false);
    }
    return true;
  }

  function redoSheet() {
    const item = redoRef.current.pop();
    if (!item) return false;
    const row = rows.find((r) => r.id === item.rowId);
    if (row) {
      undoRef.current.push(item);
      void applyCell(row, item.col, item.after, false);
    }
    return true;
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = matchSheetShortcut(event);
      if (!shortcut) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inCell = Boolean(target?.closest('[data-ops-cell]'));
      const inSheet = Boolean(target?.closest('table')?.querySelector('[data-ops-cell]'));
      const inFilter = Boolean(target?.closest('input.mf-input') && !inCell);
      if (inFilter) return;
      if (!inSheet && !inCell && shortcut.action !== 'undo' && shortcut.action !== 'redo' && shortcut.action !== 'find') {
        return;
      }
      const input = target instanceof HTMLInputElement && inCell ? target : null;
      const block = selectedCells.length > 1;
      const range = selection ?? (focus ? { r0: focus.r, c0: focus.c, r1: focus.r, c1: focus.c } : null);

      if (shortcut.action === 'copy') {
        if (!block && input && window.getSelection()?.toString() && !wholeCellSelected(input)) return;
        event.preventDefault();
        copySelection();
        return;
      }
      if (shortcut.action === 'cut') {
        if (!canEdit) return;
        if (!block && input && window.getSelection()?.toString() && !wholeCellSelected(input)) return;
        event.preventDefault();
        copySelection();
        void clearSelected();
        return;
      }
      if (shortcut.action === 'paste') {
        if (!focus || !canEdit) return;
        event.preventDefault();
        void navigator.clipboard.readText().then((text) => pasteAt(focus.r, focus.c, text));
        return;
      }
      if (shortcut.action === 'undo') {
        if (input && input.value !== (input.dataset.opsCommitted ?? '')) {
          event.preventDefault();
          input.value = input.dataset.opsCommitted ?? '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        if (!undoSheet()) return;
        event.preventDefault();
        return;
      }
      if (shortcut.action === 'redo') {
        if (!redoSheet()) return;
        event.preventDefault();
        return;
      }
      if (shortcut.action === 'selectAll') {
        event.preventDefault();
        setExtra(new Set());
        setAnchor({ r: 0, c: 0 });
        setFocus({ r: lastSheetRow, c: lastSheetCol });
        return;
      }
      if (shortcut.action === 'selectRow' && focus) {
        event.preventDefault();
        setExtra(new Set());
        setAnchor({ r: focus.r, c: 0 });
        setFocus({ r: focus.r, c: lastSheetCol });
        return;
      }
      if (shortcut.action === 'selectColumn' && focus) {
        event.preventDefault();
        setExtra(new Set());
        setAnchor({ r: 0, c: focus.c });
        setFocus({ r: lastSheetRow, c: focus.c });
        return;
      }
      if (shortcut.action === 'clear' || shortcut.action === 'backspace') {
        if (!canEdit) return;
        if (!block && input && !wholeCellSelected(input) && shortcut.action === 'backspace') return;
        if (!block && input && !wholeCellSelected(input) && shortcut.action === 'clear' && input.value !== '') return;
        event.preventDefault();
        void clearSelected();
        return;
      }
      if (shortcut.action === 'fillDown' && range) {
        event.preventDefault();
        void applyFillPairs(fillDownPairs(range));
        return;
      }
      if (shortcut.action === 'fillRight' && range) {
        event.preventDefault();
        void applyFillPairs(fillRightPairs(range));
        return;
      }
      if (shortcut.action === 'fillSelection' && focus) {
        event.preventDefault();
        void applyFillPairs(
          selectedCells
            .filter((pos) => pos.r !== focus.r || pos.c !== focus.c)
            .map((pos) => ({ from: focus, to: pos })),
        );
        return;
      }
      if (shortcut.action === 'home' && focus) {
        if (shortcut.extent === 'row' && input && !wholeCellSelected(input)) return;
        event.preventDefault();
        focusSheetCell(shortcut.extent === 'sheet' ? 0 : focus.r, 0, shortcut.shift);
        return;
      }
      if (shortcut.action === 'end' && focus) {
        if (shortcut.extent === 'row' && input && !wholeCellSelected(input)) return;
        event.preventDefault();
        const r = shortcut.extent === 'sheet' ? Math.max(0, visible.length - 1) : focus.r;
        focusSheetCell(r, lastSheetCol, shortcut.shift);
        return;
      }
      if (shortcut.action === 'jump' && focus) {
        event.preventDefault();
        const next = jumpToEdge({
          from: focus,
          dir: shortcut.dir,
          lastRow: lastSheetRow,
          lastCol: lastSheetCol,
          filled: (r, c) => {
            const col = visColIds[c];
            const row = visible[r];
            return Boolean(col && row && valueOf(row, col).trim() !== '');
          },
        });
        if (next.r > lastSheetRow - 1 && shortcut.dir === 'down') growFromNav(next.r, visColIds[next.c] ?? 'account', shortcut.shift);
        focusSheetCell(next.r, next.c, shortcut.shift);
        return;
      }
      if (shortcut.action === 'find') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Filter this sheet"]')?.focus();
        return;
      }
      if (shortcut.action === 'save') {
        event.preventDefault();
        toast.message('Cells save when you leave them — there is no separate Save.');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const colCount = COLUMNS.filter(([id]) => show(id)).length;
  // Relative weights keep every visible column inside the available sheet width. They are
  // normalised again when an Admin hides columns, so the remaining cells still fill the row.
  const widths: [ColumnId, number][] = [
    ['account', 5.5], ['customer', 9], ['agent', 8.5], ['amount', 6.5],
    ['maturity', 7.5], ['form', 8.5], ['review', 7.5], ['payment', 7.5],
    ['remaining', 6], ['paid', 5.5], ['missed', 6], ['due', 6], ['total', 6],
    ['paidToday', 5.5], ['given', 9],
  ];
  const visibleWeight = Math.max(
    1,
    widths.filter(([id]) => show(id)).reduce((total, [, weight]) => total + weight, 0),
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--hairline)] bg-[var(--surface-solid)] p-0.5">
          <button type="button" onClick={() => setTab('work')} className={cn('px-3 py-2 text-[0.8125rem] font-medium', tab === 'work' && 'bg-[var(--color-brand-700)] font-semibold text-white dark:text-[var(--color-brand-950)]')}>Operations work · {rows.length}</button>
          <button type="button" onClick={() => setTab('unreviewed')} className={cn('px-3 py-2 text-[0.8125rem] font-medium', tab === 'unreviewed' && 'bg-[var(--color-brand-700)] font-semibold text-white dark:text-[var(--color-brand-950)]')}>Not reviewed · {rows.filter((row) => row.needsReview).length}</button>
          {canEdit && (
            <button
              type="button"
              onClick={() => openBlankSheet()}
              className={cn('px-3 py-2 text-[0.8125rem] font-medium', tab === 'blank' && 'bg-[var(--color-brand-700)] font-semibold text-white dark:text-[var(--color-brand-950)]')}
            >
              Blank sheet
            </button>
          )}
        </div>
        <label className="relative min-w-[12rem] flex-1 max-w-sm">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
          <input
            className="mf-input h-9 w-full !pl-7 text-[0.8125rem]"
            placeholder="Filter name, A/c, agent"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Filter this sheet"
          />
        </label>
        {(canEdit || isAdmin) && (
          <div className="relative flex flex-wrap items-center gap-1 text-xs">
            {canEdit && (
              <button
                type="button"
                disabled={!addRowBranchId}
                title={!addRowBranchId ? 'Choose a branch first' : `Open ${MAX_SHEET_ROWS} empty rows to type or paste`}
                onClick={() => openBlankSheet()}
                className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 font-semibold hover:bg-[var(--glass-bg-strong)] disabled:opacity-50"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />Blank sheet
              </button>
            )}
            {isAdmin && (
              <>
                <button type="button" onClick={() => setColumnsOpen((open) => !open)} className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 font-semibold hover:bg-[var(--glass-bg-strong)]"><Columns3 className="h-3.5 w-3.5" />Columns</button>
                {columnsOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-56 border border-[var(--hairline)] bg-[var(--surface-solid)] p-2 shadow-xl">
                    <p className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-wide text-[var(--muted-fg)]">Visible columns</p>
                    {COLUMNS.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-1 hover:bg-[var(--glass-bg-subtle)]"><input type="checkbox" checked={show(id)} onChange={() => toggleColumn(id)} />{label}</label>)}
                    <button type="button" onClick={() => { setHidden([]); localStorage.removeItem('maturityflow.ops.hidden-columns'); }} className="mt-2 w-full border border-[var(--hairline)] py-1 font-semibold">Show all</button>
                  </div>
                )}
                {[[ '/maturities', 'Register' ], [ '/import', 'Import' ], [ '/audit', 'Audit' ], [ '/settings', 'Settings' ]].map(([href, label]) => <a key={href} href={href} className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 text-[var(--muted-fg)] hover:text-[var(--page-fg)]">{label}<ExternalLink className="h-3 w-3" /></a>)}
              </>
            )}
          </div>
        )}
      </div>

      {tab === 'unreviewed' && <div className="flex items-start gap-2 border border-[color-mix(in_oklab,var(--color-warn-600)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-600)_8%,transparent)] px-3 py-2 text-xs text-[var(--muted-fg)]"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn-600)]" />These cases progressed automatically so payment was not delayed. Enter the actual Operations approval date when review is completed.</div>}
      {tab === 'blank' && <div className="flex items-start gap-2 border border-[var(--hairline)] bg-[var(--surface-solid)] px-3 py-2 text-xs text-[var(--muted-fg)]"><FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-brand-700)]" />Empty rows only — existing cases stay on Operations work. Type or paste, then leave a row to create it. Nothing is written if you leave a row empty.</div>}

      <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[var(--muted-fg)]">
        <span className="inline-flex h-8 min-w-[4.5rem] items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 font-mono font-semibold text-[var(--page-fg)]" title="Active cell">
          {activeAddr || '—'}
        </span>
        <span>500-row sheet like the cashbook — type or paste from Excel, no Add row needed. Ctrl+C/X/V · Ctrl+Z/Y · Ctrl+A · Delete · Ctrl+D/R · Ctrl+Home. Shift-click a block, Ctrl-click a cell.</span>
      </div>

      <div className="overflow-hidden border border-[var(--hairline)] bg-[var(--surface-solid)]">
        <div ref={sheetScrollRef} className="max-h-[72vh] overflow-x-hidden overflow-y-auto overscroll-contain">
          <table
            className="w-full table-fixed border-collapse text-[0.8125rem] select-none"
            onPointerDown={onSheetPointerDown}
            onPointerUp={onSheetPointerUp}
            onPointerCancel={onSheetPointerUp}
            onPaste={(event) => {
              const text = event.clipboardData.getData('text/plain');
              if (!text.includes('\t') && !text.includes('\n')) return;
              if (!focus) return;
              event.preventDefault();
              void pasteAt(focus.r, focus.c, text);
            }}
          >
            <colgroup>
              <col style={{ width: '2.2rem' }} />
              {widths.filter(([id]) => show(id)).map(([id, weight]) => <col key={id} style={{ width: `${(weight / visibleWeight) * 100}%` }} />)}
            </colgroup>
            <thead>
              <tr>
                <th className={cn(head, 'w-8 px-0 text-center text-[0.58rem] text-[var(--faint-fg)]')}>#</th>
                {COLUMNS.filter(([id]) => show(id)).map(([id, label], colIndex) => (
                  <th key={id} className={cn(head, ['amount', 'remaining', 'paid', 'missed', 'due', 'total', 'paidToday'].includes(id) && 'text-right')}>
                    <span className="block font-mono text-[0.58rem] font-bold text-[var(--color-brand-700)]">{columnLetter(colIndex)}</span>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, rowIndex) => {
                // The cash leg is no longer a column of its own; Actual paid still has to split
                // against whatever is already recorded online, so that half is kept.
                const paidOnline = BigInt(row.paidOnlineTodayPaise) / 100n;
                const rowSurface = rowIndex % 2 === 0 ? 'bg-[var(--surface-solid)]' : 'bg-[var(--glass-bg-subtle)]';
                return (
                  <tr key={row.id} className={cn('group hover:bg-[color-mix(in_oklab,var(--color-brand-500)_7%,var(--surface-solid))]', rowSurface)}>
                    <td data-ops-rowhead={rowIndex} className={cn(cell, 'cursor-pointer bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--surface-solid))] px-1 text-center font-mono text-[0.62rem] font-semibold text-[var(--muted-fg)]')}>{rowIndex + 1}</td>
                    {show('account') && <td className={cn(cell, row.needsReview && 'shadow-[inset_3px_0_0_var(--color-warn-500)]')} data-ops-index={rowIndex} data-ops-col="account"><EditableCell row={row.id} col="account" value={row.accountNumber} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('account'))}  onCommit={(v) => { pushUndo({ rowId: row.id, col: 'account', before: row.accountNumber, after: v }); return save(row.id, { accountNumber: v }).then(() => undefined); }} /></td>}
                    {show('customer') && <td className={cell} data-ops-index={rowIndex} data-ops-col="customer"><EditableCell row={row.id} col="customer" value={row.customerName} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('customer'))}  onCommit={(v) => { pushUndo({ rowId: row.id, col: 'customer', before: row.customerName, after: v }); return save(row.id, { customerName: v }).then(() => undefined); }} /></td>}
                    {show('agent') && <td className={cell} data-ops-index={rowIndex} data-ops-col="agent"><EditableCell row={row.id} col="agent" value={row.agentName} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('agent'))}  onCommit={(v) => { pushUndo({ rowId: row.id, col: 'agent', before: row.agentName, after: v }); return save(row.id, { agentName: v }).then(() => undefined); }} /></td>}
                    {show('amount') && <td className={cell} data-ops-index={rowIndex} data-ops-col="amount"><EditableCell row={row.id} col="amount" type="money" value={row.maturityRupees} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('amount'))}  onCommit={(v) => { pushUndo({ rowId: row.id, col: 'amount', before: row.maturityRupees, after: v }); return save(row.id, { maturityRupees: v }).then(() => undefined); }} /></td>}
                    {show('maturity') && <td className={cell} data-ops-index={rowIndex} data-ops-col="maturity"><EditableCell row={row.id} col="maturity" type="date" value={row.maturityOn || DEFAULT_OPERATIONS_MATURITY_ON} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('maturity'))}  onCommit={(v) => save(row.id, { instrumentMaturityOn: v || null }).then(() => undefined)} /></td>}
                    {show('form') && <td className={cell} data-ops-index={rowIndex} data-ops-col="form"><EditableCell row={row.id} col="form" type="date" value={row.formSubmittedOn} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('form'))}  onCommit={(v) => save(row.id, { formSubmittedOn: v }).then(() => undefined)} /></td>}
                    {show('review') && <td className={cell} data-ops-index={rowIndex} data-ops-col="review"><EditableCell row={row.id} col="review" type="date" value={row.opsReviewedOn} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canApproveDates} selected={isSelected(rowIndex, visColIds.indexOf('review'))}  onCommit={(v) => save(row.id, { opsReviewedOn: v || null }).then(() => undefined)} /></td>}
                    {show('payment') && <td className={cell} data-ops-index={rowIndex} data-ops-col="payment"><EditableCell row={row.id} col="payment" type="date" value={row.paymentOn} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('payment'))}  onCommit={(v) => save(row.id, { paymentOn: v || null }).then(() => undefined)} /></td>}
                    {show('remaining') && <td className={cell} data-ops-index={rowIndex} data-ops-col="remaining"><EditableCell row={row.id} col="remaining" type="money" value={rupees(row.remainingPaise)} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled selected={isSelected(rowIndex, visColIds.indexOf('remaining'))}  onCommit={async () => {}} /></td>}
                    {show('paid') && <td className={cell} data-ops-index={rowIndex} data-ops-col="paid"><EditableCell row={row.id} col="paid" type="money" value={rupees(row.paidPaise)} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled selected={isSelected(rowIndex, visColIds.indexOf('paid'))}  onCommit={async () => {}} /></td>}
                    {show('missed') && <td className={cell} data-ops-index={rowIndex} data-ops-col="missed"><EditableCell row={row.id} col="missed" type="money" value={rupees(row.missedPaise)} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled selected={isSelected(rowIndex, visColIds.indexOf('missed'))}  onCommit={async () => {}} /></td>}
                    {show('due') && <td className={cell} data-ops-index={rowIndex} data-ops-col="due"><EditableCell row={row.id} col="due" type="money" value={rupees(row.duePaise)} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canSchedule && !canEdit} selected={isSelected(rowIndex, visColIds.indexOf('due'))}  onCommit={(v) => savePlanned(row, v)} /></td>}
                    {show('total') && <td className={cell} data-ops-index={rowIndex} data-ops-col="total"><EditableCell row={row.id} col="total" type="money" value={rupees((BigInt(row.missedPaise) + BigInt(row.duePaise)).toString())} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled selected={isSelected(rowIndex, visColIds.indexOf('total'))}  onCommit={async () => {}} /></td>}
                    {show('paidToday') && <td className={cell} data-ops-index={rowIndex} data-ops-col="paidToday"><EditableCell row={row.id} col="paidToday" type="money" value={rupees(row.paidTodayPaise)} rowIndex={rowIndex} onGrowDown={growFromNav} onMove={moveHighlight} disabled={!canPay} selected={isSelected(rowIndex, visColIds.indexOf('paidToday'))}  onCommit={(v) => { const total = BigInt(v || '0'); const online = paidOnline > total ? 0n : paidOnline; return savePaid(row, total - online, online); }} /></td>}
                    {/* Given: the one control that commits Actual paid. Two buttons, because
                        "the customer did not come" is a different fact from "nothing was typed"
                        — a blank row must never silently become a missed day. */}
                    {show('given') && <td className={cell} data-ops-index={rowIndex} data-ops-col="given"><div className="flex h-9 w-full items-stretch gap-px"><button type="button" title="Mark as taken" aria-label="Mark as taken" disabled={!canPay || !row.todayInstalmentId || row.todayState === 'PAID' || busy === row.id} onClick={(event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) return; void mark(row, true); }} className="flex flex-1 items-center justify-center gap-0.5 rounded-none bg-[var(--row-taken)] text-[0.65rem] font-bold text-[var(--row-taken-fg)] hover:bg-[var(--row-taken-strong)] disabled:cursor-not-allowed disabled:opacity-40 xl:text-[0.7rem]"><Check className="h-3 w-3 shrink-0" /><span className="hidden xl:inline">Taken</span></button><button type="button" title="Mark as not taken" aria-label="Mark as not taken" disabled={!canPay || !row.todayInstalmentId || row.todayState === 'PAID' || busy === row.id} onClick={(event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) return; void mark(row, false); }} className="flex flex-1 items-center justify-center gap-0.5 rounded-none bg-[var(--row-missed)] text-[0.65rem] font-bold text-[var(--row-missed-fg)] hover:bg-[var(--row-missed-strong)] disabled:cursor-not-allowed disabled:opacity-40 xl:text-[0.7rem]"><X className="h-3 w-3 shrink-0" /><span className="hidden xl:inline">Not taken</span></button></div></td>}
                  </tr>
                );
              })}
              {blanks > 0 && Array.from({ length: blanks }, (_, i) => (
                <BlankOpsRow
                  key={`blank-${visible.length + i}`}
                  rowIndex={visible.length + i}
                  visColIds={visColIds}
                  show={show}
                  disabled={!canEdit || !addRowBranchId}
                  isSelected={isSelected}
                  onGrowDown={growFromNav}
                  onMove={moveHighlight}
                  onCommit={async (patch) => {
                    if (!addRowBranchId) return;
                    const result = await createRegisterRowWithFieldsAction(addRowBranchId, patch);
                    if (!result.ok) toast.error(result.error);
                    else router.refresh();
                  }}
                />
              ))}
              {blanks > 0 && sheetLength < MAX_SHEET_ROWS && (
                <tr ref={revealSentinelRef} aria-hidden className="h-0">
                  <td colSpan={colCount + 1} />
                </tr>
              )}
              {visible.length === 0 && blanks === 0 && <tr><td colSpan={colCount + 1} className="px-4 py-12 text-center text-sm text-[var(--muted-fg)]">No cases in this list. Type into a blank row or paste from Excel.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-[var(--faint-fg)]">500 rows, like the cashbook. Type or paste a block from Excel into the cell where it should start — you do not need Add row or an import file. Empty rows are not saved until you type and leave them. Taken and Not taken stay buttons because they move money.</p>
    </div>
  );
}
