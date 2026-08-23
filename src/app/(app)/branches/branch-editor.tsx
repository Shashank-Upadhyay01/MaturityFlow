'use client';

import { Building2, Pencil, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { upsertBranchAction } from '@/actions/admin';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, Select } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';

export interface EditableBranch {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  ifsc: string | null;
  defaultWindowDays: number;
  defaultRoundingRupees: string;
  dailyCashComfortRupees: string;
  saturdayRule: 'NONE' | 'ALL' | 'SECOND_FOURTH';
  sundaysOff: boolean;
}

export function BranchEditor({ branches }: { branches: EditableBranch[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditableBranch | 'new' | null>(null);
  const [state, formAction, pending] = useActionState(upsertBranchAction, null);

  const open = editing !== null && !state?.ok;

  useEffect(() => {
    if (state?.ok) {
      toast.success('Branch saved', {
        description: 'New schedules from this branch use the updated policy immediately.',
      });
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const b = editing === 'new' || editing === null ? null : editing;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {branches.length > 0 && (
          <Select
            className="w-auto min-w-[13rem]"
            value=""
            onChange={(e) => {
              const found = branches.find((x) => x.id === e.target.value);
              if (found) setEditing(found);
            }}
          >
            <option value="">Edit a branch…</option>
            {branches.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} — {x.name}
              </option>
            ))}
          </Select>
        )}
        <Button variant={open ? 'ghost' : 'primary'} onClick={() => setEditing(open ? null : 'new')}>
          {open ? 'Cancel' : <><Plus className="h-4 w-4" /> New branch</>}
        </Button>
      </div>

      {open && (
        <Glass className="mf-fade p-5">
          <p className="mb-4 flex items-center gap-2 text-[0.9375rem] font-semibold">
            {b ? <Pencil className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
            {b ? `Editing ${b.code} — ${b.name}` : 'New branch'}
          </p>

          <form action={formAction} key={b?.id ?? 'new'} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {b && <input type="hidden" name="id" value={b.id} />}

            <Field label="Branch code" required error={fe.code} hint="Prefix of every case number">
              <Input name="code" required defaultValue={b?.code} placeholder="BHAW" />
            </Field>
            <Field label="Branch name" required error={fe.name}>
              <Input name="name" required defaultValue={b?.name} placeholder="Bhawarnath Branch" />
            </Field>
            <Field label="IFSC" error={fe.ifsc}>
              <Input name="ifsc" defaultValue={b?.ifsc ?? ''} placeholder="MFBK0001234" />
            </Field>
            <Field label="City" error={fe.city}>
              <Input name="city" defaultValue={b?.city ?? ''} />
            </Field>
            <Field label="State" error={fe.state}>
              <Input name="state" defaultValue={b?.state ?? ''} />
            </Field>
            <Field label="Phone" error={fe.phone}>
              <Input name="phone" defaultValue={b?.phone ?? ''} />
            </Field>

            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mb-3 mt-1 border-t pt-4 text-[0.8125rem] font-semibold">
                Payout policy — these become the defaults on every new maturity at this branch
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Default window" required error={fe.defaultWindowDays} hint="working days">
                  <Input
                    name="defaultWindowDays"
                    type="number"
                    min={1}
                    max={60}
                    required
                    defaultValue={b?.defaultWindowDays ?? 15}
                  />
                </Field>
                <Field label="Default rounding" required error={fe.defaultRounding} hint="each day is a multiple of this">
                  <MoneyInput
                    name="defaultRounding"
                    required
                    defaultValue={b?.defaultRoundingRupees ?? '1000'}
                    className="!text-[1rem]"
                  />
                </Field>
                <Field label="Cash normally at the counter" required error={fe.dailyCashComfort} hint="drives the shortfall warning">
                  <MoneyInput
                    name="dailyCashComfort"
                    required
                    defaultValue={b?.dailyCashComfortRupees ?? '500000'}
                    className="!text-[1rem]"
                  />
                </Field>
                <Field label="Saturdays" error={fe.saturdayRule}>
                  <Select name="saturdayRule" defaultValue={b?.saturdayRule ?? 'SECOND_FOURTH'}>
                    <option value="SECOND_FOURTH">2nd &amp; 4th closed</option>
                    <option value="ALL">All closed</option>
                    <option value="NONE">All open</option>
                  </Select>
                </Field>
              </div>
              <label className="mt-4 flex items-center gap-2.5 text-[0.875rem]">
                <input
                  type="checkbox"
                  name="sundaysOff"
                  defaultChecked={b?.sundaysOff ?? true}
                  className="h-4 w-4 rounded border-[var(--input-border)]"
                />
                Sundays closed
              </label>
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" variant="primary" loading={pending}>
                {b ? 'Save changes' : 'Create branch'}
              </Button>
            </div>
          </form>
        </Glass>
      )}
    </div>
  );
}
