'use client';

import { LayoutGrid, Loader2, RefreshCw, Table2 } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import type { PlanCase, PlanInstalment } from '@/lib/plan-view';
import { cn } from '@/lib/utils';
import { PlanBoard, type CalendarSnapshot } from './plan-board';

type View = 'sheet' | 'plan';
interface PlanPayload {
  cases: PlanCase[];
  instalments: PlanInstalment[];
  calendars: Record<string, CalendarSnapshot>;
  today: string;
  /** Server's answer on whether this user may commit the board's what-if. */
  canReplan: boolean;
}

/**
 * Keeps the typed sheet mounted while loading the heavier planning board only when requested.
 * The initial Register request no longer runs three queries and serialises every schedule for a
 * panel most clerks do not open.
 */
export function RegisterTabs({ sheet }: { sheet: ReactNode }) {
  const [view, setView] = useState<View>('sheet');
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/register/plan', { cache: 'no-store' });
      const payload = (await response.json()) as PlanPayload | { error?: string };
      if (!response.ok || !('cases' in payload)) {
        throw new Error('error' in payload && payload.error ? payload.error : 'Could not load the plan');
      }
      setPlan(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the plan');
    } finally {
      setLoading(false);
    }
  }, []);

  const open = (next: View) => {
    setView(next);
    if (next === 'plan' && !plan && !loading) void loadPlan();
  };

  const tab = (next: View, label: string, Icon: typeof Table2, hint: string) => (
    <button
      type="button"
      onClick={() => open(next)}
      title={hint}
      aria-current={view === next ? 'page' : undefined}
      className={cn(
        'flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[0.8125rem] transition-colors',
        view === next
          ? 'bg-[var(--color-brand-600)] font-medium text-white shadow-sm'
          : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="glass flex w-fit items-center gap-1 p-1 print:hidden">
        {tab('sheet', 'Sheet', Table2, 'The register, row by row')}
        {tab('plan', 'Plan', LayoutGrid, 'Today, and how every maturity is split into days')}
      </div>

      <div className={cn(view !== 'sheet' && 'hidden')}>{sheet}</div>
      {view === 'plan' && (
        plan ? (
          <PlanBoard {...plan} onApplied={() => void loadPlan()} />
        ) : (
          <Glass className="flex min-h-72 items-center justify-center p-8 text-center">
            {loading ? (
              <div>
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--color-brand-600)]" />
                <p className="mt-3 text-[0.875rem] font-medium">Loading the payout plan…</p>
              </div>
            ) : (
              <div>
                <p className="text-[0.875rem] font-medium">The payout plan could not be loaded</p>
                <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">{error}</p>
                <Button className="mt-4" size="sm" onClick={() => void loadPlan()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            )}
          </Glass>
        )
      )}
    </div>
  );
}
