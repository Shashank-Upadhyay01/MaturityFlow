import { redirect } from 'next/navigation';

import { Callout } from '@/components/ui/misc';
import { getSession, toActor } from '@/lib/auth/session';
import { can, roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { parseISODate, todayISO } from '@/lib/working-days';
import { getCashbookDay, getCashbookSummary } from '@/services/queries';
import { CashbookWorkbench } from './cashbook-workbench';

export const metadata = { title: 'Daily cashbook' };
export const dynamic = 'force-dynamic';

function safeDate(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    parseISODate(value);
    return value;
  } catch {
    return fallback;
  }
}

export default async function CashbookPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'cashbook.view')) redirect('/dashboard');

  const actor = toActor(session);
  const today = todayISO();
  const sp = await searchParams;
  const date = safeDate(sp.date, today);
  const summary = await getCashbookSummary(actor, date);
  const branches = summary.rows.map((row) => row.branch);
  const branchId =
    (sp.branch && branches.some((branch) => branch.id === sp.branch) ? sp.branch : null) ??
    (session.branchId && branches.some((branch) => branch.id === session.branchId)
      ? session.branchId
      : branches[0]?.id);

  if (!branchId) {
    return (
      <Callout tone="warn" title="No branch available">
        There is no active branch in your cashbook scope. Ask an administrator to check your
        branch assignment.
      </Callout>
    );
  }

  const view = await getCashbookDay(actor, branchId, date);
  if (!view) redirect('/dashboard');

  return (
    <CashbookWorkbench
      key={`${branchId}:${date}`}
      view={serialize(view)}
      branches={branches.map(({ id, code, name }) => ({ id, code, name }))}
      today={today}
      canEdit={can(actor, 'cashbook.edit', { branchId })}
      canClose={can(actor, 'cashbook.close', { branchId })}
      canExport={roleCan(session.role, 'report.export')}
    />
  );
}
