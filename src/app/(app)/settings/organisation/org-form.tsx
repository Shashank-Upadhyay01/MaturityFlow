'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { saveOrgSettingsAction } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, Stepper } from '@/components/ui/field';
import { MIN_WINDOW_DAYS } from '@/lib/payout-policy';
import { Glass } from '@/components/ui/glass';

export function OrgForm(props: {
  orgName: string;
  orgShortName: string;
  cashCap: string;
  defaultWindowDays: number;
  defaultRounding: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(saveOrgSettingsAction, null);
  const [windowDays, setWindowDays] = useState(props.defaultWindowDays);

  useEffect(() => {
    if (state?.ok) {
      toast.success('Organisation settings saved');
      router.refresh();
    } else if (state && !state.ok) toast.error(state.error);
  }, [state, router]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Glass className="p-6">
      <form action={formAction} className="space-y-4">
        <Field label="Organisation name" required error={fe.orgName} hint="Shown on the sign-in screen and in the workspace header">
          <Input name="orgName" defaultValue={props.orgName} required />
        </Field>
        <Field label="Short name" required error={fe.orgShortName}>
          <Input name="orgShortName" defaultValue={props.orgShortName} required />
        </Field>
        <Field
          label="Cash cap per customer per day"
          required
          error={fe.cashCap}
          hint="Anything above this on a day is planned as NEFT. Live cases already approved keep their own cap."
        >
          <MoneyInput name="cashCap" defaultValue={props.cashCap.replace(/\.00$/, '')} required />
        </Field>
        <Field label="Default rounding step" required error={fe.defaultRounding} hint="Used when a new branch is created">
          <MoneyInput name="defaultRounding" defaultValue={props.defaultRounding.replace(/\.00$/, '')} required />
        </Field>
        <Field label="Default payout window" error={fe.defaultWindowDays} hint="Working days, 1–60">
          <input type="hidden" name="defaultWindowDays" value={windowDays} />
          <Stepper value={windowDays} onChange={setWindowDays} min={MIN_WINDOW_DAYS} max={60} label="window days" suffix="days" />
        </Field>
        <Button type="submit" variant="primary" loading={pending}>
          Save organisation
        </Button>
      </form>
    </Glass>
  );
}
