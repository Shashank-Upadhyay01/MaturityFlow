'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, ShieldAlert, X } from 'lucide-react';
import { toast } from 'sonner';

import { markNotTakenAction, markTakenAction, saveRegisterFieldsAction } from '@/actions/register';
import { formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface OperationsRow {
  id: string;
  accountNumber: string;
  customerName: string;
  agentName: string;
  maturityRupees: string;
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

const money = (v: string) => formatPaise(BigInt(v), { decimals: false, symbol: false });
const inputClass =
  'h-8 w-full min-w-0 rounded-[5px] border border-transparent bg-transparent px-1.5 text-[0.75rem] text-[var(--page-fg)] outline-none transition-colors hover:border-[var(--input-border)] focus:border-[var(--ring)] focus:bg-[var(--input-bg)] disabled:opacity-65';
const head =
  'sticky top-0 z-10 border-b border-[var(--hairline)] bg-[var(--surface-solid)] px-2 py-2 text-left text-[0.625rem] font-semibold uppercase tracking-[0.055em] text-[var(--faint-fg)]';
const cell = 'border-b border-[var(--hairline)] px-1 py-0.5 align-middle';

function EditableCell({
  row,
  col,
  value,
  type = 'text',
  disabled,
  onCommit,
}: {
  row: string;
  col: string;
  value: string;
  type?: 'text' | 'date' | 'money';
  disabled: boolean;
  onCommit: (value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const commit = async () => {
    if (draft === value) return;
    await onCommit(draft);
  };
  return (
    <input
      data-ops-cell="true"
      data-ops-row={row}
      data-ops-col={col}
      className={cn(inputClass, type === 'money' && 'text-right tabular-nums')}
      type={type === 'date' ? 'date' : 'text'}
      inputMode={type === 'money' ? 'numeric' : undefined}
      value={draft}
      title={draft}
      disabled={disabled}
      onChange={(event) =>
        setDraft(type === 'money' ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)
      }
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setDraft(value);
          return;
        }
        const direction = event.key === 'Enter' ? 'ArrowDown' : event.key;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(direction)) return;
        event.preventDefault();
        const table = event.currentTarget.closest('table');
        if (!table) return;
        const all = Array.from(
          table.querySelectorAll<HTMLInputElement>('input[data-ops-cell="true"]:not(:disabled)'),
        );
        const peers = direction === 'ArrowUp' || direction === 'ArrowDown'
          ? all.filter((el) => el.dataset.opsCol === col)
          : all.filter((el) => el.dataset.opsRow === row);
        const at = peers.indexOf(event.currentTarget);
        const delta = direction === 'ArrowUp' || direction === 'ArrowLeft' ? -1 : 1;
        const next = peers[at + delta];
        next?.focus({ preventScroll: true });
        next?.select();
      }}
    />
  );
}

export function OperationsGrid({
  rows,
  canEdit,
  canPay,
  isAdmin,
}: {
  rows: OperationsRow[];
  canEdit: boolean;
  canPay: boolean;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'work' | 'unreviewed'>('work');
  const [busy, setBusy] = useState<string | null>(null);
  const visible = useMemo(
    () => (tab === 'unreviewed' ? rows.filter((row) => row.needsReview) : rows),
    [rows, tab],
  );

  async function save(id: string, patch: Parameters<typeof saveRegisterFieldsAction>[1]) {
    const result = await saveRegisterFieldsAction(id, patch);
    if (!result.ok) toast.error(result.error);
    else router.refresh();
  }

  async function mark(row: OperationsRow, taken: boolean) {
    if (!row.todayInstalmentId || busy) return;
    setBusy(row.id);
    const reference = taken && BigInt(row.todayOnlineDuePaise) > 0n
      ? window.prompt('Enter UTR / transfer reference for the online portion:')
      : null;
    if (taken && BigInt(row.todayOnlineDuePaise) > 0n && !reference?.trim()) {
      setBusy(null);
      return;
    }
    const result = taken
      ? await markTakenAction(row.todayInstalmentId, 'SPLIT', reference?.trim() || null)
      : await markNotTakenAction(row.todayInstalmentId, false);
    setBusy(null);
    if (!result.ok) toast.error(result.error);
    else router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-[9px] border border-[var(--hairline)] bg-[var(--glass-bg-subtle)] p-1">
          <button
            type="button"
            onClick={() => setTab('work')}
            className={cn('rounded-[7px] px-3 py-1.5 text-sm', tab === 'work' && 'bg-[var(--surface-solid)] font-semibold shadow-sm')}
          >
            Operations work · {rows.length}
          </button>
          <button
            type="button"
            onClick={() => setTab('unreviewed')}
            className={cn('rounded-[7px] px-3 py-1.5 text-sm', tab === 'unreviewed' && 'bg-[var(--surface-solid)] font-semibold shadow-sm')}
          >
            Not reviewed · {rows.filter((row) => row.needsReview).length}
          </button>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {[
              ['/maturities', 'Register'],
              ['/import', 'Import'],
              ['/audit', 'Audit'],
              ['/settings', 'Settings'],
            ].map(([href, label]) => (
              <a key={href} href={href} className="inline-flex items-center gap-1 rounded-[7px] border border-[var(--hairline)] px-2 py-1.5 text-[var(--muted-fg)] hover:bg-[var(--glass-bg-strong)] hover:text-[var(--page-fg)]">
                {label}<ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        )}
      </div>

      {tab === 'unreviewed' && (
        <div className="flex items-start gap-2 rounded-[10px] border border-[color-mix(in_oklab,var(--color-warn-600)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-600)_8%,transparent)] px-3 py-2 text-xs text-[var(--muted-fg)]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn-600)]" />
          These cases progressed automatically so payment was not delayed. Record the actual Operations review date when the check is completed.
        </div>
      )}

      <div className="overflow-hidden rounded-[12px] border border-[var(--glass-border)] bg-[var(--glass-bg)]">
        <div className="max-h-[72vh] overflow-auto">
          <table className="min-w-[69.625rem] w-full table-fixed border-collapse">
            <colgroup>
              {[70, 90, 72, 78, 116, 116, 116, 68, 77, 58, 58, 62, 64, 69].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {['Account number', 'Customer name', 'Agent name', 'Maturity amount', 'Form submission', 'Approval date', 'Payment date', 'Due payment', 'Recommended payment', 'Paid today', 'Paid in cash', 'Paid online', 'Taken', 'Not taken'].map((label) => (
                  <th key={label} className={cn(head, ['Maturity amount', 'Due payment', 'Recommended payment', 'Paid today', 'Paid in cash', 'Paid online'].includes(label) && 'text-right')}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const disabled = !canEdit;
                const due = BigInt(row.duePaise) > 0n;
                return (
                  <tr key={row.id} className={cn('hover:bg-[var(--glass-bg-subtle)]', row.needsReview && 'bg-[color-mix(in_oklab,var(--color-warn-600)_5%,transparent)]')}>
                    <td className={cell}><EditableCell row={row.id} col="account" value={row.accountNumber} disabled={disabled} onCommit={(v) => save(row.id, { accountNumber: v })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="customer" value={row.customerName} disabled={disabled} onCommit={(v) => save(row.id, { customerName: v })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="agent" value={row.agentName} disabled={disabled} onCommit={(v) => save(row.id, { agentName: v })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="amount" type="money" value={row.maturityRupees} disabled={disabled} onCommit={(v) => save(row.id, { maturityRupees: v })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="form" type="date" value={row.formSubmittedOn} disabled={disabled} onCommit={(v) => save(row.id, { formSubmittedOn: v })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="review" type="date" value={row.opsReviewedOn} disabled={disabled} onCommit={(v) => save(row.id, { opsReviewedOn: v || null })} /></td>
                    <td className={cell}><EditableCell row={row.id} col="payment" type="date" value={row.paymentOn} disabled={disabled} onCommit={(v) => save(row.id, { paymentOn: v || null })} /></td>
                    {[row.duePaise, row.recommendedPaise, row.paidTodayPaise, row.paidCashTodayPaise, row.paidOnlineTodayPaise].map((value, index) => (
                      <td key={index} className={cn(cell, 'px-2 text-right text-[0.75rem] font-medium tabular-nums')}>{money(value)}</td>
                    ))}
                    <td className={cell}>
                      <button type="button" disabled={!canPay || !due || row.todayState === 'PAID' || busy === row.id} onClick={() => void mark(row, true)} className="flex h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-[var(--row-taken)] text-xs font-semibold text-[var(--row-taken-fg)] hover:bg-[var(--row-taken-strong)] disabled:cursor-not-allowed disabled:opacity-45"><Check className="h-3.5 w-3.5" />Taken</button>
                    </td>
                    <td className={cell}>
                      <button type="button" disabled={!canPay || !due || row.todayState === 'PAID' || row.todayState === 'MISSED' || busy === row.id} onClick={() => void mark(row, false)} className="flex h-7 w-full items-center justify-center gap-1 rounded-[6px] bg-[var(--row-missed)] text-xs font-semibold text-[var(--row-missed-fg)] hover:bg-[var(--row-missed-strong)] disabled:cursor-not-allowed disabled:opacity-45"><X className="h-3.5 w-3.5" />Not taken</button>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={14} className="px-4 py-12 text-center text-sm text-[var(--muted-fg)]">No cases in this list.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-[var(--faint-fg)]">Arrow keys move between editable cells. Enter moves down. Escape restores the current value. Money is entered as whole rupees.</p>
    </div>
  );
}
