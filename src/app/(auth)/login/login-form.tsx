'use client';

import { AlertCircle, ArrowRight, Building2, Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { loginAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { ThemeToggle } from '@/components/layout/theme-toggle';

const DEMO_ACCOUNTS = [
  { role: 'CMD', email: 'cmd@bank.test' },
  { role: 'CEO', email: 'ceo@bank.test' },
  { role: 'Admin', email: 'admin@bank.test' },
  { role: 'Ops Head', email: 'ops@bank.test' },
  { role: 'Cashier', email: 'cashier@bank.test' },
] as const;

const DEMO_PASSWORD = 'Maturity@2026';

export function LoginForm({
  orgName,
  orgShortName,
}: {
  orgName?: string;
  orgShortName?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function fillDemo(email: string) {
    if (emailRef.current) emailRef.current.value = email;
    if (passwordRef.current) passwordRef.current.value = DEMO_PASSWORD;
    emailRef.current?.focus();
  }

  useEffect(() => {
    if (state?.ok) {
      toast.success('Signed in');
      router.replace(state.data?.mustChangePassword ? '/account/password' : '/maturities');
      router.refresh();
    }
  }, [state, router]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="absolute right-5 top-5">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[27rem]">
        <div className="mf-rise mb-7 flex flex-col items-center text-center">
          <div className="glass mb-4 flex h-14 w-14 items-center justify-center rounded-[18px]">
            <Building2 className="h-6 w-6 text-[var(--color-brand-500)]" />
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-[-0.02em]">
            {orgShortName || 'MaturityFlow'}
          </h1>
          <p className="mt-1.5 max-w-[22rem] text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
            {orgName || 'Maturity payout scheduling & disbursement control'}
          </p>
        </div>

        <Glass className="mf-rise p-6 sm:p-7" style={{ animationDelay: '90ms' } as React.CSSProperties}>
          <form action={formAction} className="space-y-4">
            <Field label="Email or username" htmlFor="identifier" error={fe.identifier}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
                <Input
                  ref={emailRef}
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="you@bank.test or admin"
                  className="pl-10"
                  aria-invalid={Boolean(fe.identifier)}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" error={fe.password}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
                <Input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••••"
                  className="pl-10"
                  aria-invalid={Boolean(fe.password)}
                />
              </div>
            </Field>

            {state && !state.ok && (
              <div
                role="alert"
                className="mf-fade flex items-start gap-2.5 rounded-[13px] border border-[color-mix(in_oklab,var(--color-danger-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-danger-500)_10%,transparent)] px-3.5 py-2.5"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger-500)]" />
                <p className="text-[0.8125rem] leading-relaxed">{state.error}</p>
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
              Sign in
              {!pending && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>
        </Glass>

        <div className="mf-fade mt-5">
          <p className="mb-2 text-center text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">
            Presentation logins
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => fillDemo(a.email)}
                className="rounded-full border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)] px-2.5 py-1 text-[0.75rem] text-[var(--muted-fg)] transition-colors hover:bg-[var(--glass-bg-strong)] hover:text-[var(--page-fg)]"
              >
                {a.role}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[0.6875rem] text-[var(--faint-fg)]">
            Password: {DEMO_PASSWORD}
          </p>
        </div>

        <p className="mf-fade mt-5 text-center text-[0.75rem] leading-relaxed text-[var(--faint-fg)]">
          Authorised users only. Every action in this system is recorded in an immutable audit trail.
        </p>
      </div>
    </main>
  );
}
