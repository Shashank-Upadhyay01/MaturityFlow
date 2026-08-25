import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { formatISODate, todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getCustomerBook, getPlanBoardInstalments } from '@/services/queries';
import { loadOrgSettings } from '@/services/org-settings';
import { CustomerStatement } from './customer-statement';

export const metadata = { title: 'Customer statement' };
export const dynamic = 'force-dynamic';

/**
 * One customer's statement, laid out for A4 and printed by the browser.
 *
 * Same approach as the agent statement: no PDF library, no rendering engine to ship — the page
 * opens the print dialog itself and "Save as PDF" produces a file that can be handed over or
 * emailed. Filtering happens after the scoped query, so a customer outside the reader's scope
 * simply is not there.
 */
export default async function CustomerStatementPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.view')) redirect('/dashboard');

  const actor = toActor(session);
  const all = await getCustomerBook(actor);
  const cases = all.filter((c) => c.customerId === customerId);
  const instalments = (await getPlanBoardInstalments(actor)).filter((i) =>
    cases.some((c) => c.caseId === i.caseId),
  );
  const org = await loadOrgSettings();
  const head = cases[0];
  const calendar = head
    ? await getCalendarSnapshot(head.branchId)
    : { holidays: [], sundaysOff: true, saturdayRule: 'SECOND_FOURTH' as const };

  return (
    <CustomerStatement
      orgName={org.orgName}
      branchName={head?.branchName ?? '—'}
      preparedBy={session.name}
      preparedOn={formatISODate(todayISO())}
      today={todayISO()}
      calendar={calendar}
      cases={serialize(cases)}
      instalments={serialize(instalments)}
    />
  );
}
