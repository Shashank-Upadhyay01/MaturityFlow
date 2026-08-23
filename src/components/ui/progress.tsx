import { cn } from '@/lib/utils';

export function Progress({
  value,
  className,
  tone = 'money',
  showLabel = false,
  height = 'md',
}: {
  /** 0–100 */
  value: number;
  className?: string;
  tone?: 'money' | 'brand' | 'warn' | 'danger';
  showLabel?: boolean;
  height?: 'sm' | 'md' | 'lg';
}) {
  const pct = Math.max(0, Math.min(100, value));
  const tones = {
    money: 'from-[var(--color-money-400)] to-[var(--color-money-600)]',
    brand: 'from-[var(--color-brand-400)] to-[var(--color-brand-600)]',
    warn: 'from-[var(--color-warn-400)] to-[var(--color-warn-600)]',
    danger: 'from-[var(--color-danger-400)] to-[var(--color-danger-600)]',
  } as const;
  const heights = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-3.5' } as const;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--muted-fg)_16%,transparent)]',
          heights[height],
        )}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full bg-gradient-to-r shadow-[0_0_12px_-2px_currentColor]',
            'transition-[width] duration-700 [transition-timing-function:var(--ease-out-quint)]',
            tones[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-11 shrink-0 text-right text-[0.75rem] font-semibold tabular-nums text-[var(--muted-fg)]">
          {pct.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
