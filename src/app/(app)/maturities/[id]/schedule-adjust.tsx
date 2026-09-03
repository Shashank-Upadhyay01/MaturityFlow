'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { setInstalmentAmountAction } from '@/actions/cases';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/field';
import { formatPaise, paiseToDecimalString, tryParseRupeesToPaise } from '@/lib/money';
import { rebalanceAfter, type EditableInstalment } from '@/lib/schedule-edit';
import { formatDMY } from '@/lib/working-days';
import { cn } from '@/lib/utils';

export interface AdjustRow {
  id: string;
  seq: number;
  dueOn: string;
  amountPaise: string;
  paidPaise: string;
  status: string;
  isFinal: boolean;
}

/**
 * Change one day; the rest of the schedule follows.
 *
 * The clerk edits a single figure and the later days move underneath it as they type. That
 * preview is `rebalanceAfter` — the very same function the server runs on save, from rows it
 * re-reads under lock — so what is on screen is what gets written. The old version of this
 * screen made the clerk retype every day until the column added up, and refused to save until
 * it did.
 */
export function ScheduleAdjust({
  caseId,
  roundingPaise,
  rows,
}: {
  caseId: string;
  roundingPaise: string;
  rows: AdjustRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const live = useMemo(
    () => rows.filter((r) => r.status !== 'SUPERSEDED').sort((a, b) => a.seq - b.seq),
    [rows],
  );

  const editable: EditableInstalment[] = useMemo(
    () =>
      live.map((r) => ({
        id: r.id,
        seq: r.seq,
        dueOn: r.dueOn,
        amountPaise: BigInt(r.amountPaise),
        paidPaise: BigInt(r.paidPaise),
        isFinal: r.isFinal,
      })),
    [live],
  );

  const step = useMemo(() => BigInt(roundingPaise || '1'), [roundingPaise]);

  /** Live preview of the edit, by the same rule the server will apply. */
  const preview = useMemo(() => {
    if (!editingId) return null;
    const paise = tryParseRupeesToPaise(draft.trim() || '0');
    if (paise == null) {
      return { ok: false as const, error: 'NEGATIVE_AMOUNT' as const, message: 'Enter a rupee amount.' };
    }
    return rebalanceAfter(editable, editingId, paise, step);
  }, [editable, editingId, draft, step]);

  const shown = preview?.ok ? preview.instalments : editable;
  const total = shown.reduce((a, r) => a + r.amountPaise, 0n);

  if (live.length === 0) return null;

  const startEdit = (r: EditableInstalment) => {
    setEditingId(r.id);
    setDraft(paiseToDecimalString(r.amountPaise));
  };

  return (
    <div className="border-t px-5 py-4 sm:px-6">
      {!open ? (
        <Button variant="glass" size="sm" onClick={() => setOpen(true)}>
          Adjust a day
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">
            Change any day, including one already paid. Other unpaid days move to keep the total at{' '}
            <strong className="font-medium text-[var(--page-fg)]">
              {formatPaise(total, { decimals: false })}
            </strong>
            . Days already paid are never touched.
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((r, i) => {
              const was = editable[i];
              const moved = r.amountPaise !== was.amountPaise;
              const fullyPaid = was.paidPaise >= was.amountPaise;
              const isEditing = editingId === r.id;
              return (
                <div
                  key={r.id}
                  className={cn(
                    'rounded-[8px] border p-2',
                    moved
                      ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]'
                      : 'border-[var(--input-border)]',
                  )}
                >
                  <div className="flex items-baseline justify-between text-[0.7rem] text-[var(--muted-fg)]">
                    <span>
                      Day {r.seq} · {formatDMY(r.dueOn)}
                    </span>
                    {fullyPaid && <span className="font-medium">paid</span>}
                  </div>
                  {isEditing ? (
                    <MoneyInput
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(was)}
                      className={cn(
                        'mt-0.5 w-full text-left text-[0.9375rem] font-semibold tabular-nums hover:text-[var(--color-brand-600)]',
                      )}
                    >
                      {formatPaise(r.amountPaise, { decimals: false })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {preview && !preview.ok && (
            <p className="text-[0.75rem] font-medium text-[var(--color-danger-500)]">
              {preview.message}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!editingId || !preview?.ok}
              onClick={async () => {
                if (!editingId) return;
                setBusy(true);
                const r = await setInstalmentAmountAction(caseId, editingId, draft.trim() || '0');
                setBusy(false);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  r.data?.changed === 1 ? 'Day updated' : `${r.data?.changed ?? 0} days re-balanced`,
                );
                setEditingId(null);
                setOpen(false);
                router.refresh();
              }}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingId(null);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
