'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createAgentAction } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';

export function AgentManager({
  branches,
  defaultBranchId,
}: {
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createAgentAction, null);

  // Derived, not assigned from an effect: the form closes because the action succeeded.
  const showForm = open && !state?.ok;

  useEffect(() => {
    if (state?.ok) {
      toast.success('Agent added');
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <div className="w-full">
      <div className="flex justify-end">
        <Button variant={showForm ? 'ghost' : 'primary'} onClick={() => setOpen((v) => !v)}>
          <UserPlus className="h-4 w-4" />
          {showForm ? 'Cancel' : 'Add agent'}
        </Button>
      </div>

      {showForm && (
        <form
          action={formAction}
          className="mf-fade mt-4 grid gap-4 rounded-[15px] border border-dashed border-[var(--input-border)] p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Field label="Agent code" required error={fe.code} hint="Shown on every case, e.g. AG013">
            <Input name="code" required placeholder="AG013" />
          </Field>
          <Field label="Full name" required error={fe.name}>
            <Input name="name" required placeholder="Ramesh Tiwari" />
          </Field>
          <Field label="Phone" error={fe.phone}>
            <Input name="phone" placeholder="9XXXXXXXXX" />
          </Field>
          <Field label="Branch" required error={fe.branchId}>
            <Select name="branchId" defaultValue={defaultBranchId ?? branches[0]?.id ?? ''}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email" error={fe.email} className="sm:col-span-2">
            <Input name="email" type="email" placeholder="agent@bank.test" />
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-2">
            <Button type="submit" variant="primary" loading={pending}>
              Add agent
            </Button>
            <p className="ml-3 text-[0.75rem] leading-snug text-[var(--faint-fg)]">
              This creates the agent record. To give them a login, add a user with the
              <strong className="font-medium"> Agent </strong> role in Settings → Users.
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
