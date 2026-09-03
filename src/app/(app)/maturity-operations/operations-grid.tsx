'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Columns3, ExternalLink, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { setInstalmentAmountAction } from '@/actions/cases';
import {
  addMaturityOperationsRowAction,
  markNotTakenAction,
  markTakenAction,
  saveRegisterFieldsAction,
  settleRegisterRowAction,
} from '@/actions/register';
import { DEFAULT_OPERATIONS_MATURITY_ON } from '@/lib/maturity-operations';
import {
  cellAddress,
  columnLetter,
  normalizeRange,
  parseClipboardGrid,
  pasteIsoDate,
  pasteRupees,
  rowMatchesFilter,
  serializeClipboardGrid,
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
  paidTodayPaise: string;
  paidCashTodayPaise: string;
  paidOnlineTodayPaise: string;
  todayInstalmentId: string | null;
  todayOnlineDuePaise: string;
  todayState: 'DUE' | 'PAID' | 'MISSED' | 'NONE';
  needsReview: boolean;
}

const COLUMNS = [
  ['account', 'Account number'], ['customer', 'Customer name'], ['agent', 'Agent name'],
  ['amount', 'Maturity amount'], ['maturity', 'Maturity date'], ['form', 'Form submission date'],
  ['review', 'Approval date'],
  ['payment', 'Payment date'], ['due', 'Due payment'], ['recommended', 'Recommended payment'],
  ['paidToday', 'Paid today'], ['paidCash', 'Paid in cash'], ['paidOnline', 'Paid online'],
  ['taken', 'Taken'], ['notTaken', 'Not taken'],
] as const;
type ColumnId = (typeof COLUMNS)[number][0];

const rupees = (paise: string) => (BigInt(paise || '0') / 100n).toString();
const inputClass = 'h-9 w-full min-w-0 rounded-none border-0 bg-transparent px-1.5 text-[0.7rem] font-medium leading-none text-[var(--page-fg)] outline-none focus:bg-[var(--color-brand-50)] focus:shadow-[inset_0_0_0_2px_var(--ring)] disabled:cursor-default disabled:opacity-75 xl:px-2 xl:text-[0.78rem]';
const head = 'sticky top-0 z-20 h-11 border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--surface-solid))] px-1 py-1.5 text-left text-[0.58rem] font-extrabold uppercase leading-[1.15] tracking-[0.015em] text-[var(--page-fg)] xl:px-1.5 xl:text-[0.65rem]';
const cell = 'border border-[var(--hairline)] p-0 align-middle';

function EditableCell({ row, col, value, type = 'text', disabled, selected, onFocusCell, onCommit }: {
  row: string;
  col: string;
  value: string;
  type?: 'text' | 'date' | 'money';
  disabled: boolean;
  selected?: boolean;
  onFocusCell?: (shift: boolean) => void;
  onCommit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => { if (draft !== value) await onCommit(draft); };

  return (
    <input
      data-ops-cell="true" data-ops-row={row} data-ops-col={col}
      className={cn(
        inputClass,
        type === 'money' && 'font-mono text-[0.64rem] font-semibold text-right tabular-nums xl:text-[0.72rem]',
        type === 'date' && 'px-1 font-mono text-[0.625rem] tabular-nums xl:text-[0.6875rem]',
        col === 'account' && 'font-mono text-[0.65rem] tabular-nums xl:text-[0.72rem]',
        selected && 'bg-[color-mix(in_oklab,var(--color-brand-500)_16%,transparent)]',
      )}
      type={type === 'date' ? 'date' : 'text'} inputMode={type === 'money' ? 'numeric' : undefined}
      value={draft} title={draft} disabled={disabled}
      onFocus={(event) => {
        event.currentTarget.select();
        const shift = event.nativeEvent instanceof MouseEvent ? event.nativeEvent.shiftKey : false;
        onFocusCell?.(shift);
      }}
      onChange={(event) => setDraft(type === 'money' ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setDraft(value); return; }
        const direction = event.key === 'Enter' ? 'ArrowDown' : event.key;
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
        next?.focus({ preventScroll: true });
        next?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        next?.select();
      }}
    />
  );
}

export function OperationsGrid({ rows, canEdit, canSchedule, canPay, isAdmin, addRowBranchId }: {
  rows: OperationsRow[];
  canEdit: boolean;
  canSchedule: boolean;
  canPay: boolean;
  isAdmin: boolean;
  addRowBranchId: string | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'work' | 'unreviewed'>('work');
  const [busy, setBusy] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [hidden, setHidden] = useState<ColumnId[]>([]);
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number } | null>(null);
  const undoRef = useRef<{ rowId: string; col: ColumnId; before: string; after: string }[]>([]);
  const redoRef = useRef<{ rowId: string; col: ColumnId; before: string; after: string }[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('maturityflow.ops.hidden-columns') || '[]');
      if (Array.isArray(stored)) setHidden(stored.filter((id): id is ColumnId => COLUMNS.some(([key]) => key === id)));
    } catch { /* Show the complete table if browser storage is invalid. */ }
  }, []);

  const visible = useMemo(() => {
    const base = tab === 'unreviewed' ? rows.filter((row) => row.needsReview) : rows;
    if (!query.trim()) return base;
    return base.filter((row) =>
      rowMatchesFilter([row.accountNumber, row.customerName, row.agentName, row.maturityRupees], query),
    );
  }, [rows, tab, query]);
  const show = (id: ColumnId) => !hidden.includes(id);
  const visColIds = useMemo(() => COLUMNS.filter(([id]) => show(id)).map(([id]) => id), [hidden]);
  const selection: SheetRange | null = anchor && focus ? normalizeRange(anchor, focus) : null;
  const activeAddr = focus ? cellAddress(focus.c, focus.r) : '';

  const valueOf = useCallback((row: OperationsRow, col: ColumnId): string => {
    if (col === 'account') return row.accountNumber;
    if (col === 'customer') return row.customerName;
    if (col === 'agent') return row.agentName;
    if (col === 'amount') return row.maturityRupees;
    if (col === 'maturity') return row.maturityOn || DEFAULT_OPERATIONS_MATURITY_ON;
    if (col === 'form') return row.formSubmittedOn;
    if (col === 'review') return row.opsReviewedOn;
    if (col === 'payment') return row.paymentOn;
    if (col === 'due') return rupees(row.duePaise);
    if (col === 'recommended') return rupees(row.recommendedPaise);
    if (col === 'paidToday') return rupees(row.paidTodayPaise);
    if (col === 'paidCash') return (BigInt(row.paidCashTodayPaise) / 100n).toString();
    if (col === 'paidOnline') return (BigInt(row.paidOnlineTodayPaise) / 100n).toString();
    return '';
  }, []);

  function isSelected(r: number, c: number) {
    if (!selection) return false;
    return r >= selection.r0 && r <= selection.r1 && c >= selection.c0 && c <= selection.c1;
  }

  function focusCell(r: number, c: number, shift: boolean) {
    setFocus({ r, c });
    setAnchor((a) => (shift && a ? a : { r, c }));
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

  async function addRow() {
    if (!addRowBranchId || busy) return;
    setBusy('add-row');
    const result = await addMaturityOperationsRowAction(addRowBranchId);
    setBusy(null);
    if (!result.ok) toast.error(result.error); else { toast.success('A new editable row was added.'); router.refresh(); }
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
    if (col === 'taken' || col === 'notTaken' || col === 'recommended') return;
    const before = valueOf(row, col);
    let next = raw;
    if (col === 'amount' || col === 'due' || col === 'paidToday' || col === 'paidCash' || col === 'paidOnline') {
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
    } else if (col === 'paidCash') {
      await savePaid(row, BigInt(next || '0'), BigInt(row.paidOnlineTodayPaise) / 100n);
    } else if (col === 'paidOnline') {
      await savePaid(row, BigInt(row.paidCashTodayPaise) / 100n, BigInt(next || '0'));
    }
  }

  async function pasteAt(startR: number, startC: number, text: string) {
    const grid = parseClipboardGrid(text);
    if (grid.length === 0) return;
    if (grid.length > 80) {
      toast.error('Paste at most 80 rows at a time — each cell is saved with its own audit line.');
      return;
    }
    let written = 0;
    for (let i = 0; i < grid.length; i++) {
      const row = visible[startR + i];
      if (!row) continue;
      const line = grid[i] ?? [];
      for (let j = 0; j < line.length; j++) {
        const col = visColIds[startC + j];
        if (!col) continue;
        await applyCell(row, col, line[j] ?? '');
        written++;
      }
    }
    toast.success(`Pasted ${written} cell${written === 1 ? '' : 's'}`);
  }

  function copySelection() {
    if (!selection) return;
    const block: string[][] = [];
    for (let r = selection.r0; r <= selection.r1; r++) {
      const row = visible[r];
      if (!row) continue;
      const line: string[] = [];
      for (let c = selection.c0; c <= selection.c1; c++) {
        const col = visColIds[c];
        line.push(col ? valueOf(row, col) : '');
      }
      block.push(line);
    }
    void navigator.clipboard.writeText(serializeClipboardGrid(block));
    toast.success('Copied');
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey;
      if (meta && event.key.toLowerCase() === 'c') {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' && window.getSelection()?.toString()) return;
        if (selection) {
          event.preventDefault();
          copySelection();
        }
      }
      if (meta && event.key.toLowerCase() === 'v') {
        if (!focus || !canEdit) return;
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        event.preventDefault();
        void navigator.clipboard.readText().then((text) => pasteAt(focus.r, focus.c, text));
      }
      if (meta && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        const item = undoRef.current.pop();
        if (!item) return;
        event.preventDefault();
        const row = rows.find((r) => r.id === item.rowId);
        if (row) {
          redoRef.current.push(item);
          void applyCell(row, item.col, item.before, false);
        }
      }
      if (meta && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
        const item = redoRef.current.pop();
        if (!item) return;
        event.preventDefault();
        const row = rows.find((r) => r.id === item.rowId);
        if (row) {
          undoRef.current.push(item);
          void applyCell(row, item.col, item.after, false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const colCount = COLUMNS.filter(([id]) => show(id)).length;
  // Relative weights keep every visible column inside the available sheet width. They are
  // normalised again when an Admin hides columns, so the remaining cells still fill the row.
  const widths: [ColumnId, number][] = [
    ['account', 5.5], ['customer', 9], ['agent', 8.5], ['amount', 6.5],
    ['maturity', 7.5], ['form', 8.5], ['review', 7.5], ['payment', 7.5],
    ['due', 6], ['recommended', 7], ['paidToday', 5], ['paidCash', 5],
    ['paidOnline', 5], ['taken', 5.5], ['notTaken', 6.5],
  ];
  const visibleWeight = widths.filter(([id]) => show(id)).reduce((total, [, weight]) => total + weight, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--hairline)] bg-[var(--surface-solid)] p-0.5">
          <button type="button" onClick={() => setTab('work')} className={cn('px-3 py-2 text-[0.8125rem] font-medium', tab === 'work' && 'bg-[var(--color-brand-700)] font-semibold text-white dark:text-[var(--color-brand-950)]')}>Operations work · {rows.length}</button>
          <button type="button" onClick={() => setTab('unreviewed')} className={cn('px-3 py-2 text-[0.8125rem] font-medium', tab === 'unreviewed' && 'bg-[var(--color-brand-700)] font-semibold text-white dark:text-[var(--color-brand-950)]')}>Not reviewed · {rows.filter((row) => row.needsReview).length}</button>
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
        {isAdmin && (
          <div className="relative flex flex-wrap items-center gap-1 text-xs">
            <button type="button" disabled={!addRowBranchId || busy === 'add-row'} onClick={() => void addRow()} className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 font-semibold hover:bg-[var(--glass-bg-strong)] disabled:opacity-50"><Plus className="h-3.5 w-3.5" />Add row</button>
            <button type="button" onClick={() => setColumnsOpen((open) => !open)} className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 font-semibold hover:bg-[var(--glass-bg-strong)]"><Columns3 className="h-3.5 w-3.5" />Columns</button>
            {columnsOpen && (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 border border-[var(--hairline)] bg-[var(--surface-solid)] p-2 shadow-xl">
                <p className="mb-1.5 text-[0.68rem] font-bold uppercase tracking-wide text-[var(--muted-fg)]">Visible columns</p>
                {COLUMNS.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-2 px-1 py-1 hover:bg-[var(--glass-bg-subtle)]"><input type="checkbox" checked={show(id)} onChange={() => toggleColumn(id)} />{label}</label>)}
                <button type="button" onClick={() => { setHidden([]); localStorage.removeItem('maturityflow.ops.hidden-columns'); }} className="mt-2 w-full border border-[var(--hairline)] py-1 font-semibold">Show all</button>
              </div>
            )}
            {[[ '/maturities', 'Register' ], [ '/import', 'Import' ], [ '/audit', 'Audit' ], [ '/settings', 'Settings' ]].map(([href, label]) => <a key={href} href={href} className="inline-flex items-center gap-1 border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-1.5 text-[var(--muted-fg)] hover:text-[var(--page-fg)]">{label}<ExternalLink className="h-3 w-3" /></a>)}
          </div>
        )}
      </div>

      {tab === 'unreviewed' && <div className="flex items-start gap-2 border border-[color-mix(in_oklab,var(--color-warn-600)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-600)_8%,transparent)] px-3 py-2 text-xs text-[var(--muted-fg)]"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn-600)]" />These cases progressed automatically so payment was not delayed. Enter the actual Operations approval date when review is completed.</div>}

      <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[var(--muted-fg)]">
        <span className="inline-flex h-8 min-w-[4.5rem] items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-solid)] px-2 font-mono font-semibold text-[var(--page-fg)]" title="Active cell">
          {activeAddr || '—'}
        </span>
        <span>Click a cell and type. Shift-click a second cell to select a block. Ctrl+C copies, Ctrl+V pastes from Excel, Ctrl+Z undoes a cell.</span>
      </div>

      <div className="overflow-hidden border border-[var(--hairline)] bg-[var(--surface-solid)]">
        <div className="max-h-[72vh] overflow-x-hidden overflow-y-auto overscroll-contain">
          <table
            className="w-full table-fixed border-collapse text-[0.8125rem]"
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
                  <th key={id} className={cn(head, ['amount', 'due', 'recommended', 'paidToday', 'paidCash', 'paidOnline'].includes(id) && 'text-right')}>
                    <span className="block font-mono text-[0.58rem] font-bold text-[var(--color-brand-700)]">{columnLetter(colIndex)}</span>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, rowIndex) => {
                const paidCash = BigInt(row.paidCashTodayPaise) / 100n;
                const paidOnline = BigInt(row.paidOnlineTodayPaise) / 100n;
                const rowSurface = rowIndex % 2 === 0 ? 'bg-[var(--surface-solid)]' : 'bg-[var(--glass-bg-subtle)]';
                return (
                  <tr key={row.id} className={cn('group hover:bg-[color-mix(in_oklab,var(--color-brand-500)_7%,var(--surface-solid))]', rowSurface)}>
                    <td className={cn(cell, 'bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--surface-solid))] px-1 text-center font-mono text-[0.62rem] font-semibold text-[var(--muted-fg)]')}>{rowIndex + 1}</td>
                    {show('account') && <td className={cn(cell, row.needsReview && 'shadow-[inset_3px_0_0_var(--color-warn-500)]')}><EditableCell row={row.id} col="account" value={row.accountNumber} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('account'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('account'), shift)} onCommit={(v) => { pushUndo({ rowId: row.id, col: 'account', before: row.accountNumber, after: v }); return save(row.id, { accountNumber: v }).then(() => undefined); }} /></td>}
                    {show('customer') && <td className={cell}><EditableCell row={row.id} col="customer" value={row.customerName} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('customer'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('customer'), shift)} onCommit={(v) => { pushUndo({ rowId: row.id, col: 'customer', before: row.customerName, after: v }); return save(row.id, { customerName: v }).then(() => undefined); }} /></td>}
                    {show('agent') && <td className={cell}><EditableCell row={row.id} col="agent" value={row.agentName} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('agent'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('agent'), shift)} onCommit={(v) => { pushUndo({ rowId: row.id, col: 'agent', before: row.agentName, after: v }); return save(row.id, { agentName: v }).then(() => undefined); }} /></td>}
                    {show('amount') && <td className={cell}><EditableCell row={row.id} col="amount" type="money" value={row.maturityRupees} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('amount'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('amount'), shift)} onCommit={(v) => { pushUndo({ rowId: row.id, col: 'amount', before: row.maturityRupees, after: v }); return save(row.id, { maturityRupees: v }).then(() => undefined); }} /></td>}
                    {show('maturity') && <td className={cell}><EditableCell row={row.id} col="maturity" type="date" value={row.maturityOn || DEFAULT_OPERATIONS_MATURITY_ON} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('maturity'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('maturity'), shift)} onCommit={(v) => save(row.id, { instrumentMaturityOn: v || null }).then(() => undefined)} /></td>}
                    {show('form') && <td className={cell}><EditableCell row={row.id} col="form" type="date" value={row.formSubmittedOn} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('form'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('form'), shift)} onCommit={(v) => save(row.id, { formSubmittedOn: v }).then(() => undefined)} /></td>}
                    {show('review') && <td className={cell}><EditableCell row={row.id} col="review" type="date" value={row.opsReviewedOn} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('review'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('review'), shift)} onCommit={(v) => save(row.id, { opsReviewedOn: v || null }).then(() => undefined)} /></td>}
                    {show('payment') && <td className={cell}><EditableCell row={row.id} col="payment" type="date" value={row.paymentOn} disabled={!canEdit} selected={isSelected(rowIndex, visColIds.indexOf('payment'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('payment'), shift)} onCommit={(v) => save(row.id, { paymentOn: v || null }).then(() => undefined)} /></td>}
                    {show('due') && <td className={cell}><EditableCell row={row.id} col="due" type="money" value={rupees(row.duePaise)} disabled={!canSchedule && !canEdit} selected={isSelected(rowIndex, visColIds.indexOf('due'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('due'), shift)} onCommit={(v) => savePlanned(row, v)} /></td>}
                    {show('recommended') && <td className={cell}><EditableCell row={row.id} col="recommended" type="money" value={rupees(row.recommendedPaise)} disabled selected={isSelected(rowIndex, visColIds.indexOf('recommended'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('recommended'), shift)} onCommit={async () => {}} /></td>}
                    {show('paidToday') && <td className={cell}><EditableCell row={row.id} col="paidToday" type="money" value={rupees(row.paidTodayPaise)} disabled={!canPay} selected={isSelected(rowIndex, visColIds.indexOf('paidToday'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('paidToday'), shift)} onCommit={(v) => { const total = BigInt(v || '0'); const online = paidOnline > total ? 0n : paidOnline; return savePaid(row, total - online, online); }} /></td>}
                    {show('paidCash') && <td className={cell}><EditableCell row={row.id} col="paidCash" type="money" value={paidCash.toString()} disabled={!canPay} selected={isSelected(rowIndex, visColIds.indexOf('paidCash'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('paidCash'), shift)} onCommit={(v) => savePaid(row, BigInt(v || '0'), paidOnline)} /></td>}
                    {show('paidOnline') && <td className={cell}><EditableCell row={row.id} col="paidOnline" type="money" value={paidOnline.toString()} disabled={!canPay} selected={isSelected(rowIndex, visColIds.indexOf('paidOnline'))} onFocusCell={(shift) => focusCell(rowIndex, visColIds.indexOf('paidOnline'), shift)} onCommit={(v) => savePaid(row, paidCash, BigInt(v || '0'))} /></td>}
                    {show('taken') && <td className={cell}><button type="button" title="Mark as taken" aria-label="Mark as taken" disabled={!canPay || !row.todayInstalmentId || row.todayState === 'PAID' || busy === row.id} onClick={() => void mark(row, true)} className="flex h-9 w-full items-center justify-center gap-0.5 rounded-none bg-[var(--row-taken)] text-[0.65rem] font-bold text-[var(--row-taken-fg)] hover:bg-[var(--row-taken-strong)] disabled:cursor-not-allowed disabled:opacity-40 xl:text-[0.7rem]"><Check className="h-3 w-3 shrink-0" /><span className="hidden xl:inline">Taken</span></button></td>}
                    {show('notTaken') && <td className={cell}><button type="button" title="Mark as not taken" aria-label="Mark as not taken" disabled={!canPay || !row.todayInstalmentId || row.todayState === 'PAID' || busy === row.id} onClick={() => void mark(row, false)} className="flex h-9 w-full items-center justify-center gap-0.5 rounded-none bg-[var(--row-missed)] text-[0.65rem] font-bold text-[var(--row-missed-fg)] hover:bg-[var(--row-missed-strong)] disabled:cursor-not-allowed disabled:opacity-40 xl:text-[0.7rem]"><X className="h-3 w-3 shrink-0" /><span className="hidden xl:inline">Not taken</span></button></td>}
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={colCount + 1} className="px-4 py-12 text-center text-sm text-[var(--muted-fg)]">No cases in this list. Add a row or clear the filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-[var(--faint-fg)]">This sheet is the workspace — you do not need to format an Excel file and upload it. Paste from Excel or Google Sheets into the cell where the block should start. Taken and Not taken stay buttons because they move money.</p>
    </div>
  );
}
