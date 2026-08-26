import { redirect } from 'next/navigation';

import { Callout } from '@/components/ui/misc';
import { db } from '@/db';
import { branches } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { ROLE_SCOPE, roleCan, activeRole } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { getCashPlan } from '@/services/queries';
import { RunwayBoard } from './runway-board';
import { asc, eq } from 'drizzle-orm';

export const metadata = { title: 'Cash runway' };
export const dynamic = 'force-dynamic';

export default async function CashPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'cash.plan')) redirect('/dashboard');

  const sp = await searchParams;
  const all = ROLE_SCOPE[activeRole(session.role)] === 'ALL';

  const loaded = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(all ? eq(branches.isActive, true) : eq(branches.id, session.branchId ?? '__none__'))
    .orderBy(asc(branches.code));

  const paying = loaded.filter((b) => b.code !== 'HO');
  const branchList = paying.length > 0 ? paying : loaded;

  const branchId =
    sp.branch && branchList.some((b) => b.id === sp.branch)
      ? sp.branch
      : session.branchId && branchList.some((b) => b.id === session.branchId)
        ? session.branchId
        : branchList[0]?.id;

  if (!branchId) {
    return (
      <div className="space-y-4">
        <h1 className="text-[1.125rem] font-semibold">Cash runway</h1>
        <Callout tone="warn" title="No branch available">
          Your account is not attached to a branch.
        </Callout>
      </div>
    );
  }

  const plan = await getCashPlan(branchId, 14, todayISO());
  const branch = branchList.find((b) => b.id === branchId)!;

  return (
    <div className="space-y-3">
      {all && branchList.length > 1 && (
        <form className="flex items-center gap-2 print:hidden">
          <label htmlFor="branch" className="sr-only">
            Branch
          </label>
          <select
            id="branch"
            name="branch"
            defaultValue={branchId}
            className="mf-input h-9 max-w-xs py-1 text-[0.8125rem]"
          >
            {branchList.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-[11px] border border-[var(--input-border)] px-3 py-1.5 text-[0.8125rem] font-medium hover:bg-[var(--glass-bg-subtle)]"
          >
            Show
          </button>
        </form>
      )}
      <RunwayBoard
        even={serialize(plan.even)}
        front={serialize(plan.front)}
        comfortPaise={plan.comfortPaise.toString()}
        cashCapPaise={plan.cashCapPaise.toString()}
        todayOpeningPaise={plan.todayOpeningPaise.toString()}
        branchLabel={`${branch.code} · ${branch.name}`}
        branchId={branchId}
        today={todayISO()}
        canSetCash={roleCan(session.role, 'cash.setOpening')}
      />
    </div>
  );
}
