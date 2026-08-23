import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { loadOrgSettings } from '@/services/org-settings';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/maturities');
  const org = await loadOrgSettings();
  return <LoginForm orgName={org.orgName} orgShortName={org.orgShortName} />;
}
