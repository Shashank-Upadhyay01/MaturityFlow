import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getFormOptions } from '@/services/queries';
import { NewMaturityForm } from './new-maturity-form';

export const metadata = { title: 'New maturity' };
export const dynamic = 'force-dynamic';

export default async function NewMaturityPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.create')) redirect('/dashboard');

  const actor = toActor(session);
  const options = await getFormOptions(actor);

  // One calendar per branch the user can file against — the client needs them to place
  // instalment dates without a round-trip on every keystroke.
  const calendars = Object.fromEntries(
    await Promise.all(
      options.branches.map(async (b) => [b.id, await getCalendarSnapshot(b.id)] as const),
    ),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intake"
        title="New maturity"
        description="Fill the form and the exact day-by-day payout plan builds itself as you type. What you see here is what the system will commit the moment you submit it."
      />
      <NewMaturityForm
        session={{ role: session.role, branchId: session.branchId, agentId: session.agentId }}
        options={serialize(options)}
        calendars={calendars}
        today={todayISO()}
        canOverride={roleCan(session.role, 'schedule.override')}
      />
    </div>
  );
}
