import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { getSession, toActor } from '@/lib/auth/session';
import { todayISO } from '@/lib/working-days';
import { listMaturityForecasts } from '@/services/forecast-service';

export const metadata = { title: 'Maturity calendar' };
export const dynamic = 'force-dynamic';

function monthOffset(month: string, offset: number): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, value - 1, 1)));
}

export default async function MaturityCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const currentMonth = todayISO().slice(0, 7);
  const nextMonth = monthOffset(currentMonth, 1);
  const params = await searchParams;
  const selectedMonth = params.month === nextMonth ? nextMonth : currentMonth;
  const [currentRows, nextRows] = await Promise.all([
    listMaturityForecasts(toActor(session), currentMonth),
    listMaturityForecasts(toActor(session), nextMonth),
  ]);
  const allRows = selectedMonth === currentMonth ? currentRows : nextRows;
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number(params.page) || 1));
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
  const total = allRows.reduce((sum, row) => sum + row.currentMaturityPaise, 0n);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Pipeline"
        title="Maturity calendar"
        description="Upcoming maturities from the source workbook. These are forecasts—not payout cases—until a form is received."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { month: currentMonth, label: 'Current month', rows: currentRows },
          { month: nextMonth, label: 'Next month', rows: nextRows },
        ].map((item) => {
          const active = item.month === selectedMonth;
          const amount = item.rows.reduce((sum, row) => sum + row.currentMaturityPaise, 0n);
          return (
            <Link key={item.month} href={`/maturity-calendar?month=${item.month}`}>
              <Glass className={`p-4 transition ${active ? 'ring-2 ring-[var(--color-brand-400)]' : 'glass-interactive'}`}>
                <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">{item.label}</p>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[1.125rem] font-semibold">{monthLabel(item.month)}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-[var(--muted-fg)]">{item.rows.length} maturities</p>
                  </div>
                  <p className="text-[1.125rem] font-semibold tabular-nums"><Money paise={amount} decimals={false} /></p>
                </div>
              </Glass>
            </Link>
          );
        })}
      </div>

      <Glass className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] px-4 py-3">
          <div>
            <p className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-[var(--color-brand-500)]" />{monthLabel(selectedMonth)}</p>
            <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">{allRows.length} records · <Money paise={total} decimals={false} /></p>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm" disabled={page <= 1}><Link href={`/maturity-calendar?month=${selectedMonth}&page=${page - 1}`}><ChevronLeft className="h-4 w-4" /></Link></Button>
              <span className="text-[0.75rem] text-[var(--muted-fg)]">Page {page} of {pageCount}</span>
              <Button asChild variant="ghost" size="sm" disabled={page >= pageCount}><Link href={`/maturity-calendar?month=${selectedMonth}&page=${page + 1}`}><ChevronRight className="h-4 w-4" /></Link></Button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[66rem] text-left text-[0.8125rem]">
            <thead className="bg-[var(--surface-solid)] text-[0.6875rem] uppercase tracking-[0.06em] text-[var(--faint-fg)]">
              <tr><th className="px-4 py-2.5">Maturity</th><th className="px-3 py-2.5">Customer</th><th className="px-3 py-2.5">Account</th><th className="px-3 py-2.5">Agent</th><th className="px-3 py-2.5">Branch</th><th className="px-3 py-2.5">Plan</th><th className="px-3 py-2.5 text-right">Deposit</th><th className="px-4 py-2.5 text-right">Maturity amount</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline)]">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--surface-hover)]">
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium">{row.maturityOn.split('-').reverse().join('-')}</td>
                  <td className="px-3 py-2.5 font-medium">{row.customerName}</td>
                  <td className="px-3 py-2.5 tabular-nums text-[var(--muted-fg)]">{row.accountNumber || '—'}</td>
                  <td className="px-3 py-2.5">{row.agentName || '—'}</td>
                  <td className="px-3 py-2.5">{row.branchCode}</td>
                  <td className="px-3 py-2.5 text-[var(--muted-fg)]">{row.planName || (row.tenureMonths ? `${row.tenureMonths} months` : '—')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums"><Money paise={row.totalDepositPaise} decimals={false} /></td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums"><Money paise={row.currentMaturityPaise} decimals={false} /></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--muted-fg)]">No maturity forecast has been imported for this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Glass>
    </div>
  );
}
