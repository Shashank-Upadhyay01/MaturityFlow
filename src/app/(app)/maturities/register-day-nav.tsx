'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { addDays, formatDMY } from '@/lib/working-days';

export function RegisterDayNav({ date, today, status }: { date: string; today: string; status: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function open(day: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (day === today) next.delete('date');
    else next.set('date', day);
    startTransition(() => router.push(`/maturities${next.size ? `?${next.toString()}` : ''}`));
  }

  const historical = date < today;
  return (
    <Glass className="flex flex-wrap items-center gap-2 p-2.5 print:hidden">
      <div className="mr-auto flex min-w-0 items-center gap-2 px-1">
        <CalendarDays className="h-4 w-4 shrink-0 text-[var(--color-brand-600)]" />
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-semibold">{date === today ? 'Today' : formatDMY(date)}</p>
          <p className="text-[0.68rem] text-[var(--muted-fg)]">
            {historical ? 'Closed daily register' : date === today ? 'Live daily register' : 'Future payment plan'}
            {' · '}{status === 'CLOSE_REQUESTED' ? 'close requested' : status.toLowerCase()}
          </p>
        </div>
      </div>
      <Button variant="glass" size="sm" onClick={() => open(addDays(date, -1))} disabled={pending} aria-label="Previous register day">
        <ChevronLeft className="h-4 w-4" /> Previous
      </Button>
      <label className="flex items-center gap-2 rounded-[7px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1">
        <span className="sr-only">Open register date</span>
        <input
          type="date"
          value={date}
          onChange={(event) => event.target.value && open(event.target.value)}
          className="bg-transparent text-[0.8125rem] outline-none"
          aria-label="Open register date"
        />
      </label>
      {date !== today && <Button variant="glass" size="sm" onClick={() => open(today)} disabled={pending}>Today</Button>}
      <Button variant="glass" size="sm" onClick={() => open(addDays(date, 1))} disabled={pending} aria-label="Next register day">
        Next <ChevronRight className="h-4 w-4" />
      </Button>
    </Glass>
  );
}
