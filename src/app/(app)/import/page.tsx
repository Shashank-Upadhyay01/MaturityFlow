import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { ALL_BRANCHES, isAzamgarhHeadBranch } from '@/lib/branch-routing';
import { activeRole, roleCan } from '@/lib/rbac';
import { getFormOptions } from '@/services/queries';
import { RegisterImport } from './register-import';

export const metadata = { title: 'Import register' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'data.import')) redirect('/dashboard');

  const options = await getFormOptions(toActor(session));
  const canImportAll = ['ADMIN', 'CEO', 'CMD'].includes(activeRole(session.role));
  const headBranch = options.branches.find(isAzamgarhHeadBranch) ?? options.branches[0] ?? null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Import register"
        description="Feed the sheet the branch already uses. Submission date, payment date and remaining amount are kept; the daily plan is calculated here."
      />
      <RegisterImport
        branches={options.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        defaultBranchId={canImportAll ? ALL_BRANCHES : session.branchId ?? headBranch?.id ?? null}
        canImportAll={canImportAll}
        headBranchId={headBranch?.id ?? null}
      />
    </div>
  );
}
