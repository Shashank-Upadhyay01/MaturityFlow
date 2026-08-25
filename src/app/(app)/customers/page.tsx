import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getCustomerBook, getFormOptions, getPlanBoardInstalments } from '@/services/queries';
import { CustomerList } from './customer-list';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

/**
 * Every customer of the bank.
 *
 * The Agents page answers "what is this agent carrying". This answers the question the branch
 * gets asked on the phone: what is this person owed, has it arrived, and when does the rest come.
 */
export default async function CustomersPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.view')) redirect('/dashboard');

  const actor = toActor(session);
  const today = todayISO();

  // Sequential — parallel reads against the pooled connection were starving later pages.
  const cases = await getCustomerBook(actor);
  const instalments = await getPlanBoardInstalments(actor);
  const options = await getFormOptions(actor);
  const branch = options.branches.find((b) => b.id === session.branchId) ?? options.branches[0];
  const calendar = branch
    ? await getCalendarSnapshot(branch.id)
    : { holidays: [], sundaysOff: true, saturdayRule: 'SECOND_FOURTH' as const };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customers"
        description="Who is owed what, whether it has arrived, and the day-by-day plan for the rest."
      />
      <CustomerList
        cases={serialize(cases)}
        instalments={serialize(instalments)}
        calendar={calendar}
        today={today}
      />
    </div>
  );
}
