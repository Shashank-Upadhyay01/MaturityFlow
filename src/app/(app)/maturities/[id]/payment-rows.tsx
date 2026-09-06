'use client';

import { Pencil, Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { reversePayoutAction } from '@/actions/payouts';
import { correctRegisterDayPaidAction } from '@/actions/register';
import { AdminDateCell } from '@/components/domain/admin-date-cell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { tryParseRupeesToPaise } from '@/lib/money';
import { formatISODateShort } from '@/lib/working-days';

export interface PaymentRow {
  id: string;
  cashPaise: string;
  onlinePaise: string;
  totalPaise: string;
  reference: string | null;
  valueDate: string;
  reversedAt: string | null;
  reversalReason: string | null;
  reversedByName: string | null;
  recordedByName: string | null;
  /**
   * The scheduled day this payment settles.
   *
   * Null on every row the Excel import wrote: those went in against the case with no instalment
   * behind them, carrying an opening balance from the branch's previous register rather than
   * answering a day this system planned. `correctInstalmentPaid` works from an instalment, so
   * those rows can be undone but not edited — and the list says so rather than offering a
   * control that would fail.
   */
  instalmentId: string | null;
  instalmentDueOn: string | null;
}

/** Rupees as the correction form wants them typed — exact, and no grouping to strip out again. */
function rupeeInput(paise: bigint): string {
  const whole = paise / 100n;
  const frac = paise % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, '0')}`;
}

interface CorrectionDraft {
  cash: string;
  online: string;
  reference: string;
  valueDate: string;
  reason: string;
}

export function PaymentRows({
  payments,
  canReverse,
  canCorrect = false,
  canEditDates = false,
}: {
  payments: PaymentRow[];
  canReverse: boolean;
  /**
   * Whether this actor may change a recorded payment rather than only undo it. Same answer the
   * server gives — `payout.reverse` plus the Admin / CMD / CEO date override — so the control
   * appears exactly where `correctRegisterDayPaidAction` will accept it.
   */
  canCorrect?: boolean;
  canEditDates?: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);

  /**
   * The other entries still standing against the same scheduled day.
   *
   * `correctInstalmentPaid` reverses everything live on the instalment and writes one entry in
   * its place — it corrects the day, not the row. Where a day carries more than one entry that
   * has to be said out loud before somebody edits one line and finds the other gone.
   */
  const liveOnDay = (instalmentId: string) =>
    payments.filter((p) => p.instalmentId === instalmentId && !p.reversedAt);

  async function reverse(id: string) {
    if (!reason.trim()) return toast.error('A reason is required — this is a money correction.');
    setBusy(true);
    const r = await reversePayoutAction(id, reason);
    setBusy(false);
    if (r.ok) {
      toast.success('Payment reversed', {
        description: 'The original entry is kept and flagged. Nothing was deleted.',
      });
      setTarget(null);
      setReason('');
      router.refresh();
    } else {
      toast.error(r.error);
    }
  }

  function openCorrection(t: PaymentRow) {
    if (!t.instalmentId) return;
    setTarget(null);
    setReason('');
    if (editing === t.id) {
      setEditing(null);
      setDraft(null);
      return;
    }
    // The form opens on the day as it stands, not on this one line, because that is what saving
    // it replaces.
    const live = liveOnDay(t.instalmentId);
    const cash = live.reduce((sum, row) => sum + BigInt(row.cashPaise), 0n);
    const online = live.reduce((sum, row) => sum + BigInt(row.onlinePaise), 0n);
    setEditing(t.id);
    setDraft({
      cash: rupeeInput(cash),
      online: rupeeInput(online),
      reference: t.reference ?? '',
      valueDate: t.valueDate,
      reason: '',
    });
  }

  async function saveCorrection(t: PaymentRow) {
    if (!t.instalmentId || !draft) return;
    if (!draft.reason.trim()) {
      return toast.error('A reason is required — this is a money correction.');
    }
    const online = draft.online.trim();
    const onlinePaise = online === '' ? 0n : tryParseRupeesToPaise(online);
    const cashPaise = draft.cash.trim() === '' ? 0n : tryParseRupeesToPaise(draft.cash.trim());
    if (onlinePaise == null || cashPaise == null) {
      return toast.error('Enter a rupee amount — digits, up to two decimal places.');
    }
    // INV-4: money that left by transfer is only recorded against the reference that proves it.
    if (onlinePaise > 0n && !draft.reference.trim()) {
      return toast.error('An online amount needs a UTR / transfer reference.');
    }
    setBusy(true);
    const r = await correctRegisterDayPaidAction(
      t.instalmentId,
      draft.cash.trim() || '0',
      draft.reason.trim(),
      draft.reference.trim() || null,
      online || '0',
      draft.valueDate || null,
    );
    setBusy(false);
    if (r.ok) {
      toast.success('Payment corrected', {
        description: 'The entry it replaces is kept and flagged, with your reason on it.',
      });
      setEditing(null);
      setDraft(null);
      router.refresh();
    } else {
      toast.error(r.error);
    }
  }

  if (payments.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
        Nothing has been paid out yet.
      </p>
    );
  }

  const editRow = editing ? payments.find((p) => p.id === editing) ?? null : null;
  const showActions = canReverse || canCorrect;

  return (
    <>
      <Table>
        <THead>
          <TH>Date</TH>
          <TH align="right">Cash</TH>
          <TH align="right">Online</TH>
          <TH>Reference</TH>
          <TH>By</TH>
          {showActions && <TH />}
        </THead>
        <TBody>
          {payments.map((t) => (
            <TR key={t.id} className={t.reversedAt ? 'opacity-55' : ''}>
              <TD>
                {canEditDates ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminDateCell
                      kind="payout"
                      id={t.id}
                      value={t.valueDate}
                      ariaLabel="Payout value date"
                    />
                    {t.reversedAt && (
                      <Badge tone="danger">reversed</Badge>
                    )}
                  </div>
                ) : (
                  <>
                    <span className={t.reversedAt ? 'line-through' : ''}>
                      {formatISODateShort(t.valueDate)}
                    </span>
                    {t.reversedAt && (
                      <Badge tone="danger" className="ml-2">
                        reversed
                      </Badge>
                    )}
                  </>
                )}
              </TD>
              <TD align="right" className={t.reversedAt ? 'line-through' : ''}>
                {BigInt(t.cashPaise) > 0n ? <Money paise={t.cashPaise} decimals={false} /> : '—'}
              </TD>
              <TD align="right" className={t.reversedAt ? 'line-through' : ''}>
                {BigInt(t.onlinePaise) > 0n ? <Money paise={t.onlinePaise} decimals={false} /> : '—'}
              </TD>
              <TD className="max-w-[9rem] truncate font-mono text-[0.75rem] text-[var(--muted-fg)]">
                {t.reference ?? '—'}
              </TD>
              <TD className="max-w-[10rem] truncate text-[var(--muted-fg)]">
                {t.recordedByName ?? '—'}
                {/*
                  The whole story of an undone entry on one line: who reversed it and why. It is
                  the question the next person reading this case asks first, and sending them to
                  the audit log for it is how a corrected payment reads as a missing one.
                */}
                {t.reversedAt && (
                  <span className="block text-[0.6875rem] text-[var(--color-danger-500)]">
                    reversed by {t.reversedByName ?? 'unknown'}
                    {t.reversalReason ? ` — ${t.reversalReason}` : ''}
                  </span>
                )}
              </TD>
              {showActions && (
                <TD align="right">
                  {!t.reversedAt && (
                    <div className="flex items-center justify-end gap-1">
                      {canCorrect &&
                        (t.instalmentId ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={editing === t.id}
                            onClick={() => openCorrection(t)}
                            title="Change this payment — amounts, reference, or the date it was given"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <span
                            className="text-[0.6875rem] text-[var(--faint-fg)]"
                            title="This entry came from the Excel import as an opening balance, so it is not attached to a scheduled day. Corrections work from a scheduled day, so this one can only be undone."
                          >
                            imported — undo only
                          </span>
                        ))}
                      {canReverse && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(null);
                            setDraft(null);
                            setTarget(target === t.id ? null : t.id);
                            setReason('');
                          }}
                          title="Reverse this payment"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </TD>
              )}
            </TR>
          ))}
        </TBody>
      </Table>

      {target && (
        <div className="px-5 pb-5 sm:px-6">
          <Glass className="mf-fade p-4">
            <Field
              label="Why is this payment being reversed?"
              required
              hint="The original entry is never deleted — it stays in the ledger, flagged, with this reason attached."
            >
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. wrong amount keyed in; cash was not actually handed over"
                autoFocus
              />
            </Field>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" loading={busy} onClick={() => reverse(target)}>
                <Undo2 className="h-3.5 w-3.5" />
                Reverse payment
              </Button>
            </div>
          </Glass>
        </div>
      )}

      {editRow && draft && (
        <div className="px-5 pb-5 sm:px-6">
          <Glass className="mf-fade p-4">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-700)]">
              Correct a recorded payment
            </p>
            <h3 className="mt-0.5 text-[0.95rem] font-semibold tracking-tight">
              {editRow.instalmentDueOn
                ? `Day of ${formatISODateShort(editRow.instalmentDueOn)}`
                : 'This payment'}
            </h3>
            <p className="mt-1 text-[0.78rem] text-[var(--muted-fg)]">
              Nothing is deleted. What stands against this day is reversed and flagged with your
              reason, and the figures below are recorded in its place — all in one audited
              transaction.
              {editRow.instalmentId && liveOnDay(editRow.instalmentId).length > 1 && (
                <span className="mt-1 block font-medium text-[var(--color-danger-500)]">
                  This day carries {liveOnDay(editRow.instalmentId).length} entries. A correction
                  replaces all of them with the single figure below — the boxes already hold their
                  total.
                </span>
              )}
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Cash (₹)">
                <Input
                  inputMode="decimal"
                  value={draft.cash}
                  onChange={(e) =>
                    setDraft({ ...draft, cash: e.target.value.replace(/[^0-9.]/g, '') })
                  }
                />
              </Field>
              <Field label="Online (₹)">
                <Input
                  inputMode="decimal"
                  value={draft.online}
                  onChange={(e) =>
                    setDraft({ ...draft, online: e.target.value.replace(/[^0-9.]/g, '') })
                  }
                />
              </Field>
              <Field
                label="UTR / transfer reference"
                hint="Required whenever any of this day goes out online."
              >
                <Input
                  value={draft.reference}
                  onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                  placeholder="Reference for the online part"
                />
              </Field>
              <Field
                label="Recorded on"
                hint="The day the money actually left the drawer, not today unless it really was today."
              >
                <Input
                  type="date"
                  value={draft.valueDate}
                  onChange={(e) => setDraft({ ...draft, valueDate: e.target.value })}
                />
              </Field>
            </div>

            <Field
              className="mt-3"
              label="Why is this payment being changed?"
              required
              hint="This goes into the audit trail and onto the entry it replaces."
            >
              <Textarea
                value={draft.reason}
                onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                placeholder="e.g. ₹5,000 keyed as ₹50,000; the customer was handed ₹5,000"
                autoFocus
              />
            </Field>

            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setDraft(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() => void saveCorrection(editRow)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Save correction
              </Button>
            </div>
          </Glass>
        </div>
      )}
    </>
  );
}
