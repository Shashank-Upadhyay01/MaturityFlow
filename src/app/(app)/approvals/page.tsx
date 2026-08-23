import { Inbox } from 'lucide-react';
import { redirect } from 'next/navigation';

import { GlassCard, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getApprovalQueue } from '@/services/queries';
import { ApprovalQueue } from './approval-queue';

export const metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.approve')) redirect('/dashboard');

  const actor = toActor(session);
  const queue = await getApprovalQueue(actor);

  const branchIds = [...new Set(queue.map((q) => q.branchId))];
  const calendars = Object.fromEntries(
    await Promise.all(branchIds.map(async (id) => [id, await getCalendarSnapshot(id)] as const)),
  );

  const total = queue.reduce((a, q) => a + q.maturityAmountPaise, 0n);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Approvals"
        description="Approving a form is the moment the money becomes payable — the schedule and the promise to the customer both start here."
        actions={
          queue.length > 0 ? (
            <div className="glass rounded-[15px] px-4 py-2 text-right">
              <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                Waiting
              </p>
              <p className="text-[1.125rem] font-semibold tabular-nums">
                {queue.length} · <Money paise={total} compact />
              </p>
            </div>
          ) : null
        }
      />

      {queue.length === 0 ? (
        <GlassCard bodyClassName="p-0 sm:p-0">
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="Nothing waiting for approval"
            description="Every submitted maturity form has been dealt with. Agents will see their submissions appear here."
          />
        </GlassCard>
      ) : (
        <ApprovalQueue
          cases={serialize(queue)}
          calendars={calendars}
          today={todayISO()}
          canOverride={roleCan(session.role, 'schedule.override')}
        />
      )}
    </div>
  );
}
