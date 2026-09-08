import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge, CaseStatusBadge, CASE_STATUS_LABEL } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Glass, PageHeader } from '@/components/ui/glass';
import { Callout, EmptyState, KeyValue } from '@/components/ui/misc';
import { getSession, toActor } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import { roleCan } from '@/lib/rbac';
import { getOperationsHealth } from '@/services/operations-health';
import { NormalizeSchedulePartsButton, ReconcileCaseForm, RefreshHealthButton } from './repair-controls';

export const metadata = { title: 'Operations health' };
export const dynamic = 'force-dynamic';

type Params = { q?: string | string[]; page?: string | string[] };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function healthHref(page: number, search: string) {
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return `/settings/operations-health${query ? `?${query}` : ''}`;
}

export default async function OperationsHealthPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'settings.manage')) redirect('/dashboard');

  const params = await searchParams;
  const health = await getOperationsHealth(toActor(session), {
    page: Number(first(params.page) ?? '1'),
    search: first(params.q),
  });
  const repairable = health.cases.filter((row) => row.repairable).length;
  const needsReview = health.cases.length - repairable;
  const checkedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  }).format(health.checkedAt);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Operations health"
        description="Check case totals and instalments against recorded receipts, investigate discrepancies, and reconcile eligible paid totals."
        actions={<><NormalizeSchedulePartsButton /><RefreshHealthButton /></>}
      />

      <Callout tone="info" title="Every reconciliation has a reason and an audit record" icon={<ShieldCheck className="h-5 w-5" aria-hidden />}>
        Reconciliation restores paid totals and payment statuses from unreversed receipts. Receipt amounts,
        planned instalments and payout dates stay unchanged. Cases with receipt or schedule problems need review first.
      </Callout>

      <Glass className="space-y-4 p-4 sm:p-5">
        <form method="get" action="/settings/operations-health" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Find a case" className="flex-1">
            <Input key={health.search} name="q" defaultValue={health.search} maxLength={120} placeholder="Case number, customer name or account number" />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary">Search</Button>
            {health.search && <Button asChild variant="ghost"><Link href="/settings/operations-health">Clear</Link></Button>}
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-[var(--muted-fg)]">
          <p>Page {health.page} of {health.pageCount} · {health.totalCases.toLocaleString('en-IN')} {health.search ? 'matching' : 'total'} cases across all branches</p>
          <p>Checked <time dateTime={health.checkedAt.toISOString()}>{checkedAt} IST</time></p>
        </div>
      </Glass>

      <section aria-labelledby="health-summary" className="space-y-2">
        <h2 id="health-summary" className="text-[0.875rem] font-semibold">Results on this page</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Cases checked', value: health.checked },
            { label: 'No discrepancies', value: health.healthy },
            { label: 'Can reconcile', value: repairable },
            { label: 'Need investigation', value: needsReview },
          ].map((item) => (
            <Glass key={item.label} className="p-4">
              <dt className="text-[0.75rem] text-[var(--muted-fg)]">{item.label}</dt>
              <dd className="mt-1 text-[1.625rem] font-semibold tabular-nums">{item.value}</dd>
            </Glass>
          ))}
        </dl>
        <p className="text-[0.75rem] text-[var(--faint-fg)]">
          Each page checks up to 100 cases. Counts describe this page only; continue through the pages to review every case.
        </p>
      </section>

      {health.cases.length === 0 ? (
        <Glass>
          <EmptyState
            icon={<CheckCircle2 className="h-7 w-7" aria-hidden />}
            title={health.checked === 0 ? (health.search ? 'No matching cases' : 'No cases to check') : 'No discrepancies on this page'}
            description={health.checked === 0
              ? (health.search ? 'Try a case number, customer name or account number.' : 'Case ledger checks will appear here when payout cases are created.')
              : `${health.checked} cases checked against their receipts. ${health.pageCount > 1 ? 'Use the page controls to check the remaining cases.' : 'Check again after further payment activity for an updated result.'}`}
          />
        </Glass>
      ) : (
        <section aria-labelledby="health-discrepancies" className="space-y-3">
          <h2 id="health-discrepancies" className="text-[0.9375rem] font-semibold">Cases with discrepancies</h2>
          {health.cases.map((row) => (
            <Glass key={row.id} as="article" className="overflow-hidden">
              <div className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold"><Link className="text-[var(--color-brand-600)] underline-offset-4 hover:underline dark:text-[var(--color-brand-300)]" href={`/maturities/${row.id}`}>{row.caseNumber}</Link></h3>
                      <CaseStatusBadge status={row.status} />
                      <Badge tone={row.repairable ? 'warn' : 'danger'}>{row.repairable ? 'Can reconcile' : 'Needs investigation'}</Badge>
                    </div>
                    <p className="mt-1 break-words text-[0.875rem] font-medium">{row.customerName}</p>
                    <p className="mt-0.5 break-words text-[0.75rem] text-[var(--muted-fg)]">{row.branchCode} · Account {row.accountNumber || 'not recorded'}</p>
                  </div>
                  <Button asChild size="sm" variant="outline"><Link href={`/maturities/${row.id}`}>Open case <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link></Button>
                </div>

                <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <KeyValue label="Saved paid total"><span className="tabular-nums">{formatPaise(row.storedPaidPaise)}</span></KeyValue>
                  <KeyValue label="Paid from receipts"><span className="tabular-nums">{formatPaise(row.paidPaise)}</span></KeyValue>
                  <KeyValue label="Active schedule"><span className="tabular-nums">{formatPaise(row.scheduledPaise)}</span></KeyValue>
                  <KeyValue label="Balance from receipts"><span className="tabular-nums">{formatPaise(row.remainingPaise)}</span></KeyValue>
                </dl>

                <ul className="space-y-1.5 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
                  {row.issues.map((issue) => (
                    <li key={issue.code} className="flex items-start gap-2">
                      <span className={`mt-[0.5em] h-1.5 w-1.5 shrink-0 rounded-full ${issue.blocking ? 'bg-[var(--color-danger-500)]' : 'bg-[var(--color-warn-500)]'}`} aria-hidden />
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {row.repairable ? (
                <details className="border-t border-[var(--hairline)]">
                  <summary className="cursor-pointer px-4 py-3 text-[0.8125rem] font-semibold text-[var(--color-brand-700)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-brand-500)] sm:px-5">
                    Review reconciliation for {row.caseNumber}
                  </summary>
                  <div className="space-y-4 px-4 pb-5 sm:px-5">
                    <div className="space-y-1 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
                      <p>Set the case paid totals to cash <strong className="text-[var(--page-fg)]">{formatPaise(row.cashPaise)}</strong> and online <strong className="text-[var(--page-fg)]">{formatPaise(row.onlinePaise)}</strong>, using the recorded receipts.</p>
                      {row.instalmentRepairs.length > 0 && <p>Reconcile paid totals or payment status on {row.instalmentRepairs.length} instalment{row.instalmentRepairs.length === 1 ? '' : 's'}.</p>}
                      {row.expectedStatus !== row.status && <p>Update case progress from <strong>{CASE_STATUS_LABEL[row.status]}</strong> to <strong>{CASE_STATUS_LABEL[row.expectedStatus]}</strong>.</p>}
                    </div>
                    <ReconcileCaseForm caseId={row.id} caseNumber={row.caseNumber} />
                  </div>
                </details>
              ) : (
                <div className="border-t border-[var(--hairline)] px-4 py-3 text-[0.8125rem] text-[var(--muted-fg)] sm:px-5">
                  Open the case to investigate its receipts and schedule, then check again. Reconciliation is unavailable while these issues remain.
                </div>
              )}
            </Glass>
          ))}
        </section>
      )}

      {health.pageCount > 1 && (
        <nav aria-label="Operations health pages" className="flex flex-wrap items-center justify-between gap-3">
          {health.page > 1 ? <Button asChild variant="outline"><Link href={healthHref(health.page - 1, health.search)}><ArrowLeft className="h-4 w-4" aria-hidden />Previous</Link></Button> : <Button variant="outline" disabled><ArrowLeft className="h-4 w-4" aria-hidden />Previous</Button>}
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">Page {health.page} of {health.pageCount}</p>
          {health.page < health.pageCount ? <Button asChild variant="outline"><Link href={healthHref(health.page + 1, health.search)}>Next<ArrowRight className="h-4 w-4" aria-hidden /></Link></Button> : <Button variant="outline" disabled>Next<ArrowRight className="h-4 w-4" aria-hidden /></Button>}
        </nav>
      )}
    </div>
  );
}
