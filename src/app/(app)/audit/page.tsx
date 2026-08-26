import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { GlassCard, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { AUDIT_ACTION_LABEL } from '@/lib/audit';
import { getSession } from '@/lib/auth/session';
import { ROLE_SHORT, roleCan, activeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { listAudit } from '@/services/queries';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'audit.view')) redirect('/dashboard');

  const sp = await searchParams;
  const view = sp.view === 'signin' ? 'signin' : sp.view === 'all' ? 'all' : 'book';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const limit = 100;
  const rows = await listAudit({
    hideAuth: view === 'book',
    onlyAuth: view === 'signin',
    limit,
    offset: (page - 1) * limit,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Who changed the book, and when. Sign-ins are on their own tab so they do not bury the money."
      />

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['book', 'The book'],
            ['signin', 'Sign-in'],
            ['all', 'All'],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={k === 'book' ? '/audit' : `/audit?view=${k}`}
            className={cn(
              'rounded-full px-3 py-1 text-[0.8125rem]',
              view === k
                ? 'bg-[var(--color-brand-600)] font-medium text-white'
                : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)]',
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      <GlassCard bodyClassName="p-0 sm:p-0">
        {rows.length === 0 ? (
          <EmptyState title={view === 'book' ? 'No book changes yet' : 'No entries'} />
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Action</TH>
              <TH>Detail</TH>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-[0.8125rem] text-[var(--muted-fg)]">
                    {r.at.toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Kolkata',
                    })}
                  </TD>
                  <TD>
                    <span className="block font-medium">{r.actorName}</span>
                    <span className="block text-[0.75rem] text-[var(--faint-fg)]">
                      {ROLE_SHORT[activeRole(r.actorRole)]}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={toneFor(r.action)}>
                      {AUDIT_ACTION_LABEL[r.action] ?? r.action}
                    </Badge>
                  </TD>
                  <TD className="max-w-[34rem] text-[0.8125rem] text-[var(--muted-fg)]">
                    {r.summary}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </GlassCard>
    </div>
  );
}

function toneFor(action: string): 'neutral' | 'money' | 'danger' | 'warn' | 'brand' {
  if (action.startsWith('payout')) return action.includes('reversed') ? 'danger' : 'money';
  if (action.includes('approved') || action.includes('completed')) return 'money';
  if (action.includes('rejected') || action.includes('cancelled') || action.includes('failed'))
    return 'danger';
  if (action.includes('returned') || action.includes('held') || action.includes('reschedul'))
    return 'warn';
  if (action.startsWith('case') || action.startsWith('schedule')) return 'brand';
  return 'neutral';
}
