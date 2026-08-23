import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { getFormOptions } from '@/services/queries';
import { RegisterImport } from './register-import';

export const metadata = { title: 'Import register' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'data.import')) redirect('/dashboard');

  const options = await getFormOptions(toActor(session));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Data"
        title="Import register"
        description="Feed the sheet the branch already uses. Submission date, payment date and remaining amount are kept; the daily plan is calculated here."
      />
      <RegisterImport
        branches={options.branches.map((b) => ({ id: b.id, code: b.code, name: b.name }))}
        defaultBranchId={session.branchId ?? options.branches[0]?.id ?? null}
      />
    </div>
  );
}
