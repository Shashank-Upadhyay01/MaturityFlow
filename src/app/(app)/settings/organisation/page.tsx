import { redirect } from 'next/navigation';

import { Callout } from '@/components/ui/misc';
import { PageHeader } from '@/components/ui/glass';
import { getSession } from '@/lib/auth/session';
import { paiseToDecimalString } from '@/lib/money';
import { roleCan } from '@/lib/rbac';
import { loadOrgSettings } from '@/services/org-settings';
import { OrgForm } from './org-form';

export const metadata = { title: 'Organisation' };
export const dynamic = 'force-dynamic';

export default async function OrganisationPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'settings.manage')) redirect('/dashboard');

  const org = await loadOrgSettings();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Organisation"
        description="Name, cash cap and default schedule policy. These apply the next time a register is imported, a cash plan is drawn, or a new branch is added — live cases keep the figures they were approved with."
      />
      <Callout tone="info" title="What you cannot change from here">
        The payout engine still insists that instalments add up to the maturity amount, exactly, in
        paise. That is not a setting. Weekend rules stay per branch.
      </Callout>
      <OrgForm
        orgName={org.orgName}
        orgShortName={org.orgShortName}
        cashCap={paiseToDecimalString(org.cashCapPaise)}
        defaultWindowDays={org.defaultWindowDays}
        defaultRounding={paiseToDecimalString(org.defaultRoundingPaise)}
      />
    </div>
  );
}
