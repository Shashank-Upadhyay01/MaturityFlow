import { Landmark } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { getSession, toActor } from '@/lib/auth/session';
import { ROLE_SCOPE, roleCan } from '@/lib/rbac';
import { getBranchRollup } from '@/services/queries';
import { db } from '@/db';
import { branches as branchesTable } from '@/db/schema';
import { asc, eq } from 'drizzle-orm';
import { paiseToDecimalString } from '@/lib/money';
import { BranchEditor } from './branch-editor';

export const metadata = { title: 'Branches' };
export const dynamic = 'force-dynamic';

export default async function BranchesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'branch.view') || ROLE_SCOPE[session.role] !== 'ALL') {
    redirect('/dashboard');
  }

  const canManage = roleCan(session.role, 'branch.manage');
  const [rows, editable] = await Promise.all([
    getBranchRollup(toActor(session)),
    canManage
      ? db.select().from(branchesTable).where(eq(branchesTable.isActive, true)).orderBy(asc(branchesTable.code))
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Network"
        title="Branches"
        description="Remaining at each branch. Add or edit a branch from here."
        actions={
          canManage ? (
            <BranchEditor
              branches={editable.map((b) => ({
                id: b.id,
                code: b.code,
                name: b.name,
                city: b.city,
                state: b.state,
                phone: b.phone,
                ifsc: b.ifsc,
                defaultWindowDays: b.defaultWindowDays,
                defaultRoundingRupees: paiseToDecimalString(b.defaultRoundingPaise),
                dailyCashComfortRupees: paiseToDecimalString(b.dailyCashComfortPaise),
                saturdayRule: b.saturdayRule,
                sundaysOff: b.sundaysOff,
              }))}
            />
          ) : null
        }
      />

      {rows.length === 0 && (
        <Glass className="p-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
          No branches yet.
          {canManage ? ' Use New branch to add the first one.' : ''}
        </Glass>
      )}

      <div className="mf-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((b) => {
          const remaining = BigInt(b.totalPaise) - BigInt(b.paidPaise);
          return (
            <Glass key={b.branchId} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[1.0625rem] font-semibold">
                    <Landmark className="h-4 w-4 text-[var(--color-brand-500)]" />
                    {b.branchName}
                  </p>
                  <p className="mt-0.5 text-[0.8125rem] text-[var(--muted-fg)]">
                    {b.branchCode}
                    {b.city ? ` · ${b.city}` : ''}
                  </p>
                </div>
                {b.overdueCases > 0 && <Badge tone="danger">{b.overdueCases} overdue</Badge>}
              </div>

              <p className="mt-4 text-[1.5rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">
                <Money paise={remaining} decimals={false} />
              </p>
              <p className="mt-1.5 text-[0.8125rem] text-[var(--muted-fg)]">
                {remaining === 0n
                  ? 'Nothing outstanding'
                  : `${b.liveCases} customer${b.liveCases === 1 ? '' : 's'} still owed`}
              </p>

              <div className="mt-4 flex gap-2 border-t pt-4">
                <Button asChild variant="glass" size="sm" className="flex-1">
                  <Link href={`/cash-planner?branch=${b.branchId}`}>Cash runway</Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="flex-1">
                  <Link href="/maturities">Register</Link>
                </Button>
              </div>
            </Glass>
          );
        })}
      </div>
    </div>
  );
}
