import { Wallet } from 'lucide-react';
import { redirect } from 'next/navigation';

import { GlassCard, PageHeader } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { StatTile } from '@/components/ui/stat';
import { Money } from '@/components/ui/money';
import { getSession, toActor } from '@/lib/auth/session';
import { ROLE_SCOPE, roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { formatISODate, todayISO } from '@/lib/working-days';
import { getDueToday } from '@/services/payout-service';
import { getDashboardStats } from '@/services/queries';
import { PayoutDesk } from './payout-desk';

export const metadata = { title: 'Payout desk' };
export const dynamic = 'force-dynamic';

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'payout.record')) redirect('/dashboard');

  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : todayISO();
  const actor = toActor(session);
  const branchId = ROLE_SCOPE[session.role] === 'ALL' ? null : session.branchId;

  const [due, stats] = await Promise.all([
    getDueToday(branchId, date),
    getDashboardStats(actor, date),
  ]);

  const outstanding = due.reduce(
    (a, d) => a + (d.amountPaise - d.paidCashPaise - d.paidOnlinePaise),
    0n,
  );
  const cashNeeded = due.reduce(
    (a, d) => a + max0(d.cashLegPaise - d.paidCashPaise),
    0n,
  );
  const onlineNeeded = due.reduce(
    (a, d) => a + max0(d.onlineLegPaise - d.paidOnlinePaise),
    0n,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Counter"
        title="Payout desk"
        description={`What is due on ${formatISODate(date)}, including any earlier instalment that was missed. Record what actually goes out — cash, online, or a part payment.`}
      />

      <section className="mf-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Still to pay today" value={<Money paise={outstanding} compact />} tone="warn" />
        <StatTile label="Cash needed" value={<Money paise={cashNeeded} compact />} tone="money" />
        <StatTile label="Online to send" value={<Money paise={onlineNeeded} compact />} tone="brand" />
        <StatTile
          label="Paid so far"
          value={<Money paise={stats.paidTodayPaise} compact />}
          sub={
            <>
              <Money paise={stats.paidTodayCashPaise} compact /> cash ·{' '}
              <Money paise={stats.paidTodayOnlinePaise} compact /> online
            </>
          }
          tone="money"
        />
      </section>

      {due.length === 0 ? (
        <GlassCard bodyClassName="p-0 sm:p-0">
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="Nothing due"
            description={`No unpaid instalments are waiting for ${formatISODate(date)}. Either everything is settled, or this is not a working day.`}
          />
        </GlassCard>
      ) : (
        <PayoutDesk rows={serialize(due)} date={date} today={todayISO()} />
      )}
    </div>
  );
}

function max0(v: bigint): bigint {
  return v > 0n ? v : 0n;
}
