'use client';

import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarCheck2,
  Lock,
  Mail,
  Route,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';

import { loginAction } from '@/actions/auth';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

const FLOW_STEPS = [
  { icon: CalendarCheck2, label: 'Maturity recorded', detail: 'The customer promise is fixed.' },
  { icon: Route, label: 'Payout scheduled', detail: 'Every working day has a plan.' },
  { icon: WalletCards, label: 'Movement tracked', detail: 'Cash and account payouts stay visible.' },
] as const;

export function LoginForm({
  orgName,
  orgShortName,
}: {
  orgName?: string;
  orgShortName?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(loginAction, null);

  useEffect(() => {
    if (state?.ok) {
      toast.success('Signed in');
      router.replace(state.data?.mustChangePassword ? '/account/password' : '/maturities');
      router.refresh();
    }
  }, [state, router]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const productName = orgShortName || 'MaturityFlow';

  return (
    <main className="relative grid min-h-dvh grid-rows-[1fr_auto] overflow-hidden px-4 pb-5 pt-16 sm:px-7 sm:pb-6 sm:pt-20 lg:px-10">
      <div className="absolute right-4 top-4 z-10 sm:right-7 sm:top-6">
        <ThemeToggle className="h-10 w-10 bg-[var(--glass-bg)] shadow-[var(--glass-shadow)]" />
      </div>

      <section className="relative mx-auto grid w-full max-w-[68rem] self-center overflow-hidden rounded-[28px] border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-[var(--glass-shadow)] backdrop-blur-[28px] lg:grid-cols-[1.08fr_0.92fr]">
        <div className="mf-rise relative overflow-hidden border-b border-[var(--hairline)] px-6 py-7 sm:px-9 sm:py-9 lg:border-b-0 lg:border-r lg:px-12 lg:py-12">
          <div
            aria-hidden
            className="absolute -left-20 -top-28 h-72 w-72 rounded-full bg-[color-mix(in_oklab,var(--color-brand-500)_18%,transparent)] blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-28 right-0 h-64 w-64 rounded-full bg-[color-mix(in_oklab,var(--color-money-500)_13%,transparent)] blur-3xl"
          />

          <div className="relative">
            <div className="mb-8 flex items-center gap-3 lg:mb-11">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-700)] text-white shadow-[0_10px_28px_-12px_rgba(79,70,229,0.8)]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--faint-fg)]">
                  Maturity payout control
                </p>
                <p
                  title={orgName || productName}
                  className="mt-0.5 text-[0.9375rem] font-semibold tracking-[-0.01em]"
                >
                  {productName}
                </p>
              </div>
            </div>

            <h1 className="max-w-[29rem] text-[2.25rem] font-semibold leading-[1.03] tracking-[-0.045em] sm:text-[3.15rem]">
              Every maturity
              <span className="block text-[var(--color-brand-500)]">has a route.</span>
            </h1>
            <p className="mt-4 max-w-[30rem] text-[0.9375rem] leading-7 text-[var(--muted-fg)] sm:text-base">
              Schedule payouts, prepare branch cash, and record every rupee against one clear plan.
            </p>

            <div className="mt-8 grid gap-0 sm:grid-cols-3 lg:mt-11 lg:grid-cols-1">
              {FLOW_STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.label} className="relative flex min-w-0 gap-3 pb-5 last:pb-0 sm:pb-0 lg:pb-6">
                    {index < FLOW_STEPS.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute left-[17px] top-9 h-[calc(100%-2rem)] w-px bg-gradient-to-b from-[var(--color-brand-400)] to-[var(--hairline)] sm:left-9 sm:top-[17px] sm:h-px sm:w-[calc(100%-2rem)] lg:left-[17px] lg:top-9 lg:h-[calc(100%-2rem)] lg:w-px"
                      />
                    )}
                    <div className="relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-[color-mix(in_oklab,var(--color-brand-500)_28%,var(--glass-border))] bg-[var(--surface-solid)] text-[var(--color-brand-500)] shadow-sm">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[0.8125rem] font-semibold leading-tight">{step.label}</p>
                      <p className="mt-1 hidden text-[0.75rem] leading-snug text-[var(--faint-fg)] lg:block">
                        {step.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mf-rise flex items-center px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12" style={{ animationDelay: '80ms' }}>
          <div className="mx-auto w-full max-w-[23rem]">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand-500)]">
              Secure workspace
            </p>
            <h2 className="mt-2 text-[1.65rem] font-semibold tracking-[-0.03em]">Sign in</h2>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
              Use your assigned email address or username to continue.
            </p>

            <form action={formAction} className="mt-7 space-y-4">
              <Field label="Email or username" htmlFor="identifier" error={fe.identifier}>
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
                    className="h-12 pl-10"
                    style={{ paddingLeft: '2.75rem' }}
                    aria-invalid={Boolean(fe.identifier)}
                  />
                </div>
              </Field>

              <Field label="Password" htmlFor="password" error={fe.password}>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    placeholder="Enter your password"
                    className="h-12 pl-10"
                    style={{ paddingLeft: '2.75rem' }}
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

              <Button type="submit" variant="primary" size="lg" loading={pending} className="mt-1 h-12 w-full">
                Sign in
                {!pending && <ArrowRight className="h-4 w-4" />}
              </Button>
            </form>

            <div className="mt-6 flex items-center gap-2.5 border-t border-[var(--hairline)] pt-5 text-[0.75rem] leading-snug text-[var(--faint-fg)]">
              <ShieldCheck className="h-4 w-4 shrink-0 text-[var(--color-money-500)]" />
              <span>Private operational system · Authorised personnel only</span>
            </div>
          </div>
        </div>
      </section>

      <footer className="mf-fade mx-auto mt-5 flex w-full max-w-[68rem] flex-col items-center justify-between gap-1 text-center text-[0.6875rem] leading-relaxed text-[var(--faint-fg)] sm:flex-row sm:text-left">
        <span>Created and developed by Shashank Upadhyay · Archeon Solutions</span>
        <span>© 2026 Shashank Upadhyay &amp; Archeon Solutions. All rights reserved.</span>
      </footer>
    </main>
  );
}
