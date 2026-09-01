'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { formatDMY, weekdayShort } from '@/lib/working-days';

export interface UpcomingWithdrawalDay {
  date: string;
  cashPaise: string;
  onlinePaise: string;
  count: number;
}

export function UpcomingWithdrawals({ days }: { days: UpcomingWithdrawalDay[] }) {
  const [index, setIndex] = useState(0);
  const day = days[index];
  if (!day) return null;
  const cash = BigInt(day.cashPaise);
  const online = BigInt(day.onlinePaise);
  const total = cash + online;
  const tomorrow = index === 0;

  return (
    <Glass className="min-w-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[0.9375rem] font-semibold tracking-tight">
            {tomorrow ? 'Tomorrow' : weekdayShort(day.date)}
          </h2>
          <p className="text-[0.6875rem] tabular-nums text-[var(--faint-fg)]">{formatDMY(day.date)} · daily withdrawal requirement</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label="Previous upcoming day" disabled={index === 0} onClick={() => setIndex((v) => Math.max(0, v - 1))} className="rounded-[8px] border border-[var(--hairline)] p-1.5 text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] disabled:opacity-30">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-10 text-center text-[0.65rem] tabular-nums text-[var(--faint-fg)]">{index + 1}/{days.length}</span>
          <button type="button" aria-label="Next upcoming day" disabled={index === days.length - 1} onClick={() => setIndex((v) => Math.min(days.length - 1, v + 1))} className="rounded-[8px] border border-[var(--hairline)] p-1.5 text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] disabled:opacity-30">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x">
        <div className="px-5 py-5">
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">Due that day</p>
          <Money paise={total} decimals={false} className="mt-2 block break-words text-[1.75rem] font-semibold leading-none tracking-[-0.03em]" />
          <p className="mt-2 min-h-[2.5rem] text-[0.8125rem] leading-5 text-[var(--faint-fg)]">
            {day.count === 0 ? 'Nothing scheduled for this date' : `${day.count} customer${day.count === 1 ? '' : 's'} scheduled`}
          </p>
        </div>
        <div className="px-5 py-5">
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">Payment split</p>
          <p className="mt-2 text-[0.8125rem] leading-6 tabular-nums">
            <span className="flex justify-between gap-2"><span className="text-[var(--faint-fg)]">Cash</span><strong><Money paise={cash} decimals={false} /></strong></span>
            <span className="flex justify-between gap-2"><span className="text-[var(--faint-fg)]">Online</span><strong><Money paise={online} decimals={false} /></strong></span>
          </p>
          <div className="mt-2 flex gap-1" aria-label="Upcoming day selector">
            {days.map((item, itemIndex) => (
              <button key={item.date} type="button" aria-label={`Show ${formatDMY(item.date)}`} onClick={() => setIndex(itemIndex)} className={`h-1.5 min-w-1 flex-1 rounded-full ${itemIndex === index ? 'bg-[var(--color-brand-500)]' : BigInt(item.cashPaise) + BigInt(item.onlinePaise) > 0n ? 'bg-[var(--color-brand-200)] dark:bg-[var(--color-brand-700)]' : 'bg-[var(--hairline)]'}`} />
            ))}
          </div>
        </div>
      </div>
    </Glass>
  );
}
