import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import {
  listBreachedCases,
  listMissedInstalments,
  listNotTakenToday,
  listPriorityCases,
} from '@/services/queries';
import { FollowUpTabs } from './follow-up-tabs';

export const metadata = { title: 'Follow-up' };
export const dynamic = 'force-dynamic';

/**
 * The four lists that chase money which has not moved.
 *
 * Everything here is a read. "Missed" is derived from a predicate rather than a stored flag —
 * see `isOverdueInstalment` in queries.ts for why this page does not write on a read path.
 */
export default async function FollowUpPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.view')) redirect('/dashboard');

  const actor = toActor(session);
  const today = todayISO();

  // Sequential, not parallel: parallel tiles against a pooled connection were starving the
  // later pages of connections (see the note in getDashboardStats).
  const missed = await listMissedInstalments(actor, today);
  const notTaken = await listNotTakenToday(actor, today);
  const priority = await listPriorityCases(actor, today);
  const breached = await listBreachedCases(actor, today);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Follow-up"
        description="Days that came and went, today's counter, the large cases, and anything past its promise."
      />
      <FollowUpTabs
        today={today}
        missed={serialize(missed)}
        notTaken={serialize(notTaken)}
        priority={serialize(priority)}
        breached={serialize(breached)}
      />
    </div>
  );
}
