import { redirect } from 'next/navigation';

import { purgeAzamgarhOperationalDataAction } from '@/actions/branch-operational-purge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Glass, PageHeader } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { getSession } from '@/lib/auth/session';

export default async function PurgeAzamgarhPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/dashboard');

  return <div className="space-y-5">
    <PageHeader eyebrow="Administration" title="Clear Azamgarh register" description="Prepare the Azamgarh branch for a clean customer and maturity re-import." />
    <Callout tone="danger" title="This permanently clears customer and maturity records">
      This deletes Azamgarh customers, forecasts, cases, schedules, recorded payouts, case documents,
      case history and saved Register days. User accounts, agent profiles, the complete Daily Cashbook,
      cash positions, holidays, branch settings and the append-only audit trail are preserved.
    </Callout>
    <Glass className="space-y-4 p-5">
      <form action={purgeAzamgarhOperationalDataAction} className="space-y-4">
        <Field label="Type WIPE AZM to continue">
          <Input name="confirmation" autoComplete="off" required />
        </Field>
        <Button type="submit" variant="danger">Clear Azamgarh register</Button>
      </form>
    </Glass>
  </div>;
}
