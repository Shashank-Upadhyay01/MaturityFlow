import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { formatISODate, todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getAgentCustomers, getAgentStatementInstalments } from '@/services/queries';
import { loadOrgSettings } from '@/services/org-settings';
import { AgentStatement } from './agent-statement';

export const metadata = { title: 'Agent statement' };
export const dynamic = 'force-dynamic';

/**
 * A page built to be printed, not browsed.
 *
 * There is no PDF library in this project and adding one to a bank system is not a decision to
 * take quietly, so the PDF is the browser's own: this page lays out to A4, opens the print dialog
 * itself, and "Save as PDF" gives a file that can be sent to anyone. It renders identically on
 * every machine because the layout is plain CSS, not a rendering engine we would have to ship.
 */
export default async function AgentStatementPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'agent.view')) redirect('/dashboard');

  const actor = toActor(session);
  const [cases, instalments, org] = await Promise.all([
    getAgentCustomers(actor, agentId),
    getAgentStatementInstalments(actor, agentId),
    loadOrgSettings(),
  ]);

  // Scoping is applied inside the query, so an empty result means "not yours" or "no customers".
  const head = cases[0];
  const calendar = head
    ? await getCalendarSnapshot(head.branchId)
    : { holidays: [], sundaysOff: true, saturdayRule: 'SECOND_FOURTH' as const };
  const today = todayISO();

  return (
    <AgentStatement
      orgName={org.orgName}
      branchName={head?.branchName ?? '—'}
      agentName={head?.agentName ?? 'Agent'}
      agentCode={head?.agentCode ?? ''}
      preparedBy={session.name}
      preparedOn={formatISODate(today)}
      today={today}
      calendar={calendar}
      cases={serialize(cases)}
      instalments={serialize(instalments)}
    />
  );
}
