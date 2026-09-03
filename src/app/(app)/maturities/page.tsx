import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { pickWorkingBranch, workingBranches } from '@/lib/branch-routing';
import { parseRegisterLayout } from '@/lib/register-layout';
import { parsePaidByDate, parsePayoutDays } from '@/lib/register-view';
import { activeRole, canTypeRegister, ROLE_SCOPE, roleCan } from '@/lib/rbac';
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

const EMPTY_DESK = {
  cashInHandPaise: 0n,
  plannedOnlinePaise: 0n,
  dayStatus: 'OPEN',
  withdrawalsToday: 0,
  paidTodayPaise: 0n,
  paidTodayCashPaise: 0n,
  paidTodayOnlinePaise: 0n,
};

export default async function MaturitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const today = todayISO();
  const options = await getFormOptions(actor);
  const hq = ROLE_SCOPE[activeRole(session.role)] === 'ALL';
  const sp = await searchParams;
  const picked = pickWorkingBranch(options.branches, {
    requested: sp.branch,
    sessionBranchId: session.branchId,
    hq,
  });
  const compiledView = picked.compiled;
  const branch = options.branches.find((b) => b.id === picked.branchId) ?? null;
  const [rows, loadedDesk] = await Promise.all([
    listRegister(actor, today, picked.branchId),
    branch ? getRegisterDesk(branch.id, today) : Promise.resolve(null),
  ]);
  const desk = loadedDesk ?? EMPTY_DESK;
  const cashLimit = branch?.dailyCashComfortPaise ?? rows[0]?.dailyCashComfortPaise ?? 50_000_000n;
  const sheetAgents = picked.branchId
    ? options.agents.filter((a) => a.branchId === picked.branchId)
    : options.agents;

  /**
   * A role that may not type the register gets none of its write affordances, whatever
   * permissions it holds elsewhere.
   *
   * An Agent still owns `case.create` and `case.submit` for the form workflow, so reading those
   * straight off the role left the "Add rows" button and the "Form in" tick interactive on a
   * sheet they are not allowed to change — the server rejected every click. Ask the register's
   * own question first, then the permission.
   *
   * HQ on the compiled "all branches" view also stays read-only: typing there used to create
   * rows on Azamgarh. Pick a branch first.
   */
  const canType = canTypeRegister(session.role) && !compiledView;
  const canOnSheet = (p: Parameters<typeof roleCan>[1]) => canType && roleCan(session.role, p);

  return (
    <div className="space-y-3">
      <RegisterTabs
        sheet={
          <RegisterSheet
            key={compiledView ? 'all' : picked.branchId ?? 'none'}
            role={session.role}
            branchLabel={
              compiledView
                ? 'All branches'
                : branch
                  ? `${branch.code} · ${branch.name}`
                  : 'Register'
            }
            compiledView={compiledView}
            branchId={branch?.id ?? ''}
            branchSwitch={
              hq
                ? {
                    path: '/maturities',
                    allowAll: true,
                    branches: workingBranches(options.branches).map((b) => ({
                      id: b.id,
                      code: b.code,
                      name: b.name,
                    })),
                  }
                : undefined
            }
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
            canCorrectPay={canOnSheet('payout.reverse')}
            canSubmit={canOnSheet('case.submit')}
            canImport={canOnSheet('data.import')}
            canCreate={canOnSheet('case.create')}
            canSetCash={canOnSheet('cash.setOpening')}
            canRequestClose={canOnSheet('payout.record') || canOnSheet('settings.manage')}
            canConfirmClose={canType && ['ADMIN', 'CMD', 'CEO'].includes(session.role)}
            canLayout={roleCan(session.role, 'settings.manage')}
            canRemove={canOnSheet('case.cancel')}
            columnLayout={parseRegisterLayout(branch?.registerColumnOrder)}
            agents={sheetAgents.map((a) => ({ id: a.id, name: a.name }))}
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
                scheduled: r.liveInstalmentCount > 0,
                todayInstalmentId: r.todayInstalmentId,
                todayDuePaise: r.todayDuePaise,
                todayPaidTakenPaise: r.todayPaidPaise,
                paidTodayActualPaise: r.paidTodayPaise,
                paidCashTodayPaise: r.paidTodayCashPaise,
                paidOnlineTodayPaise: r.paidTodayOnlinePaise,
                paidByDate: parsePaidByDate(r.paidByDate),
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
