'use client';

import { LayoutGrid, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

type View = 'sheet' | 'plan';

/**
 * Switches the Register between the sheet and the planning board.
 *
 * Both are rendered and only one is shown, rather than swapping them: unmounting the sheet would
 * throw away the clerk's filter, sort, selection and half-typed cells every time they glanced at
 * the plan. The board is mounted lazily on first visit so nobody pays for it until they open it,
 * and kept thereafter for the same reason.
 */
export function RegisterTabs({ sheet, plan }: { sheet: ReactNode; plan: ReactNode }) {
  const [view, setView] = useState<View>('sheet');
  const [planSeen, setPlanSeen] = useState(false);

  const open = (v: View) => {
    if (v === 'plan') setPlanSeen(true);
    setView(v);
  };

  const tab = (v: View, label: string, Icon: typeof Table2, hint: string) => (
    <button
      type="button"
      onClick={() => open(v)}
      title={hint}
      aria-current={view === v}
      className={cn(
        'flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[0.8125rem] transition-colors',
        view === v
          ? 'bg-[var(--glass-bg-strong)] font-medium shadow-sm'
          : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
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
      {planSeen && <div className={cn(view !== 'plan' && 'hidden')}>{plan}</div>}
    </div>
  );
}
