import { redirect } from 'next/navigation';

import { getSession, toActor } from '@/lib/auth/session';
import { parseRegisterLayout } from '@/lib/register-layout';
import { canTypeRegister, roleCan } from '@/lib/rbac';
import { toISODateString, todayISO } from '@/lib/working-days';
import { getFormOptions, getRegisterDesk, listRegister } from '@/services/queries';
import { RegisterSheet } from './register-sheet';

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

  const cashLimit = branch?.dailyCashComfortPaise ?? rows[0]?.dailyCashComfortPaise ?? 50_000_000n;

  return (
    <div className="space-y-3">
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
        canEdit={canTypeRegister(session.role)}
        canPay={roleCan(session.role, 'payout.record')}
        canApprove={roleCan(session.role, 'case.approve')}
        canSubmit={roleCan(session.role, 'case.submit')}
        canImport={roleCan(session.role, 'data.import')}
        canCreate={roleCan(session.role, 'case.create')}
        canSetCash={roleCan(session.role, 'cash.setOpening')}
        canRequestClose={roleCan(session.role, 'payout.record') || roleCan(session.role, 'settings.manage')}
        canConfirmClose={['ADMIN', 'OPS_HEAD', 'CMD', 'CEO'].includes(session.role)}
        canLayout={roleCan(session.role, 'settings.manage')}
        canRemove={roleCan(session.role, 'case.cancel')}
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
            formSubmitted: Boolean(r.submittedAt) || ['SUBMITTED', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(r.status),
            approved: ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'].includes(r.status),
          };
        })}
      />
    </div>
  );
}
