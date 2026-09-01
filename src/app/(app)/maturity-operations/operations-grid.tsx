'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Columns3, ExternalLink, Plus, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { setInstalmentAmountAction } from '@/actions/cases';
import {
  addMaturityOperationsRowAction,
  markNotTakenAction,
  markTakenAction,
  saveRegisterFieldsAction,
  setTodayPaidSplitAction,
} from '@/actions/register';
import { DEFAULT_OPERATIONS_MATURITY_ON } from '@/lib/maturity-operations';
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
const inputClass = 'h-8 w-full min-w-0 rounded-none border-0 bg-transparent px-1.5 text-[0.75rem] text-[var(--page-fg)] outline-none focus:bg-[var(--input-bg)] focus:shadow-[inset_0_0_0_2px_var(--ring)] disabled:cursor-default disabled:opacity-65';
const head = 'sticky top-0 z-10 border border-[var(--hairline)] bg-[var(--surface-solid)] px-1.5 py-1.5 text-left text-[0.625rem] font-bold uppercase leading-tight tracking-[0.035em] text-[var(--muted-fg)]';
const cell = 'border border-[var(--hairline)] p-0 align-middle';

function EditableCell({ row, col, value, type = 'text', disabled, onCommit }: {
  row: string;
  col: string;
  value: string;
  type?: 'text' | 'date' | 'money';
  disabled: boolean;
  onCommit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = async () => { if (draft !== value) await onCommit(draft); };

  return (
    <input
      data-ops-cell="true" data-ops-row={row} data-ops-col={col}
      className={cn(inputClass, type === 'money' && 'text-right tabular-nums')}
      type={type === 'date' ? 'date' : 'text'} inputMode={type === 'money' ? 'numeric' : undefined}
      value={draft} title={draft} disabled={disabled}
      onFocus={(event) => event.currentTarget.select()}
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

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('maturityflow.ops.hidden-columns') || '[]');
      if (Array.isArray(stored)) setHidden(stored.filter((id): id is ColumnId => COLUMNS.some(([key]) => key === id)));
    } catch { /* Show the complete table if browser storage is invalid. */ }
  }, []);

  const visible = useMemo(() => tab === 'unreviewed' ? rows.filter((row) => row.needsReview) : rows, [rows, tab]);
  const show = (id: ColumnId) => !hidden.includes(id);
  const toggleColumn = (id: ColumnId) => {
    const next = hidden.includes(id) ? hidden.filter((key) => key !== id) : [...hidden, id];
    setHidden(next);
    localStorage.setItem('maturityflow.ops.hidden-columns', JSON.stringify(next));
  };

  async function save(id: string, patch: Parameters<typeof saveRegisterFieldsAction>[1]) {
    const result = await saveRegisterFieldsAction(id, patch);
    if (!result.ok) toast.error(result.error); else router.refresh();
  }

  async function savePlanned(row: OperationsRow, amount: string) {
    if (!row.todayInstalmentId) { toast.error('This row has no scheduled payment for today. Change its Payment Date first.'); return; }
    const result = await setInstalmentAmountAction(row.id, row.todayInstalmentId, amount || '0');
    if (!result.ok) toast.error(result.error); else router.refresh();
  }

  async function savePaid(row: OperationsRow, cash: bigint, online: bigint) {
    if (!row.todayInstalmentId) { toast.error('This row has no scheduled payment for today.'); return; }
    const reference = online > 0n ? window.prompt('Enter UTR / transfer reference for the online amount:') : null;
    if (online > 0n && !reference?.trim()) return;
    const replacing = BigInt(row.paidTodayPaise) > 0n;
    const reason = replacing ? window.prompt('Reason for correcting the recorded payment:', 'Spreadsheet correction') : 'Spreadsheet entry';
    if (replacing && !reason?.trim()) return;
    const result = await setTodayPaidSplitAction(row.todayInstalmentId, cash.toString(), online.toString(), reference?.trim() || null, reason?.trim() || null);
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

  const colCount = COLUMNS.filter(([id]) => show(id)).length;
  const widths: [ColumnId, number][] = [['account', 70], ['customer', 90], ['agent', 78], ['amount', 78], ['maturity', 116], ['form', 116], ['review', 116], ['payment', 116], ['due', 70], ['recommended', 90], ['paidToday', 66], ['paidCash', 66], ['paidOnline', 66], ['taken', 64], ['notTaken', 68]];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex border border-[var(--hairline)] bg-[var(--surface-solid)] p-0.5">
          <button type="button" onClick={() => setTab('work')} className={cn('px-3 py-1.5 text-xs', tab === 'work' && 'bg-[var(--color-brand-700)] font-semibold text-white')}>Operations work · {rows.length}</button>
          <button type="button" onClick={() => setTab('unreviewed')} className={cn('px-3 py-1.5 text-xs', tab === 'unreviewed' && 'bg-[var(--color-brand-700)] font-semibold text-white')}>Not reviewed · {rows.filter((row) => row.needsReview).length}</button>
        </div>
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

      <div className="overflow-hidden border border-[var(--hairline)] bg-[var(--surface-solid)]">
        <div className="max-h-[72vh] overflow-auto overscroll-contain">
          <table className="w-full min-w-[79.375rem] table-fixed border-collapse text-[0.72rem]">
            <colgroup>{widths.filter(([id]) => show(id)).map(([id, width]) => <col key={id} style={{ width }} />)}</colgroup>
            <thead><tr>{COLUMNS.filter(([id]) => show(id)).map(([id, label]) => <th key={id} className={cn(head, ['amount', 'due', 'recommended', 'paidToday', 'paidCash', 'paidOnline'].includes(id) && 'text-right')}>{label}</th>)}</tr></thead>
            <tbody>
              {visible.map((row) => {
                const due = BigInt(row.duePaise) > 0n;
                const paidCash = BigInt(row.paidCashTodayPaise) / 100n;
                const paidOnline = BigInt(row.paidOnlineTodayPaise) / 100n;
                return (
                  <tr key={row.id} className={cn('odd:bg-[var(--surface-solid)] even:bg-[var(--glass-bg-subtle)] hover:bg-[color-mix(in_oklab,var(--color-brand-500)_7%,var(--surface-solid))]', row.needsReview && 'bg-[color-mix(in_oklab,var(--color-warn-600)_6%,var(--surface-solid))]')}>
                    {show('account') && <td className={cell}><EditableCell row={row.id} col="account" value={row.accountNumber} disabled={!canEdit} onCommit={(v) => save(row.id, { accountNumber: v })} /></td>}
                    {show('customer') && <td className={cell}><EditableCell row={row.id} col="customer" value={row.customerName} disabled={!canEdit} onCommit={(v) => save(row.id, { customerName: v })} /></td>}
                    {show('agent') && <td className={cell}><EditableCell row={row.id} col="agent" value={row.agentName} disabled={!canEdit} onCommit={(v) => save(row.id, { agentName: v })} /></td>}
                    {show('amount') && <td className={cell}><EditableCell row={row.id} col="amount" type="money" value={row.maturityRupees} disabled={!canEdit} onCommit={(v) => save(row.id, { maturityRupees: v })} /></td>}
                    {show('maturity') && <td className={cell}><EditableCell row={row.id} col="maturity" type="date" value={row.maturityOn || DEFAULT_OPERATIONS_MATURITY_ON} disabled={!canEdit} onCommit={(v) => save(row.id, { instrumentMaturityOn: v || null })} /></td>}
                    {show('form') && <td className={cell}><EditableCell row={row.id} col="form" type="date" value={row.formSubmittedOn} disabled={!canEdit} onCommit={(v) => save(row.id, { formSubmittedOn: v })} /></td>}
                    {show('review') && <td className={cell}><EditableCell row={row.id} col="review" type="date" value={row.opsReviewedOn} disabled={!canEdit} onCommit={(v) => save(row.id, { opsReviewedOn: v || null })} /></td>}
                    {show('payment') && <td className={cell}><EditableCell row={row.id} col="payment" type="date" value={row.paymentOn} disabled={!canEdit} onCommit={(v) => save(row.id, { paymentOn: v || null })} /></td>}
                    {show('due') && <td className={cell}><EditableCell row={row.id} col="due" type="money" value={rupees(row.duePaise)} disabled={!canSchedule} onCommit={(v) => savePlanned(row, v)} /></td>}
                    {show('recommended') && <td className={cell}><EditableCell row={row.id} col="recommended" type="money" value={rupees(row.recommendedPaise)} disabled={!canSchedule} onCommit={(v) => savePlanned(row, v)} /></td>}
                    {show('paidToday') && <td className={cell}><EditableCell row={row.id} col="paidToday" type="money" value={rupees(row.paidTodayPaise)} disabled={!canPay} onCommit={(v) => { const total = BigInt(v || '0'); const online = paidOnline > total ? 0n : paidOnline; return savePaid(row, total - online, online); }} /></td>}
                    {show('paidCash') && <td className={cell}><EditableCell row={row.id} col="paidCash" type="money" value={paidCash.toString()} disabled={!canPay} onCommit={(v) => savePaid(row, BigInt(v || '0'), paidOnline)} /></td>}
                    {show('paidOnline') && <td className={cell}><EditableCell row={row.id} col="paidOnline" type="money" value={paidOnline.toString()} disabled={!canPay} onCommit={(v) => savePaid(row, paidCash, BigInt(v || '0'))} /></td>}
                    {show('taken') && <td className={cell}><button type="button" disabled={!canPay || !due || row.todayState === 'PAID' || busy === row.id} onClick={() => void mark(row, true)} className="flex h-8 w-full items-center justify-center gap-1 rounded-none bg-[var(--row-taken)] text-[0.68rem] font-bold text-[var(--row-taken-fg)] hover:bg-[var(--row-taken-strong)] disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-3.5 w-3.5" />Taken</button></td>}
                    {show('notTaken') && <td className={cell}><button type="button" disabled={!canPay || !due || row.todayState === 'PAID' || row.todayState === 'MISSED' || busy === row.id} onClick={() => void mark(row, false)} className="flex h-8 w-full items-center justify-center gap-1 rounded-none bg-[var(--row-missed)] text-[0.68rem] font-bold text-[var(--row-missed-fg)] hover:bg-[var(--row-missed-strong)] disabled:cursor-not-allowed disabled:opacity-40"><X className="h-3.5 w-3.5" />Not taken</button></td>}
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={colCount} className="px-4 py-12 text-center text-sm text-[var(--muted-fg)]">No cases in this list.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-[var(--faint-fg)]">Click a cell and type. Arrow keys move cell-to-cell, Enter moves down, Delete or Backspace clears the selected value, and Escape restores it. Money uses whole rupees.</p>
    </div>
  );
}
