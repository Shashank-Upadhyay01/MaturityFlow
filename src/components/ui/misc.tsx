import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Glass } from './glass';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-4 rounded-[18px] bg-[var(--glass-bg-subtle)] p-4 text-[var(--faint-fg)]">
          {icon}
        </div>
      )}
      <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('mf-skeleton h-4 w-full', className)} />;
}

export function CardSkeleton() {
  return (
    <Glass className="space-y-3 p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-3 w-32" />
    </Glass>
  );
}

export function KeyValue({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <dt className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[var(--faint-fg)]">
        {label}
      </dt>
      <dd className="text-[0.9375rem] font-medium">{children}</dd>
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
  className,
  icon,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'money';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  const tones = {
    info: 'border-[color-mix(in_oklab,var(--color-info-500)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-info-500)_10%,transparent)]',
    warn: 'border-[color-mix(in_oklab,var(--color-warn-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-500)_11%,transparent)]',
    danger: 'border-[color-mix(in_oklab,var(--color-danger-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-danger-500)_10%,transparent)]',
    money: 'border-[color-mix(in_oklab,var(--color-money-500)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-money-500)_10%,transparent)]',
  } as const;

  return (
    <div className={cn('flex gap-3 rounded-[15px] border px-4 py-3 backdrop-blur-sm', tones[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <p className="text-[0.8125rem] font-semibold">{title}</p>}
        {children && (
          <div className={cn('text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]', title && 'mt-0.5')}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
