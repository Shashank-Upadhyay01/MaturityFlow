import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/glass';
import { db } from '@/db';
import { branches } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { getUserDossier } from '@/services/queries';
import { UserDossier } from './user-dossier';

export const metadata = { title: 'User' };
export const dynamic = 'force-dynamic';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'user.manage')) redirect('/dashboard');

  const { id } = await params;
  const [dossier, branchList] = await Promise.all([
    getUserDossier(id, session.tokenId),
    db
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.code)),
  ]);
  if (!dossier) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title={dossier.user.name}
        description="Every field, every session, every action this account has taken. Change it here instead of asking for a code change."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/settings/users">All users</Link>
          </Button>
        }
      />
      <UserDossier
        dossier={serialize(dossier)}
        branches={branchList}
        currentUserId={session.id}
      />
    </div>
  );
}
