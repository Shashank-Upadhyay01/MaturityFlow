'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatPaise, tryParseRupeesToPaise } from '@/lib/money';
import { leftoverOnPayoutDay, type PayoutDayView } from '@/lib/register-view';
import { formatDMY } from '@/lib/working-days';

export interface PayDialogRow {
  id: string;
  customerName: string;
  payoutDays: PayoutDayView[];
}

function inr(p: bigint) {
  return formatPaise(p, { decimals: false, symbol: false });
}

function leftover(day: PayoutDayView): bigint {
  return leftoverOnPayoutDay(day);
}

export function TakePaymentDialog({
  row,
  today,
  draftPaidRupees,
  allowPayAhead,
  allowCorrectPaid,
  busy,
  onClose,
  onConfirm,
}: {
  row: PayDialogRow;
  today: string;
  draftPaidRupees: string;
  allowPayAhead: boolean;
  allowCorrectPaid?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (input: {
    instalmentIds: string[];
    cashRupees: string | null;
    onlineRupees: string | null;
    reference: string | null;
    reason: string | null;
    corrections: { instalmentId: string; paidRupees: string }[];
  }) => Promise<void>;
}) {
  const days = useMemo(
    () =>
      [...(row.payoutDays ?? [])]
        .filter((day) => day.status !== 'SUPERSEDED' && day.status !== 'CANCELLED')
        .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0)),
    [row.payoutDays],
  );

  const [ticked, setTicked] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    const todayDay = days.find((day) => day.dueOn === today && leftover(day) > 0n);
    if (todayDay) next[todayDay.id] = true;
    return next;
  });
  const draftPaise = tryParseRupeesToPaise(draftPaidRupees);
  const [custom, setCustom] = useState(() =>
    draftPaise != null && draftPaise > 0n ? (draftPaise / 100n).toString() : '',
  );
  const [online, setOnline] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [paidDraft, setPaidDraft] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const day of days) next[day.id] = (BigInt(day.paidPaise) / 100n).toString();
    return next;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const selected = days.filter((day) => ticked[day.id]);
  const selectedLeft = selected.reduce((sum, day) => sum + leftover(day), 0n);
  const remainingAll = days.reduce((sum, day) => sum + leftover(day), 0n);
  const recRupees = (payoutDays: number) =>
    remainingAll <= 0n ? 0n : remainingAll / 100n / BigInt(payoutDays);
  const customPaise = custom.trim() === '' ? null : tryParseRupeesToPaise(custom);
  const onlinePaise = online.trim() === '' ? 0n : (tryParseRupeesToPaise(online) ?? -1n);
  const payingAhead = selected.some((day) => day.dueOn > today);
  const corrections = allowCorrectPaid
    ? days
        .filter((day) => {
          const draft = paidDraft[day.id] ?? (BigInt(day.paidPaise) / 100n).toString();
          return draft !== (BigInt(day.paidPaise) / 100n).toString();
        })
        .map((day) => ({ instalmentId: day.id, paidRupees: paidDraft[day.id] ?? '0' }))
    : [];
  const willPay =
    custom.trim() === '' && online.trim() === ''
      ? selectedLeft
      : customPaise != null && onlinePaise >= 0n
        ? customPaise + onlinePaise
        : 0n;

  const taking = selected.filter((day) => leftover(day) > 0n);
  const canSubmit =
    (corrections.length > 0 && reason.trim().length > 0) ||
    (taking.length > 0 &&
      willPay > 0n &&
      onlinePaise >= 0n &&
      (onlinePaise === 0n || reference.trim().length > 0) &&
      (!payingAhead || (allowPayAhead && reason.trim().length > 0)));

  function toggle(day: PayoutDayView) {
    const left = leftover(day);
    if (left <= 0n && !allowCorrectPaid) return;
    if (day.dueOn > today && !allowPayAhead) return;
    setTicked((cur) => ({ ...cur, [day.id]: !cur[day.id] }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"
      style={{ background: 'color-mix(in oklab, black 45%, transparent)' }}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Record payment"
        aria-labelledby="take-pay-title"
        className="w-full max-w-lg rounded-[16px] border border-[var(--glass-border)] p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)]"
        style={{ background: 'var(--surface-solid)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-700)]">
          Record payment
        </p>
        <h2 id="take-pay-title" className="mt-0.5 text-[1.05rem] font-semibold tracking-tight">
          {row.customerName}
        </h2>
        <p className="mt-1 text-[0.78rem] text-[var(--muted-fg)]">
          Tick unpaid days to pay them. {allowCorrectPaid
            ? 'To change an old paid day, type the new Paid figure and a reason, then save.'
            : 'Leave the amount blank to pay each ticked day in full, or type what was actually given.'}
        </p>

        <div className="mt-3 max-h-[16rem] overflow-auto rounded-[12px] border border-[var(--hairline)]">
          <table className="w-full text-left text-[0.75rem]">
            <thead>
              <tr className="border-b border-[var(--hairline)] text-[0.62rem] font-bold uppercase tracking-[0.04em] text-[var(--muted-fg)]">
                <th className="w-8 px-2 py-1.5" />
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5 text-right">Planned</th>
                <th className="px-2 py-1.5 text-right">Paid</th>
                <th className="px-2 py-1.5 text-right">Still unpaid</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[var(--muted-fg)]">
                    This row has no schedule yet.
                  </td>
                </tr>
              )}
              {days.map((day) => {
                const left = leftover(day);
                const future = day.dueOn > today;
                const locked = (left <= 0n && !allowCorrectPaid) || (future && !allowPayAhead);
                const isToday = day.dueOn === today;
                return (
                  <tr
                    key={day.id}
                    className={
                      left <= 0n
                        ? 'text-[var(--faint-fg)]'
                        : future
                          ? 'text-[var(--muted-fg)]'
                          : isToday
                            ? 'bg-[var(--color-brand-50)]'
                            : day.dueOn < today
                              ? 'bg-[var(--row-missed)]/40'
                              : undefined
                    }
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={Boolean(ticked[day.id])}
                        disabled={locked}
                        aria-label={`Pay ${formatDMY(day.dueOn)}`}
                        onChange={() => toggle(day)}
                      />
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {formatDMY(day.dueOn)}
                      {isToday ? ' · today' : future ? ' · later' : ' · missed'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{inr(BigInt(day.amountPaise))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {allowCorrectPaid ? (
                        <input
                          className="mf-input h-7 w-24 py-0 text-right tabular-nums"
                          inputMode="numeric"
                          aria-label={`Paid on ${formatDMY(day.dueOn)}`}
                          value={paidDraft[day.id] ?? '0'}
                          onChange={(event) => {
                            const value = event.target.value.replace(/[^0-9]/g, '');
                            setPaidDraft((cur) => ({ ...cur, [day.id]: value }));
                          }}
                        />
                      ) : (
                        inr(BigInt(day.paidPaise))
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{inr(left)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {remainingAll > 0n && (
          <p className="mt-2 text-[0.72rem] text-[var(--muted-fg)]">
            Recommended if split evenly — 12 days ₹{inr(recRupees(12) * 100n)}, 6 days ₹
            {inr(recRupees(6) * 100n)}, 3 days ₹{inr(recRupees(3) * 100n)}. Advice only.
          </p>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block text-[0.72rem] text-[var(--muted-fg)]">
            Custom amount (cash)
            <input
              className="mf-input mt-1 h-9 w-full tabular-nums"
              inputMode="numeric"
              placeholder="Leave blank to pay ticked days in full"
              value={custom}
              onChange={(event) => setCustom(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
          <label className="block text-[0.72rem] text-[var(--muted-fg)]">
            Online (optional)
            <input
              className="mf-input mt-1 h-9 w-full tabular-nums"
              inputMode="numeric"
              placeholder="0"
              value={online}
              onChange={(event) => setOnline(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
        </div>
        {onlinePaise > 0n && (
          <label className="mt-2 block text-[0.72rem] text-[var(--muted-fg)]">
            UTR / transfer reference
            <input
              className="mf-input mt-1 h-9 w-full"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Required for the online part"
            />
          </label>
        )}
        {(payingAhead || corrections.length > 0) && (
          <label className="mt-2 block text-[0.72rem] text-[var(--muted-fg)]">
            {corrections.length > 0
              ? 'Reason for changing a recorded payment'
              : 'Reason for paying a day that is not due yet'}
            <input
              className="mf-input mt-1 h-9 w-full"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}

        <p className="mt-3 text-[0.8rem]">
          Paying <span className="font-semibold tabular-nums">₹{inr(willPay)}</span>
          {custom.trim() === '' && online.trim() === ''
            ? ' — each ticked day in full'
            : ' — onto the ticked days, oldest first'}
          .
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="success"
            size="sm"
            disabled={!canSubmit || busy}
            loading={busy}
            onClick={() =>
              void onConfirm({
                instalmentIds: taking.map((day) => day.id),
                cashRupees: custom.trim() === '' && online.trim() === '' ? null : custom.trim() || '0',
                onlineRupees: custom.trim() === '' && online.trim() === '' ? null : online.trim() || '0',
                reference: reference.trim() || null,
                reason: reason.trim() || null,
                corrections,
              })
            }
          >
            Record payment
          </Button>
        </div>
      </div>
    </div>
  );
}
