'use client';

import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { loginAction } from '@/actions/auth';
import { AppFooter } from '@/components/layout/app-footer';
import { BrandMark } from '@/components/layout/brand-mark';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function LoginForm({
  orgName,
  orgShortName,
}: {
  orgName?: string;
  orgShortName?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      toast.success('Signed in');
      router.replace(state.data?.mustChangePassword ? '/account/password' : (state.data?.next ?? '/maturities'));
      router.refresh();
    }
  }, [state, router]);

  const fieldErrors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const productName = orgShortName || 'MaturityFlow';

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-6">
        <ThemeToggle className="h-10 w-10 bg-[var(--glass-bg)] shadow-[var(--glass-shadow)]" />
      </div>

      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[8%] h-[25rem] w-[25rem] -translate-x-1/2 rounded-full bg-[color-mix(in_oklab,var(--color-brand-500)_10%,transparent)] blur-3xl sm:h-[34rem] sm:w-[34rem]" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-[var(--glass-border-quiet)] to-transparent" />
      </div>

      <section className="relative z-10 mx-auto flex w-full max-w-[29rem] flex-1 flex-col justify-center px-5 py-16 sm:px-6">
        <div className="mf-rise flex flex-col items-center text-center">
          <BrandMark animated className="h-[4.75rem] w-[4.75rem]" />
          <p className="mt-5 text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-[var(--color-brand-500)]">
            Secure operations workspace
          </p>
          <h1 className="mt-2 max-w-full truncate text-[1.75rem] font-semibold tracking-[-0.04em]" title={orgName || productName}>
            {productName}
          </h1>
          <p className="mt-2 max-w-[25rem] text-[0.875rem] leading-6 text-[var(--muted-fg)]">
            One trusted workspace for branch operations, customers, payouts and reporting.
          </p>
        </div>

        <div className="glass mf-rise mt-7 p-5 shadow-[var(--glass-shadow-lifted)] sm:p-7" style={{ animationDelay: '80ms' }}>
          <div>
            <h2 className="text-[1.25rem] font-semibold tracking-[-0.025em]">Welcome back</h2>
            <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">Sign in with your assigned account.</p>
          </div>

          <form action={formAction} className="mt-6 space-y-4">
            <Field label="Email or username" htmlFor="identifier" error={fieldErrors.identifier}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
                <Input
                  id="identifier"
                  name="identifier"
                  type="text"
                  autoComplete="username"
                  autoFocus
                  required
                  placeholder="Enter email or username"
                  className="h-12"
                  style={{ paddingLeft: '2.75rem' }}
                  aria-invalid={Boolean(fieldErrors.identifier)}
                />
              </div>
            </Field>

            <Field label="Password" htmlFor="password" error={fieldErrors.password}>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  className="h-12"
                  style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[9px] text-[var(--faint-fg)] transition-colors hover:bg-[var(--glass-bg-strong)] hover:text-[var(--page-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
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

            <Button type="submit" variant="primary" size="lg" loading={pending} className="h-12 w-full">
              Sign in
              {!pending && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-2 border-t border-[var(--hairline)] pt-4 text-center text-[0.6875rem] leading-snug text-[var(--faint-fg)]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--color-money-500)]" />
            <span>Protected system · Authorised personnel only</span>
          </div>
        </div>
      </section>

      <AppFooter className="relative z-10 bg-[color-mix(in_oklab,var(--page-bg)_82%,transparent)]" />
    </main>
  );
}
