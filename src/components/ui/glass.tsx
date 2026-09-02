import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** 'strong' for foreground panels, 'subtle' for nested wells. */
  tone?: 'default' | 'strong' | 'subtle';
  /** Adds a restrained hover affordance for clickable panels. */
  interactive?: boolean;
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
}

export function Glass({
  children,
  className,
  tone = 'default',
  interactive = false,
  as: Tag = 'div',
  style,
}: GlassProps) {
  return (
    <Tag
      style={style}
      className={cn(
        'glass',
        tone === 'strong' && 'glass-strong',
        tone === 'subtle' && 'glass-subtle',
        interactive && 'glass-interactive cursor-pointer',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function GlassCard({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
  tone,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: 'default' | 'strong' | 'subtle';
}) {
  return (
    <Glass tone={tone} className={cn('overflow-hidden', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate text-[0.9375rem] font-semibold tracking-tight">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-[var(--muted-fg)]">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn('px-5 py-4 sm:px-6 sm:py-5', bodyClassName)}>{children}</div>
    </Glass>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
  compact = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'mf-rise flex shrink-0 flex-col border-l-[3px] border-[var(--color-brand-600)] sm:flex-row sm:items-end sm:justify-between',
      compact ? 'gap-2 pl-3' : 'gap-3 pl-4',
      className,
    )}>
      <div className="min-w-0">
        {eyebrow && (
          <p className={cn(
            'font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]',
            compact ? 'mb-0.5 text-[0.625rem]' : 'mb-1 text-[0.6875rem]',
          )}>
            {eyebrow}
          </p>
        )}
        <h1 className={cn(
          'font-semibold leading-tight tracking-[-0.02em]',
          compact ? 'text-[1.125rem]' : 'text-[1.5rem] sm:text-[1.75rem]',
        )}>
          {title}
        </h1>
        {description && (
          <p className={cn(
            'text-[var(--muted-fg)]',
            compact ? 'mt-0.5 max-w-3xl text-[0.8125rem] leading-snug' : 'mt-1.5 max-w-2xl text-[0.9375rem] leading-relaxed',
          )}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--hairline)]', className)} />;
}
