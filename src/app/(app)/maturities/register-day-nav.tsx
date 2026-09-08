'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
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
    startTransition(() => router.push(hrefFor(day)));
  }

  function hrefFor(day: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (day === today) next.delete('date');
    else next.set('date', day);
    const query = next.toString();
    return `/maturities${query ? `?${query}` : ''}`;
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
      <Button asChild variant="glass" size="sm">
        <Link href={hrefFor(addDays(date, -1))} aria-label="Previous register day">
          <ChevronLeft className="h-4 w-4" /> Previous
        </Link>
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
      {date !== today && (
        <Button asChild variant="glass" size="sm">
          <Link href={hrefFor(today)}>Today</Link>
        </Button>
      )}
      <Button asChild variant="glass" size="sm">
        <Link href={hrefFor(addDays(date, 1))} aria-label="Next register day">
          Next <ChevronRight className="h-4 w-4" />
        </Link>
      </Button>
    </Glass>
  );
}
