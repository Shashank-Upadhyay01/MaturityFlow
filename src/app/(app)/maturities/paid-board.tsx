'use client';

import { Banknote, Landmark, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Glass } from '@/components/ui/glass';
import { formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDMY } from '@/lib/working-days';

/** One person and everything they took on the day, however many times they came. */
export interface PaidPerson {
  caseId: string;
  caseNumber: string;
  customerName: string;
  accountNumber: string | null;
  agentName: string;
  branchCode: string;
  maturityAmountPaise: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  paidPaise: string;
  payments: number;
  firstPaidAt: string;
  reference: string | null;
  remainingPaise: string;
}

export interface PaidPayload {
  on: string;
  people: PaidPerson[];
  stillDue: { people: number; duePaise: string };
}

const big = (v: string | null | undefined): bigint => (v == null || v === '' ? 0n : BigInt(v));
const inr = (v: bigint) => formatPaise(v, { decimals: false });

/** Counter time, in the branch's own clock rather than the browser's. */
function atTime(value: string): string {
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function Stat({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  note?: string;
  tone?: 'brand' | 'money' | 'warn';
}) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          tone === 'money' && 'text-[var(--color-money-600)]',
          tone === 'warn' && 'text-[var(--color-warn-600)]',
          (!tone || tone === 'brand') && 'text-[var(--color-brand-600)]',
        )}
      />
      <div className="min-w-0">
        <p className="text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">{label}</p>
        <p className="truncate text-[1.05rem] font-semibold tabular-nums">{value}</p>
        {note ? <p className="truncate text-[0.68rem] text-[var(--muted-fg)]">{note}</p> : null}
      </div>
    </div>
  );
}

/**
 * The day's payments, one row per person.
 *
 * Deliberately counts PEOPLE and not receipts: somebody who came back in the afternoon is one
 * customer with two payments, because "how many people did we pay today" is the question the
 * counter actually asks at closing time.
 */
export function PaidBoard({ payload, today }: { payload: PaidPayload; today: string }) {
  const [query, setQuery] = useState('');

  const totals = useMemo(() => {
    let cash = 0n;
    let online = 0n;
    let payments = 0;
    for (const p of payload.people) {
      cash += big(p.paidCashPaise);
      online += big(p.paidOnlinePaise);
      payments += p.payments;
    }
    return { cash, online, total: cash + online, payments };
  }, [payload.people]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return payload.people;
    return payload.people.filter((p) =>
      [p.customerName, p.accountNumber ?? '', p.agentName, p.caseNumber, p.reference ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [payload.people, query]);

  const dayLabel = payload.on === today ? 'today' : `on ${formatDMY(payload.on)}`;
  const count = payload.people.length;

  return (
    <div className="space-y-3">
      <Glass className="grid grid-cols-2 divide-y divide-[var(--hairline)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <Stat
          icon={Users}
          label="People paid"
          value={String(count)}
          note={
            totals.payments === count
              ? `${count === 1 ? 'person' : 'people'} ${dayLabel}`
              : `${totals.payments} payments ${dayLabel}`
          }
          tone="brand"
        />
        <Stat icon={Banknote} label="Handed over" value={inr(totals.total)} note="excludes reversals" tone="money" />
        <Stat
          icon={Landmark}
          label="Cash / online"
          value={`${inr(totals.cash)} · ${inr(totals.online)}`}
          note="by the leg it went out on"
          tone="money"
        />
        <Stat
          icon={Users}
          label="Still due"
          value={String(payload.stillDue.people)}
          note={
            payload.stillDue.people === 0
              ? 'everyone promised has been paid'
              : `${inr(big(payload.stillDue.duePaise))} not handed over`
          }
          tone={payload.stillDue.people === 0 ? 'money' : 'warn'}
        />
      </Glass>

      {count === 0 ? (
        <Glass className="p-8 text-center">
          <p className="text-[0.875rem] font-medium">Nobody has been paid {dayLabel}.</p>
          <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">
            {payload.stillDue.people > 0
              ? `${payload.stillDue.people} ${payload.stillDue.people === 1 ? 'person is' : 'people are'} due ${inr(big(payload.stillDue.duePaise))}.`
              : 'Nothing was promised for this day either.'}
          </p>
        </Glass>
      ) : (
        <Glass className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hairline)] px-3 py-2 print:hidden">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-[7px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)]" />
              <span className="sr-only">Find a customer in the day&rsquo;s payments</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, account, agent or reference"
                className="min-w-0 flex-1 bg-transparent text-[0.8125rem] outline-none"
              />
            </label>
            <p className="text-[0.72rem] text-[var(--muted-fg)] tabular-nums">
              {shown.length === count ? `${count} shown` : `${shown.length} of ${count}`}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.76rem]">
              <thead>
                <tr className="border-b border-[var(--hairline)] text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">
                  <th className="px-2 py-1.5 text-left font-medium">#</th>
                  <th className="px-2 py-1.5 text-left font-medium">Account</th>
                  <th className="px-2 py-1.5 text-left font-medium">Customer</th>
                  <th className="px-2 py-1.5 text-left font-medium">Agent</th>
                  <th className="px-2 py-1.5 text-right font-medium">Cash</th>
                  <th className="px-2 py-1.5 text-right font-medium">Online</th>
                  <th className="px-2 py-1.5 text-right font-medium">Paid</th>
                  <th className="px-2 py-1.5 text-right font-medium">Left</th>
                  <th className="px-2 py-1.5 text-left font-medium">Time</th>
                  <th className="px-2 py-1.5 text-left font-medium">Reference</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p, index) => {
                  const left = big(p.remainingPaise);
                  return (
                    <tr key={p.caseId} className="border-b border-[var(--hairline)] last:border-0">
                      <td className="px-2 py-1.5 tabular-nums text-[var(--faint-fg)]">{index + 1}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{p.accountNumber ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        <Link
                          href={`/maturities/${p.caseId}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {p.customerName}
                        </Link>
                        {p.payments > 1 ? (
                          <span className="ml-1.5 rounded-full bg-[var(--glass-bg-subtle)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-fg)]">
                            {p.payments} payments
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--muted-fg)]">{p.agentName}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {big(p.paidCashPaise) > 0n ? inr(big(p.paidCashPaise)) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {big(p.paidOnlinePaise) > 0n ? inr(big(p.paidOnlinePaise)) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{inr(big(p.paidPaise))}</td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-right tabular-nums',
                          left <= 0n
                            ? 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]'
                            : 'text-[var(--muted-fg)]',
                        )}
                      >
                        {left <= 0n ? 'settled' : inr(left)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-[var(--muted-fg)] tabular-nums">
                        {atTime(p.firstPaidAt)}
                      </td>
                      <td className="px-2 py-1.5 text-[var(--muted-fg)]">{p.reference ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--hairline)] font-semibold">
                  <td className="px-2 py-1.5" colSpan={4}>
                    {shown.length} {shown.length === 1 ? 'person' : 'people'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {inr(shown.reduce((a, p) => a + big(p.paidCashPaise), 0n))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {inr(shown.reduce((a, p) => a + big(p.paidOnlinePaise), 0n))}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {inr(shown.reduce((a, p) => a + big(p.paidPaise), 0n))}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Glass>
      )}
    </div>
  );
}
