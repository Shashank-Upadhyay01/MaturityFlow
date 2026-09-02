import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { listForecastDeposits } from '@/services/forecast-service';
import { DepositInterestBoard } from './deposit-interest-board';

export const metadata = { title: 'Deposit interest' };
export const dynamic = 'force-dynamic';

/**
 * Headquarters reading of a deposit book at a chosen interest rate.
 *
 * Admin, CMD, CEO and a legacy Operations Head (mapped to Admin) only. The rate starts at
 * 8.50% and the third column updates as it is typed. Nothing here writes a payout schedule.
 */
export default async function DepositInterestPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'deposit.insights')) redirect('/dashboard');

  const seed = await listForecastDeposits(toActor(session));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3">
      <PageHeader
        compact
        eyebrow="Headquarters"
        title="Deposit interest"
        description="Type or upload deposits. Interest is live; maturity date is the customer's date. This does not rewrite any payout schedule."
      />
      <DepositInterestBoard seed={serialize(seed)} today={todayISO()} />
    </div>
  );
}
