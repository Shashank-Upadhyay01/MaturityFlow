'use client';

import { Undo2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { reversePayoutAction } from '@/actions/payouts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
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
  recordedByName: string | null;
}

export function PaymentRows({
  payments,
  canReverse,
}: {
  payments: PaymentRow[];
  canReverse: boolean;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (payments.length === 0) {
    return (
      <p className="px-6 py-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
        Nothing has been paid out yet.
      </p>
    );
  }

  return (
    <>
      <Table>
        <THead>
          <TH>Date</TH>
          <TH align="right">Cash</TH>
          <TH align="right">Online</TH>
          <TH>Reference</TH>
          <TH>By</TH>
          {canReverse && <TH />}
        </THead>
        <TBody>
          {payments.map((t) => (
            <TR key={t.id} className={t.reversedAt ? 'opacity-55' : ''}>
              <TD>
                <span className={t.reversedAt ? 'line-through' : ''}>
                  {formatISODateShort(t.valueDate)}
                </span>
                {t.reversedAt && (
                  <Badge tone="danger" className="ml-2">
                    reversed
                  </Badge>
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
              <TD className="max-w-[8rem] truncate text-[var(--muted-fg)]">
                {t.recordedByName ?? '—'}
                {t.reversalReason && (
                  <span className="block text-[0.6875rem] text-[var(--color-danger-500)]">
                    {t.reversalReason}
                  </span>
                )}
              </TD>
              {canReverse && (
                <TD align="right">
                  {!t.reversedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTarget(target === t.id ? null : t.id);
                        setReason('');
                      }}
                      title="Reverse this payment"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
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
    </>
  );
}
