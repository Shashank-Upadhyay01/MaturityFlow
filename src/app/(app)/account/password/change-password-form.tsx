'use client';

import { Check, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { changePasswordAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { PASSWORD_RULES, checkPasswordStrength } from '@/lib/auth/password-policy';
import { cn } from '@/lib/utils';

export function ChangePasswordForm({ forced, next = '/dashboard' }: { forced: boolean; next?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(changePasswordAction, null);
  const [pw, setPw] = useState('');

  useEffect(() => {
    if (state?.ok) {
      toast.success('Password changed');
      router.push(next);
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const strength = checkPasswordStrength(pw);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <div className="space-y-4">
      {forced && (
        <Callout
          tone="warn"
          title="Temporary password in use"
          icon={<ShieldAlert className="h-4 w-4 text-[var(--color-warn-500)]" />}
        >
          Anyone who has seen the password you were given can sign in as you. Change it now.
        </Callout>
      )}

      <Glass className="p-6">
        <form action={formAction} className="space-y-4">
          <Field label="Current password" required error={fe.currentPassword}>
            <Input name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" required error={fe.newPassword}>
            <Input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm new password" required error={fe.confirmPassword}>
            <Input name="confirmPassword" type="password" autoComplete="new-password" required />
          </Field>

          {pw.length > 0 && (
            <ul className="space-y-1 rounded-[13px] border border-[var(--input-border)] bg-[var(--glass-bg-subtle)] px-4 py-3">
              {PASSWORD_RULES.map(({ label, test }) => {
                const ok = test(pw);
                return (
                <li
                  key={label}
                  className={cn(
                    'flex items-center gap-2 text-[0.8125rem]',
                    ok ? 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]' : 'text-[var(--muted-fg)]',
                  )}
                >
                  <Check className={cn('h-3.5 w-3.5', ok ? 'opacity-100' : 'opacity-25')} />
                  {label}
                </li>
                );
              })}
            </ul>
          )}

          <Button type="submit" variant="primary" loading={pending} disabled={!strength.ok} className="w-full">
            Change password
          </Button>
        </form>
      </Glass>
    </div>
  );
}
