import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { parseRegisterLayout } from '@/lib/register-layout';
import { canTypeRegister, roleCan } from '@/lib/rbac';
import { toISODateString, todayISO } from '@/lib/working-days';
import { serialize } from '@/lib/serialize';
import { getCalendarSnapshot } from '@/services/calendar-service';
import {
  getFormOptions,
  getPlanBoardCases,
  getPlanBoardInstalments,
  getRegisterDesk,
  listRegister,
} from '@/services/queries';
import { PlanBoard } from './plan-board';
import { RegisterSheet } from './register-sheet';
import { RegisterTabs } from './register-tabs';

export const metadata = { title: 'Register' };
export const dynamic = 'force-dynamic';

export default async function MaturitiesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  const actor = toActor(session);
  const today = todayISO();
  const [rows, options] = await Promise.all([listRegister(actor), getFormOptions(actor)]);
  const branch =
    options.branches.find((b) => b.id === session.branchId) ?? options.branches[0] ?? null;
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

  // The planning board's inputs. Sequential rather than parallel — parallel reads against the
  // pooled connection were starving later pages (see the note in getDashboardStats).
  const planCases = await getPlanBoardCases(actor);
  const planInstalments = await getPlanBoardInstalments(actor);
  const calendar = branch
    ? await getCalendarSnapshot(branch.id)
    : { holidays: [], sundaysOff: true, saturdayRule: 'SECOND_FOURTH' as const };

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
        plan={
          <PlanBoard
            cases={serialize(planCases)}
            instalments={serialize(planInstalments)}
            calendar={calendar}
            today={today}
          />
        }
        sheet={
          <RegisterSheet
            role={session.role}
            branchLabel={branch ? `${branch.code} · ${branch.name}` : 'Register'}
            branchId={branch?.id ?? ''}
            today={today}
            dayStatus={desk.dayStatus}
            cashLimitPaise={cashLimit.toString()}
            cashInHandPaise={desk.cashInHandPaise.toString()}
            plannedOnlinePaise={desk.plannedOnlinePaise.toString()}
            withdrawalsToday={desk.withdrawalsToday}
            paidTodayPaise={desk.paidTodayPaise.toString()}
            canEdit={canType}
            canPay={canOnSheet('payout.record')}
            canApprove={canOnSheet('case.approve')}
            canSubmit={canOnSheet('case.submit')}
            canImport={canOnSheet('data.import')}
            canCreate={canOnSheet('case.create')}
            canSetCash={canOnSheet('cash.setOpening')}
            canRequestClose={canOnSheet('payout.record') || canOnSheet('settings.manage')}
            canConfirmClose={canType && ['ADMIN', 'OPS_HEAD', 'CMD', 'CEO'].includes(session.role)}
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
                paymentOn: toISODateString(r.paymentOn),
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
              };
            })}
          />
        }
      />
    </div>
  );
}
