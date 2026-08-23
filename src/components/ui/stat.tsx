import type { ReactNode } from 'react';
import { Glass } from './glass';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'default',
  className,
  footer,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'money' | 'brand' | 'warn' | 'danger';
  className?: string;
  footer?: ReactNode;
}) {
  const accent = {
    default: 'from-transparent to-transparent',
    money: 'from-[color-mix(in_oklab,var(--color-money-500)_16%,transparent)] to-transparent',
    brand: 'from-[color-mix(in_oklab,var(--color-brand-500)_16%,transparent)] to-transparent',
    warn: 'from-[color-mix(in_oklab,var(--color-warn-500)_18%,transparent)] to-transparent',
    danger: 'from-[color-mix(in_oklab,var(--color-danger-500)_16%,transparent)] to-transparent',
  } as const;

  const iconTone = {
    default: 'text-[var(--muted-fg)]',
    money: 'text-[var(--color-money-500)]',
    brand: 'text-[var(--color-brand-500)]',
    warn: 'text-[var(--color-warn-500)]',
    danger: 'text-[var(--color-danger-500)]',
  } as const;

  return (
    <Glass className={cn('relative min-w-0 overflow-hidden p-4', className)}>
      <div
        className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br', accent[tone])}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.75rem] font-medium uppercase tracking-[0.08em] text-[var(--faint-fg)]">
            {label}
          </p>
          <p className="mt-1.5 break-all text-[clamp(1.05rem,2.2vw,1.5rem)] font-semibold leading-none tracking-[-0.02em] tabular-nums">
            {value}
          </p>
          {sub && <p className="mt-1.5 text-[0.8125rem] text-[var(--muted-fg)]">{sub}</p>}
        </div>
        {icon && (
          <div className={cn('shrink-0 rounded-[13px] bg-[var(--glass-bg-subtle)] p-2.5', iconTone[tone])}>
            {icon}
          </div>
        )}
      </div>
      {footer && <div className="relative mt-4 border-t pt-3 text-[0.75rem] text-[var(--muted-fg)]">{footer}</div>}
    </Glass>
  );
}
