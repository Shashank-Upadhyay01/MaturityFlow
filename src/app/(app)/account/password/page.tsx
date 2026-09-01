import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession } from '@/lib/auth/session';
import { defaultLandingPage } from '@/lib/landing-page';
import { ChangePasswordForm } from './change-password-form';

export const metadata = { title: 'Change password' };
export const dynamic = 'force-dynamic';

export default async function PasswordPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Change password"
        description={
          session.mustChangePassword
            ? 'Your account still uses a temporary password. Set your own before you carry on.'
            : 'Changing your password signs you out of every other device.'
        }
      />
      <ChangePasswordForm forced={session.mustChangePassword} next={defaultLandingPage(session)} />
    </div>
  );
}
