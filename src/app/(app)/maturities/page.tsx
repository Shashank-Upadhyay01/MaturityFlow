import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { parseRegisterLayout } from '@/lib/register-layout';
import { parsePayoutDays } from '@/lib/register-view';
import { activeRole, canTypeRegister, ROLE_SCOPE, roleCan } from '@/lib/rbac';
import { isAzamgarhHeadBranch } from '@/lib/branch-routing';
import { toISODateString, todayISO } from '@/lib/working-days';
import {
  getFormOptions,
  getRegisterDesk,
  listRegister,
} from '@/services/queries';
import { RegisterSheet } from './register-sheet';
import { RegisterTabs } from './register-tabs';

export const metadata = { title: 'Register' };
export const dynamic = 'force-dynamic';

export default async function MaturitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const today = todayISO();
  const [rows, options] = await Promise.all([listRegister(actor, today), getFormOptions(actor)]);
  const compiledView = ROLE_SCOPE[activeRole(session.role)] === 'ALL';
  const headBranch = options.branches.find(isAzamgarhHeadBranch) ?? options.branches[0] ?? null;
  const branch = options.branches.find((b) => b.id === session.branchId) ?? headBranch;
  const desk = branch
    ? await getRegisterDesk(branch.id, today)
    : {
        cashInHandPaise: 0n,
        plannedOnlinePaise: 0n,
        dayStatus: 'OPEN',
        withdrawalsToday: 0,
        paidTodayPaise: 0n,
        paidTodayCashPaise: 0n,
        paidTodayOnlinePaise: 0n,
      };

  const cashLimit = branch?.dailyCashComfortPaise ?? rows[0]?.dailyCashComfortPaise ?? 50_000_000n;

  /**
   * A role that may not type the register gets none of its write affordances, whatever
   * permissions it holds elsewhere.
   *
   * An Agent still owns `case.create` and `case.submit` for the form workflow, so reading those
   * straight off the role left the "Add rows" button and the "Form in" tick interactive on a
   * sheet they are not allowed to change — the server rejected every click. Ask the register's
   * own question first, then the permission.
   */
  const canType = canTypeRegister(session.role);
  const canOnSheet = (p: Parameters<typeof roleCan>[1]) => canType && roleCan(session.role, p);

  return (
    <div className="space-y-3">
      <RegisterTabs
        sheet={
          <RegisterSheet
            role={session.role}
            branchLabel={
              compiledView
                ? `All branches · Head: ${headBranch ? `${headBranch.code} — ${headBranch.name}` : 'Azamgarh'}`
                : branch
                  ? `${branch.code} · ${branch.name}`
                  : 'Register'
            }
            branchId={branch?.id ?? ''}
            today={today}
            dayStatus={desk.dayStatus}
            cashLimitPaise={cashLimit.toString()}
            cashInHandPaise={desk.cashInHandPaise.toString()}
            plannedOnlinePaise={desk.plannedOnlinePaise.toString()}
            withdrawalsToday={desk.withdrawalsToday}
            paidTodayPaise={desk.paidTodayPaise.toString()}
            canEdit={canType}
            canSchedule={canOnSheet('schedule.override')}
            canPay={canOnSheet('payout.record')}
            canSubmit={canOnSheet('case.submit')}
            canImport={canOnSheet('data.import') && !compiledView}
            canCreate={canOnSheet('case.create')}
            canSetCash={canOnSheet('cash.setOpening')}
            canRequestClose={canOnSheet('payout.record') || canOnSheet('settings.manage')}
            canConfirmClose={canType && ['ADMIN', 'CMD', 'CEO'].includes(session.role)}
            canLayout={roleCan(session.role, 'settings.manage')}
            canRemove={canOnSheet('case.cancel')}
            columnLayout={parseRegisterLayout(branch?.registerColumnOrder)}
            agents={options.agents.map((a) => ({ id: a.id, name: a.name }))}
            rows={rows.map((r) => {
              const paid = r.paidCashPaise + r.paidOnlinePaise;
              return {
                id: r.id,
                accountNumber: r.accountNumber,
                customerName: r.customerName,
                instrumentMaturityOn: toISODateString(r.instrumentMaturityOn),
                formSubmittedOn: toISODateString(r.formSubmittedOn) ?? r.formSubmittedOn,
                paymentOn: toISODateString(r.paymentOn) ?? toISODateString(r.firstPayoutOn),
                maturityPaise: r.maturityAmountPaise.toString(),
                paidPaise: paid.toString(),
                paidCashPaise: r.paidCashPaise.toString(),
                paidOnlinePaise: r.paidOnlinePaise.toString(),
                remainingPaise: (r.maturityAmountPaise - paid).toString(),
                todayPaise: r.todayApprovedPaise.toString(),
                todayCashPaise: r.todayCashPaise.toString(),
                todayOnlinePaise: r.todayOnlinePaise.toString(),
                windowDays: r.windowDays,
                agentName: r.agentName,
                agentId: r.agentId,
                status: r.status,
                formSubmitted:
                  Boolean(r.submittedAt) ||
                  ['SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status),
                approved: ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'].includes(r.status),
                /*
                  "Scheduled" is a fact about the case, read off the instalment table, not a box
                  anybody ticks. Approval is gone (ADR-0005): submitting a row generates its
                  schedule, and that is the only thing that can make this true.
                */
                scheduled: r.liveInstalmentCount > 0,
                todayInstalmentId: r.todayInstalmentId,
                todayDuePaise: r.todayDuePaise,
                todayPaidTakenPaise: r.todayPaidPaise,
                paidTodayActualPaise: r.paidTodayPaise,
                paidCashTodayPaise: r.paidTodayCashPaise,
                paidOnlineTodayPaise: r.paidTodayOnlinePaise,
                todayStatus: r.todayStatus,
                todayCashDuePaise: r.todayCashDuePaise,
                todayOnlineDuePaise: r.todayOnlineDuePaise,
                overdueCount: r.overdueCount,
                overduePaise: r.overduePaise,
                payoutDays: parsePayoutDays(r.payoutDays),
              };
            })}
          />
        }
      />
    </div>
  );
}
