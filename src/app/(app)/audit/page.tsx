import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { GlassCard, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { AUDIT_ACTION_LABEL } from '@/lib/audit';
import { getSession } from '@/lib/auth/session';
import { ROLE_SHORT, roleCan, activeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { getAuditFilterOptions, listAuditPage } from '@/services/queries';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

type AuditView = 'book' | 'signin' | 'all';
type Params = {
  view?: string;
  page?: string;
  q?: string;
  action?: string;
  actor?: string;
  branch?: string;
  from?: string;
  to?: string;
};

const PAGE_SIZE = 30;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function indiaBoundary(value: string | undefined, end = false): Date | undefined {
  if (!value || !ISO_DATE.test(value)) return undefined;
  return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);
}

function auditHref(sp: Params, patch: Partial<Params>): string {
  const next = new URLSearchParams();
  for (const key of ['view', 'q', 'action', 'actor', 'branch', 'from', 'to', 'page'] as const) {
    const value = patch[key] === undefined ? sp[key] : patch[key];
    if (value && !(key === 'view' && value === 'book') && !(key === 'page' && value === '1')) {
      next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `/audit?${query}` : '/audit';
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'audit.view')) redirect('/dashboard');

  const sp = await searchParams;
  const view: AuditView = sp.view === 'signin' ? 'signin' : sp.view === 'all' ? 'all' : 'book';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const query = sp.q?.trim().slice(0, 100) || undefined;
  const filters = {
    hideAuth: view === 'book',
    onlyAuth: view === 'signin',
    action: sp.action || undefined,
    actorId: sp.actor || undefined,
    branchId: sp.branch || undefined,
    query,
    from: indiaBoundary(sp.from),
    to: indiaBoundary(sp.to, true),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  const [{ rows, total }, options] = await Promise.all([
    listAuditPage(filters),
    getAuditFilterOptions(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (page > pages && total > 0) redirect(auditHref(sp, { page: String(pages) }));
  const branchNames = new Map(options.branches.map((b) => [b.id, `${b.code} — ${b.name}`]));
  const hasFilters = Boolean(query || sp.action || sp.actor || sp.branch || sp.from || sp.to);
  const fromRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const toRow = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="A permanent, searchable record of access and operational changes. Audit entries cannot be edited or deleted."
      />

      <nav className="flex flex-wrap gap-1" aria-label="Audit log sections">
        {(
          [
            ['book', 'Operations'],
            ['signin', 'Access'],
            ['all', 'All activity'],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={auditHref(sp, { view: key, page: undefined })}
            aria-current={view === key ? 'page' : undefined}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors',
              view === key
                ? 'bg-[var(--color-brand-600)] text-white'
                : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      <GlassCard bodyClassName="space-y-3">
        <form method="get" action="/audit" className="grid gap-3 lg:grid-cols-12">
          {view !== 'book' && <input type="hidden" name="view" value={view} />}
          <label className="lg:col-span-4">
            <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">Search</span>
            <Input name="q" defaultValue={query} placeholder="Person, action, case or detail" />
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">Action</span>
            <Select name="action" defaultValue={sp.action ?? ''}>
              <option value="">All actions</option>
              {options.actions.map((action) => (
                <option key={action} value={action}>{AUDIT_ACTION_LABEL[action] ?? action}</option>
              ))}
            </Select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">Person</span>
            <Select name="actor" defaultValue={sp.actor ?? ''}>
              <option value="">Everyone</option>
              {options.actors.map((actor) => (
                <option key={actor.id} value={actor.id}>{actor.name}</option>
              ))}
            </Select>
          </label>
          <label className="lg:col-span-2">
            <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">Branch</span>
            <Select name="branch" defaultValue={sp.branch ?? ''}>
              <option value="">All branches</option>
              {options.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2 lg:col-span-2">
            <label>
              <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">From</span>
              <Input name="from" type="date" defaultValue={sp.from ?? ''} />
            </label>
            <label>
              <span className="mb-1 block text-[0.75rem] font-medium text-[var(--muted-fg)]">To</span>
              <Input name="to" type="date" defaultValue={sp.to ?? ''} min={sp.from || undefined} />
            </label>
          </div>
          <div className="flex items-center gap-2 lg:col-span-12">
            <Button type="submit" variant="primary" size="sm">Apply filters</Button>
            {hasFilters && (
              <Button asChild variant="ghost" size="sm">
                <Link href={view === 'book' ? '/audit' : `/audit?view=${view}`}>Clear</Link>
              </Button>
            )}
            <span className="ml-auto text-[0.75rem] tabular-nums text-[var(--faint-fg)]">
              {total === 0 ? 'No entries' : `${fromRow}–${toRow} of ${total}`}
            </span>
          </div>
        </form>
      </GlassCard>

      <GlassCard bodyClassName="p-0 sm:p-0">
        {rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No audit entries match these filters' : view === 'book' ? 'No operational changes yet' : 'No entries'}
            description={hasFilters ? 'Clear one or more filters and try again.' : undefined}
          />
        ) : (
          <>
            <div className="hidden sm:block">
              <Table>
                <THead>
                  <TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Record</TH><TH>Detail</TH>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id}>
                      <TD className="whitespace-nowrap text-[0.8125rem] text-[var(--muted-fg)]">{formatAt(row.at)}</TD>
                      <TD>
                        <span className="block font-medium">{row.actorName}</span>
                        <span className="block text-[0.75rem] text-[var(--faint-fg)]">{ROLE_SHORT[activeRole(row.actorRole)]}</span>
                      </TD>
                      <TD><Badge tone={toneFor(row.action)}>{AUDIT_ACTION_LABEL[row.action] ?? row.action}</Badge></TD>
                      <TD className="max-w-[13rem] text-[0.75rem] text-[var(--faint-fg)]">
                        <span className="block font-medium text-[var(--muted-fg)]">{row.entity}</span>
                        <span className="block truncate" title={row.entityId}>{row.entityId}</span>
                        {row.branchId && <span className="block truncate">{branchNames.get(row.branchId) ?? row.branchId}</span>}
                      </TD>
                      <TD className="max-w-[34rem] text-[0.8125rem] text-[var(--muted-fg)]">
                        <p>{row.summary}</p>
                        <AuditDetails row={row} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>

            <div className="divide-y divide-[var(--hairline)] sm:hidden">
              {rows.map((row) => (
                <article key={row.id} className="space-y-2 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.actorName}</p>
                      <p className="text-[0.72rem] text-[var(--faint-fg)]">{ROLE_SHORT[activeRole(row.actorRole)]} · {formatAt(row.at)}</p>
                    </div>
                    <Badge tone={toneFor(row.action)}>{AUDIT_ACTION_LABEL[row.action] ?? row.action}</Badge>
                  </div>
                  <p className="text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">{row.summary}</p>
                  <p className="truncate text-[0.7rem] text-[var(--faint-fg)]">{row.entity} · {row.entityId}</p>
                  <AuditDetails row={row} />
                </article>
              ))}
            </div>
          </>
        )}
      </GlassCard>

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Audit pagination">
          <Button asChild={page > 1} variant="glass" size="sm" disabled={page <= 1}>
            {page > 1 ? <Link href={auditHref(sp, { page: String(page - 1) })}>Previous</Link> : <span>Previous</span>}
          </Button>
          <span className="text-[0.8125rem] tabular-nums text-[var(--muted-fg)]">Page {page} of {pages}</span>
          <Button asChild={page < pages} variant="glass" size="sm" disabled={page >= pages}>
            {page < pages ? <Link href={auditHref(sp, { page: String(page + 1) })}>Next</Link> : <span>Next</span>}
          </Button>
        </nav>
      )}
    </div>
  );
}

function formatAt(at: Date): string {
  return at.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

function AuditDetails({ row }: { row: { before: unknown; after: unknown; ip: string | null; userAgent: string | null } }) {
  if (row.before == null && row.after == null && !row.ip && !row.userAgent) return null;
  return (
    <details className="mt-2 text-[0.75rem]">
      <summary className="cursor-pointer font-medium text-[var(--color-brand-600)]">Inspect record</summary>
      <div className="mt-2 grid gap-2 xl:grid-cols-2">
        {row.before != null && <AuditJson label="Before" value={row.before} />}
        {row.after != null && <AuditJson label="After" value={row.after} />}
      </div>
      {(row.ip || row.userAgent) && (
        <p className="mt-2 break-all text-[0.68rem] leading-relaxed text-[var(--faint-fg)]">
          {[row.ip && `IP ${row.ip}`, row.userAgent].filter(Boolean).join(' · ')}
        </p>
      )}
    </details>
  );
}

function AuditJson({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 rounded-[8px] border border-[var(--hairline)] bg-[var(--glass-bg-subtle)] p-2">
      <p className="mb-1 font-semibold uppercase tracking-[0.06em] text-[var(--faint-fg)]">{label}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[0.68rem] leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function toneFor(action: string): 'neutral' | 'money' | 'danger' | 'warn' | 'brand' {
  if (action.startsWith('payout')) return action.includes('reversed') ? 'danger' : 'money';
  if (action.includes('approved') || action.includes('completed')) return 'money';
  if (action.includes('rejected') || action.includes('cancelled') || action.includes('failed')) return 'danger';
  if (action.includes('returned') || action.includes('held') || action.includes('reschedul')) return 'warn';
  if (action.startsWith('case') || action.startsWith('schedule')) return 'brand';
  return 'neutral';
}
