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
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mf-rise flex shrink-0 flex-col gap-3 border-l-[3px] border-[var(--color-brand-600)] pl-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-[1.5rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--muted-fg)]">
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
