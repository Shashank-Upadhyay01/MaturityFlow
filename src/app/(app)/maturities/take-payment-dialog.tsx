'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatPaise, tryParseRupeesToPaise } from '@/lib/money';
import {
  leftoverOnPayoutDay,
  orderPaidCorrections,
  splitVisitTender,
  todayPaidUntickedPaise,
  visitReplacePlan,
  type PayoutDayView,
} from '@/lib/register-view';
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
    replaceVisit: boolean;
    corrections: {
      instalmentId: string;
      paidRupees: string;
      cashRupees: string;
      onlineRupees: string;
      previousPaidRupees: string;
    }[];
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
    const todayDay = days.find((day) => day.dueOn === today);
    if (todayDay && (leftover(todayDay) > 0n || (allowCorrectPaid && BigInt(todayDay.paidPaise) > 0n))) {
      next[todayDay.id] = true;
    }
    return next;
  });
  const draftPaise = tryParseRupeesToPaise(draftPaidRupees);
  const [custom, setCustom] = useState(() => {
    if (allowCorrectPaid) return '';
    return draftPaise != null && draftPaise > 0n ? (draftPaise / 100n).toString() : '';
  });
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
  const usingCustom = custom.trim() !== '' || online.trim() !== '';
  const payingAhead = selected.some((day) => day.dueOn > today);
  const rupeesOf = (paise: bigint) => (paise / 100n).toString();
  const paidEdits = allowCorrectPaid
    ? days
        .filter((day) => {
          const draft = paidDraft[day.id] ?? rupeesOf(BigInt(day.paidPaise));
          return draft !== rupeesOf(BigInt(day.paidPaise));
        })
        .map((day) => {
          const paidRupees = paidDraft[day.id] ?? '0';
          const paidPaise = tryParseRupeesToPaise(paidRupees) ?? 0n;
          return {
            instalmentId: day.id,
            paidRupees,
            cashRupees: paidRupees,
            onlineRupees: '0',
            previousPaidRupees: rupeesOf(BigInt(day.paidPaise)),
            paidPaise,
            previousPaidPaise: BigInt(day.paidPaise),
          };
        })
    : [];
  const visitReplace = Boolean(allowCorrectPaid && usingCustom && selected.length > 0);
  const visitCash = customPaise ?? 0n;
  const visitOnline = onlinePaise > 0n ? onlinePaise : 0n;
  const visitTotal = visitCash + visitOnline;
  const visitLines = visitReplace ? visitReplacePlan(selected, visitTotal) : [];
  const visitLegs = visitReplace ? splitVisitTender(visitLines, visitCash) : [];
  const visitCorrections = visitReplace
    ? orderPaidCorrections(visitLines)
        .filter((line) => line.paidPaise !== line.previousPaidPaise)
        .map((line) => {
          const leg = visitLegs.find((row) => row.id === line.id);
          return {
            instalmentId: line.id,
            paidRupees: rupeesOf(line.paidPaise),
            cashRupees: rupeesOf(leg?.cashPaise ?? line.paidPaise),
            onlineRupees: rupeesOf(leg?.onlinePaise ?? 0n),
            previousPaidRupees: rupeesOf(line.previousPaidPaise),
            paidPaise: line.paidPaise,
            previousPaidPaise: line.previousPaidPaise,
          };
        })
    : [];
  const visitIds = new Set(visitCorrections.map((row) => row.instalmentId));
  const corrections = orderPaidCorrections(
    visitReplace
      ? [...visitCorrections, ...paidEdits.filter((row) => !visitIds.has(row.instalmentId))]
      : paidEdits,
  );
  const willPay = visitReplace
    ? visitTotal
    : custom.trim() === '' && online.trim() === ''
      ? selectedLeft
      : customPaise != null && onlinePaise >= 0n
        ? customPaise + onlinePaise
        : 0n;
  const stackedTodayPaise = todayPaidUntickedPaise(days, ticked, today);
  const missedUnticked = visitReplace
    ? days.filter((day) => day.dueOn <= today && leftover(day) > 0n && !ticked[day.id])
    : [];
  const taking = visitReplace ? [] : selected.filter((day) => leftover(day) > 0n);
  const visitZeroing =
    visitReplace && visitTotal === 0n && selected.some((day) => BigInt(day.paidPaise) > 0n);
  const reasonNeeded = payingAhead || corrections.length > 0 || visitReplace;
  const canSubmit =
    (corrections.length > 0 || (taking.length > 0 && willPay > 0n)) &&
    onlinePaise >= 0n &&
    (onlinePaise === 0n || reference.trim().length > 0) &&
    (!reasonNeeded || reason.trim().length > 0) &&
    (!payingAhead || allowPayAhead) &&
    (!visitReplace || visitTotal > 0n || visitZeroing);

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
        aria-labelledby="take-pay-kicker take-pay-title"
        className="w-full max-w-lg rounded-[16px] border border-[var(--glass-border)] p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)]"
        style={{ background: 'var(--surface-solid)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <p
          id="take-pay-kicker"
          className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-700)]"
        >
          Record payment
        </p>
        <h2 id="take-pay-title" className="mt-0.5 text-[1.05rem] font-semibold tracking-tight">
          {row.customerName}
        </h2>
        <p className="mt-1 text-[0.78rem] text-[var(--muted-fg)]">
          {allowCorrectPaid
            ? 'Tick every day this visit covers, including today if today\'s payment is part of it. Type the amount actually given — that figure replaces paid on the ticked days, it is not added on top. You can also type a new Paid figure on any day.'
            : 'Tick unpaid days to pay them. Leave the amount blank to pay each ticked day in full, or type what was actually given.'}
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
            {allowCorrectPaid ? 'Visit total (cash)' : 'Custom amount (cash)'}
            <input
              className="mf-input mt-1 h-9 w-full tabular-nums"
              inputMode="numeric"
              placeholder={
                allowCorrectPaid
                  ? 'Whole visit for the ticked days'
                  : 'Leave blank to pay ticked days in full'
              }
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
        {reasonNeeded && (
          <label className="mt-2 block text-[0.72rem] text-[var(--muted-fg)]">
            {visitReplace || corrections.length > 0
              ? 'Reason for this visit / changing a recorded payment'
              : 'Reason for paying a day that is not due yet'}
            <input
              className="mf-input mt-1 h-9 w-full"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Required"
            />
          </label>
        )}

        {stackedTodayPaise > 0n && (
          <p className="mt-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--color-brand-50)] px-3 py-2 text-[0.75rem] text-[var(--color-brand-700)]">
            Today already shows ₹{inr(stackedTodayPaise)} paid and is not ticked. Tick today if
            ₹{inr(willPay)} is the whole visit (missed days + today). Leave it unticked only if
            you want this amount added on top of today's ₹{inr(stackedTodayPaise)}.
          </p>
        )}
        {missedUnticked.length > 0 && (
          <p className="mt-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--color-brand-50)] px-3 py-2 text-[0.75rem] text-[var(--color-brand-700)]">
            {missedUnticked.map((day) => formatDMY(day.dueOn)).join(', ')} still unpaid and not
            ticked. Tick those days if ₹{inr(willPay)} is meant to cover them as well as today.
          </p>
        )}

        {visitReplace && visitLines.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[0.75rem] text-[var(--muted-fg)]">
            {visitLines.map((line) => {
              const day = selected.find((row) => row.id === line.id);
              if (!day) return null;
              const changed = line.paidPaise !== line.previousPaidPaise;
              return (
                <li key={line.id} className="flex justify-between gap-3 tabular-nums">
                  <span>
                    {formatDMY(day.dueOn)}
                    {day.dueOn === today ? ' · today' : ''}
                  </span>
                  <span className={changed ? 'font-medium text-[var(--page-fg)]' : undefined}>
                    ₹{inr(line.paidPaise)}
                    {changed ? ` (was ₹${inr(line.previousPaidPaise)})` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-[0.8rem]">
          {visitReplace ? 'This visit ' : 'Paying '}
          <span className="font-semibold tabular-nums">₹{inr(willPay)}</span>
          {visitReplace
            ? ' — replaces paid on the ticked days, oldest first. Unpaid leftover stays on those days.'
            : custom.trim() === '' && online.trim() === ''
              ? ' — each ticked day in full.'
              : ' — onto the ticked days, oldest first.'}
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
                replaceVisit: visitReplace,
                corrections: corrections.map((row) => ({
                  instalmentId: row.instalmentId,
                  paidRupees: row.paidRupees,
                  cashRupees: row.cashRupees,
                  onlineRupees: row.onlineRupees,
                  previousPaidRupees: row.previousPaidRupees,
                })),
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
