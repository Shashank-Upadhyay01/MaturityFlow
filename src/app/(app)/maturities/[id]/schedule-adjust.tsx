'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { adjustUnpaidInstalmentsAction } from '@/actions/cases';
import { Button } from '@/components/ui/button';
import { MoneyInput } from '@/components/ui/field';
import { formatPaise, paiseToDecimalString, tryParseRupeesToPaise } from '@/lib/money';

export function ScheduleAdjust({
  caseId,
  rows,
}: {
  caseId: string;
  rows: { id: string; seq: number; amountPaise: string; paidPaise: string; status: string }[];
}) {
  const router = useRouter();
  const unpaid = rows.filter((r) => r.status !== 'PAID' && r.status !== 'SUPERSEDED');
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(unpaid.map((r) => [r.id, paiseToDecimalString(BigInt(r.amountPaise))])),
  );
  const [busy, setBusy] = useState(false);

  const remainingTarget = useMemo(
    () =>
      unpaid.reduce((a, r) => {
        const paid = BigInt(r.paidPaise);
        const amt = BigInt(r.amountPaise);
        return a + (amt > paid ? amt - paid : 0n);
      }, 0n),
    [unpaid],
  );

  const typedTotal = useMemo(() => {
    let t = 0n;
    for (const u of unpaid) {
      const parsed = tryParseRupeesToPaise(vals[u.id] ?? '0');
      if (parsed == null) return null;
      t += parsed;
    }
    return t;
  }, [unpaid, vals]);

  if (unpaid.length === 0) return null;

  const mismatch = typedTotal != null && typedTotal !== remainingTarget;

  return (
    <div className="border-t px-5 py-4 sm:px-6">
      {!open ? (
        <Button variant="glass" size="sm" onClick={() => setOpen(true)}>
          Tweak unpaid daily amounts
        </Button>
      ) : (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (mismatch) {
              toast.error('Unpaid days must still add up to the remaining amount.');
              return;
            }
            setBusy(true);
            const r = await adjustUnpaidInstalmentsAction(
              caseId,
              unpaid.map((u) => ({ id: u.id, amountRupees: vals[u.id] ?? '0' })),
            );
            setBusy(false);
            if (r.ok) {
              toast.success('Schedule updated');
              setOpen(false);
              router.refresh();
            } else toast.error(r.error);
          }}
        >
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">
            Move rupees between unpaid days. The remaining total cannot change
            ({formatPaise(remainingTarget, { decimals: false })}).
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {unpaid.map((u) => (
              <label key={u.id} className="text-[0.75rem]">
                Day {u.seq}
                <MoneyInput
                  value={vals[u.id] ?? ''}
                  onChange={(e) => setVals((s) => ({ ...s, [u.id]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          {mismatch && (
            <p className="text-[0.75rem] font-medium text-[var(--color-danger-500)]">
              Typed total {typedTotal != null ? formatPaise(typedTotal, { decimals: false }) : '—'}{' '}
              does not match remaining {formatPaise(remainingTarget, { decimals: false })}.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={mismatch}>
              Save amounts
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
