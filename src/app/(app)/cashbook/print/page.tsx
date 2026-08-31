import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { parseISODate, todayISO } from '@/lib/working-days';
import { getCashbookDay, getCashbookSummary } from '@/services/queries';
import { loadOrgSettings } from '@/services/org-settings';
import { CashbookPrint } from './cashbook-print';

export const metadata = { title: 'Print daily cashbook' };
export const dynamic = 'force-dynamic';

export default async function CashbookPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'cashbook.view')) redirect('/dashboard');
  const actor = toActor(session);
  const sp = await searchParams;
  const date = sp.date ?? todayISO();
  try {
    parseISODate(date);
  } catch {
    redirect('/cashbook');
  }
  let branchId = sp.branch;
  if (!branchId) {
    const summary = await getCashbookSummary(actor, date);
    branchId =
      summary.rows.find((row) => row.branch.id === session.branchId)?.branch.id ??
      summary.rows[0]?.branch.id;
  }
  if (!branchId) redirect('/cashbook');
  const [view, org] = await Promise.all([getCashbookDay(actor, branchId, date), loadOrgSettings()]);
  if (!view) redirect('/cashbook');
  return <CashbookPrint view={serialize(view)} orgName={org.orgName} preparedBy={session.name} />;
}
