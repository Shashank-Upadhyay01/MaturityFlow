import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { isAzamgarhHeadBranch } from '@/lib/branch-routing';
import { DEFAULT_OPERATIONS_MATURITY_ON } from '@/lib/maturity-operations';
import { recommendedPerDay } from '@/lib/register-view';
import { roleCan } from '@/lib/rbac';
import { addDays, toISODateString, todayISO } from '@/lib/working-days';
import { getFormOptions, listRegister } from '@/services/queries';
import { OperationsGrid } from './operations-grid';

export const metadata = { title: 'Maturities' };
export const dynamic = 'force-dynamic';

export default async function MaturityOperationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  if (!roleCan(session.role, 'case.approve')) redirect('/dashboard');
  const today = todayISO();
  const [rows, options] = await Promise.all([listRegister(actor, today), getFormOptions(actor)]);
  const headBranch = options.branches.find(isAzamgarhHeadBranch) ?? options.branches[0] ?? null;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-brand-700)]">15-day maturity control</p>
        <h1 className="text-xl font-semibold tracking-tight">Operations review</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">Day 1 maturity · Day 2 form · Day 3 Operations review or automatic progression · Day 4 payment begins.</p>
      </div>
      <OperationsGrid
        canEdit={roleCan(session.role, 'case.approve')}
        canSchedule={roleCan(session.role, 'schedule.override')}
        canPay={roleCan(session.role, 'payout.record')}
        isAdmin={session.role === 'ADMIN' || session.role === 'OPS_HEAD'}
        addRowBranchId={headBranch?.id ?? null}
        rows={rows.map((row) => {
          const paid = row.paidCashPaise + row.paidOnlinePaise;
          const remaining = row.maturityAmountPaise - paid;
          const paymentOn = toISODateString(row.paymentOn) ?? toISODateString(row.firstPayoutOn) ?? '';
          const reviewDueOn = paymentOn ? addDays(paymentOn, -1) : '';
          const status = row.todayStatus;
          return {
            id: row.id,
            accountNumber: row.accountNumber ?? '',
            customerName: row.customerName,
            agentName: row.agentName,
            maturityRupees: (row.maturityAmountPaise / 100n).toString(),
            maturityOn: toISODateString(row.instrumentMaturityOn) ?? DEFAULT_OPERATIONS_MATURITY_ON,
            formSubmittedOn: toISODateString(row.formSubmittedOn) ?? row.formSubmittedOn,
            opsReviewedOn: toISODateString(row.opsReviewedOn) ?? '',
            paymentOn,
            duePaise: row.todayDuePaise,
            recommendedPaise: recommendedPerDay(remaining, row.maturityAmountPaise, row.windowDays).toString(),
            paidTodayPaise: row.paidTodayPaise,
            paidCashTodayPaise: row.paidTodayCashPaise,
            paidOnlineTodayPaise: row.paidTodayOnlinePaise,
            todayInstalmentId: row.todayInstalmentId,
            todayOnlineDuePaise: row.todayOnlineDuePaise,
            todayState: status === 'PAID' ? 'PAID' : status === 'MISSED' ? 'MISSED' : BigInt(row.todayDuePaise) > 0n ? 'DUE' : 'NONE',
            needsReview: !row.opsReviewedOn && Boolean(reviewDueOn) && reviewDueOn <= today,
          };
        })}
      />
    </div>
  );
}
