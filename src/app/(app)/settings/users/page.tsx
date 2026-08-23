import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { GlassCard, PageHeader } from '@/components/ui/glass';
import { db } from '@/db';
import { branches, users } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { UserManager } from './user-manager';

export const metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'user.manage')) redirect('/dashboard');

  const [rows, branchList] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        email: users.email,
        phone: users.phone,
        employeeCode: users.employeeCode,
        role: users.role,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        mustChangePassword: users.mustChangePassword,
        lockedUntil: users.lockedUntil,
        deletedAt: users.deletedAt,
        avatarKey: users.avatarKey,
        updatedAt: users.updatedAt,
        branchName: branches.name,
        branchCode: branches.code,
      })
      .from(users)
      .leftJoin(branches, eq(branches.id, users.branchId))
      .orderBy(asc(users.name)),
    db
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.code)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Users &amp; roles"
        description="Open anyone to change every field, disable or delete them, and read their full activity. Deactivating an account ends its live sessions immediately."
      />
      <GlassCard bodyClassName="p-0 sm:p-0">
        <UserManager
          users={serialize(rows)}
          branches={branchList}
          currentUserId={session.id}
        />
      </GlassCard>
    </div>
  );
}
