import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { db } from '@/db';
import { users } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { ChangePasswordForm } from './password/change-password-form';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const [row] = await db
    .select({
      name: users.name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      employeeCode: users.employeeCode,
      avatarKey: users.avatarKey,
      updatedAt: users.updatedAt,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, session.id))
    .limit(1);

  if (!row) redirect('/login');

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <PageHeader
        eyebrow="Account"
        title="My profile"
        description="Your name, sign-in details and photo. Changing the password signs other devices out."
      />
      <ProfileForm
        userId={session.id}
        name={row.name}
        username={row.username}
        email={row.email}
        phone={row.phone}
        employeeCode={row.employeeCode}
        hasAvatar={Boolean(row.avatarKey)}
        avatarAt={row.updatedAt.getTime()}
        roleLabel={session.role}
        branchName={session.branchName}
      />
      <div className="space-y-3">
        <h2 className="text-[1.0625rem] font-semibold">Password</h2>
        <ChangePasswordForm forced={session.mustChangePassword} next="/account" />
      </div>
    </div>
  );
}
