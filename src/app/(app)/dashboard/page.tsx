import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { getSession, toActor } from '@/lib/auth/session';
import { ROLE_SCOPE, roleCan } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { todayISO } from '@/lib/working-days';
import { getBranchRollup, getRegisterSummary } from '@/services/queries';

export const metadata = { title: 'Summary' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const today = todayISO();
  const hq = ROLE_SCOPE[session.role] === 'ALL';

  const [book, branches] = await Promise.all([
    getRegisterSummary(actor, today),
    hq ? getBranchRollup(actor) : Promise.resolve([]),
  ]);

  const empty = book.rowCount === 0;
  const canImport = roleCan(session.role, 'data.import');
  const canApprove = roleCan(session.role, 'case.approve');
  const showAttention = book.awaitingCount > 0 || book.overdueCount > 0;
  const branchLines = branches.filter((b) => BigInt(b.totalPaise) - BigInt(b.paidPaise) > 0n || b.liveCases > 0);
  const showBranches = hq && branches.length > 1 && branchLines.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader
        title="Summary"
        description="Remaining, paid and today — the same figures as the register header."
        actions={
          <Button asChild variant="primary">
            <Link href="/maturities">Open register</Link>
          </Button>
        }
      />

      {empty ? (
        <Glass className="px-6 py-12 text-center sm:px-10">
          <p className="text-[1.0625rem] font-semibold">The register is empty</p>
          <p className="mx-auto mt-1.5 max-w-md text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
            Nothing to summarise yet. Import the branch Excel sheet, or add the first row.
          </p>
          {canImport && (
            <div className="mt-5">
              <Button asChild variant="primary">
                <Link href="/import">
                  <FileSpreadsheet className="h-4 w-4" />
                  Import Excel
                </Link>
              </Button>
            </div>
          )}
        </Glass>
      ) : (
        <>
          <Glass className="p-0">
            <div className="grid sm:grid-cols-3 sm:divide-x max-sm:divide-y">
              <Figure
                label="Remaining"
                value={<Money paise={book.remainingPaise} decimals={false} />}
                hint={
                  book.remainingCount === 0
                    ? 'Nothing left to pay'
                    : `${book.remainingCount} customer${book.remainingCount === 1 ? '' : 's'} still owed`
                }
              />
              <Figure
                label="Paid"
                value={<Money paise={book.givenPaise} decimals={false} tone="money" />}
                hint={splitHint(book.givenCashPaise, book.givenOnlinePaise)}
              />
              <Figure
                label="Maturity"
                value={<Money paise={book.maturityPaise} decimals={false} />}
                hint={`${book.rowCount} row${book.rowCount === 1 ? '' : 's'} on the register`}
              />
            </div>
          </Glass>

          <Glass className="p-0">
            <div className="border-b px-5 py-3">
              <h2 className="text-[0.9375rem] font-semibold tracking-tight">Today</h2>
            </div>
            <div className="grid sm:grid-cols-2 sm:divide-x max-sm:divide-y">
              <Figure
                label="Approved today"
                value={<Money paise={book.todayApprovedPaise} decimals={false} />}
                hint={
                  splitHint(book.todayCashPaise, book.todayOnlinePaise) ??
                  (book.todayApprovedPaise === 0n ? 'Nothing marked for the counter yet' : null)
                }
              />
              <Figure
                label="Given today"
                value={<Money paise={book.paidTodayPaise} decimals={false} tone="money" />}
                hint={
                  book.paidTodayCount === 0
                    ? 'No withdrawals recorded today'
                    : `${book.paidTodayCount} withdrawal${book.paidTodayCount === 1 ? '' : 's'}${
                        splitHint(book.paidTodayCashPaise, book.paidTodayOnlinePaise)
                          ? ` · ${splitHint(book.paidTodayCashPaise, book.paidTodayOnlinePaise)}`
                          : ''
                      }`
                }
              />
            </div>
          </Glass>

          {showAttention && (
            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">Needs you</h2>
              </div>
              <ul className="divide-y">
                {book.awaitingCount > 0 && (
                  <AttentionRow
                    href={canApprove ? '/approvals' : '/maturities'}
                    label={`${book.awaitingCount} form${book.awaitingCount === 1 ? '' : 's'} waiting for approval`}
                    amount={book.awaitingPaise}
                  />
                )}
                {book.overdueCount > 0 && (
                  <AttentionRow
                    href="/maturities"
                    label={`${book.overdueCount} customer${book.overdueCount === 1 ? '' : 's'} still owed after the payment date`}
                    amount={book.overduePaise}
                    warn
                  />
                )}
              </ul>
            </Glass>
          )}

          {showBranches && (
            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">By branch</h2>
              </div>
              <ul className="divide-y">
                {branchLines.map((b) => {
                  const remaining = BigInt(b.totalPaise) - BigInt(b.paidPaise);
                  return (
                    <li key={b.branchId} className="flex items-baseline justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{b.branchName}</p>
                        <p className="text-[0.75rem] text-[var(--faint-fg)]">
                          {b.branchCode}
                          {remaining > 0n ? ` · ${b.liveCases} still open` : ''}
                        </p>
                      </div>
                      <p className="shrink-0 tabular-nums font-semibold">
                        <Money paise={remaining} decimals={false} />
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Glass>
          )}
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="px-5 py-5">
      <p className="text-[0.8125rem] leading-5 text-[var(--muted-fg)]">{label}</p>
      <p className="mt-2 break-words text-[1.75rem] font-semibold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      <p className="mt-2 min-h-[2.5rem] text-[0.8125rem] leading-5 text-[var(--faint-fg)]">{hint ?? '\u00a0'}</p>
    </div>
  );
}

function AttentionRow({
  href,
  label,
  amount,
  warn,
}: {
  href: string;
  label: string;
  amount: bigint;
  warn?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-baseline justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-[var(--glass-bg-subtle)]"
      >
        <span className={cn('min-w-0 text-[0.9375rem]', warn && 'text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]')}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums font-semibold">
          <Money paise={amount} decimals={false} />
        </span>
      </Link>
    </li>
  );
}

function splitHint(cash: bigint, online: bigint): string | null {
  if (cash === 0n && online === 0n) return null;
  const bits: string[] = [];
  if (cash > 0n) bits.push(`cash ${formatShort(cash)}`);
  if (online > 0n) bits.push(`online ${formatShort(online)}`);
  return bits.join(' · ');
}

function formatShort(p: bigint): string {
  const rupees = p / 100n;
  return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(rupees)}`;
}
