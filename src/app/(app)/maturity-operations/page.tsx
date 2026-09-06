import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { pickWorkingBranch, workingBranches } from '@/lib/branch-routing';
import { DEFAULT_OPERATIONS_MATURITY_ON } from '@/lib/maturity-operations';
import { leftoverOnPayoutDay, parsePayoutDays, recommendedPerDay } from '@/lib/register-view';
import { activeRole, ROLE_SCOPE, roleCan } from '@/lib/rbac';
import { addDays, toISODateString, todayISO } from '@/lib/working-days';
import { getFormOptions, listRegister } from '@/services/queries';
import { OperationsGrid } from './operations-grid';

export const metadata = { title: 'Maturities' };
export const dynamic = 'force-dynamic';

export default async function MaturityOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  if (!roleCan(session.role, 'case.approve')) redirect('/dashboard');
  const today = todayISO();
  const options = await getFormOptions(actor);
  const hq = ROLE_SCOPE[activeRole(session.role)] === 'ALL';
  const sp = await searchParams;
  const picked = pickWorkingBranch(options.branches, {
    requested: sp.branch,
    sessionBranchId: session.branchId,
    hq,
  });
  const rows = await listRegister(actor, today, picked.branchId);
  const branch = options.branches.find((b) => b.id === picked.branchId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[0.72rem] font-bold uppercase tracking-[0.09em] text-[var(--color-brand-700)]">15-day maturity control</p>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">Operations review</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">Day 1 maturity · Day 2 form · Day 3 Operations review or automatic progression · Day 4 payment begins.</p>
      </div>
      {hq && (
        <form className="flex items-center gap-2 print:hidden">
          <label htmlFor="ops-branch" className="sr-only">Branch</label>
          <select
            id="ops-branch"
            name="branch"
            defaultValue={picked.compiled ? 'all' : picked.branchId ?? ''}
            className="mf-input h-9 max-w-xs py-1 text-[0.8125rem]"
          >
            <option value="all">All branches</option>
            {workingBranches(options.branches).map((b) => (
              <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
            ))}
          </select>
          <button type="submit" className="rounded-[11px] border border-[var(--input-border)] px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-[var(--glass-bg-subtle)]">
            Show
          </button>
          {picked.compiled && (
            <span className="text-[0.8125rem] text-[var(--muted-fg)]">Every branch. Choose one to work a single register.</span>
          )}
        </form>
      )}
      <OperationsGrid
        canEdit={roleCan(session.role, 'case.approve')}
        canApproveDates={roleCan(session.role, 'case.approve')}
        canRemove={roleCan(session.role, 'case.cancel')}
        canSchedule={roleCan(session.role, 'schedule.override')}
        canPay={roleCan(session.role, 'payout.record')}
        isAdmin={session.role === 'ADMIN' || session.role === 'OPS_HEAD'}
        addRowBranchId={picked.compiled ? null : branch?.id ?? null}
        rows={rows.map((row) => {
          const paid = row.paidCashPaise + row.paidOnlinePaise;
          const remaining = row.maturityAmountPaise - paid;
          const paymentOn = toISODateString(row.paymentOn) ?? toISODateString(row.firstPayoutOn) ?? '';
          const reviewDueOn = paymentOn ? addDays(paymentOn, -1) : '';
          const status = row.todayStatus;
          const days = parsePayoutDays(row.payoutDays);
          const unpaid = days.find((day) => leftoverOnPayoutDay(day) > 0n && day.dueOn <= today);
          const takeId = row.todayInstalmentId ?? unpaid?.id ?? null;
          /*
            The day the ✓ actually answers for, so its confirmation can name that date and the
            money on it. `takeId` is today's instalment or, failing that, the oldest one still
            unpaid — a row cleared up on Thursday for a Monday that was never collected must not
            be confirmed as Thursday's money.
          */
          const takeDay = takeId ? days.find((day) => day.id === takeId) ?? null : null;
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
            remainingPaise: remaining.toString(),
            paidPaise: paid.toString(),
            missedPaise: row.overduePaise.toString(),
            duePaise: row.todayDuePaise,
            recommendedPaise: recommendedPerDay(remaining, row.maturityAmountPaise, row.windowDays).toString(),
            paidTodayPaise: row.paidTodayPaise,
            paidCashTodayPaise: row.paidTodayCashPaise,
            paidOnlineTodayPaise: row.paidTodayOnlinePaise,
            todayInstalmentId: takeId,
            takeDueOn: takeDay?.dueOn ?? (paymentOn || today),
            takeAmountPaise: (takeDay ? leftoverOnPayoutDay(takeDay) : BigInt(row.todayDuePaise)).toString(),
            todayOnlineDuePaise: row.todayOnlineDuePaise,
            todayState: status === 'PAID' && !unpaid ? 'PAID' : status === 'MISSED' || (unpaid && unpaid.dueOn < today) ? 'MISSED' : takeId ? 'DUE' : 'NONE',
            needsReview: !row.opsReviewedOn && Boolean(reviewDueOn) && reviewDueOn <= today,
          };
        })}
      />
    </div>
  );
}
