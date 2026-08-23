import { formatCompactPaise, formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Money is rendered from a decimal STRING (see lib/serialize) so nothing ever
 * round-trips through a JS number on its way to the screen.
 */
export function Money({
  paise,
  compact = false,
  decimals = true,
  symbol = true,
  className,
  tone,
}: {
  paise: bigint | string;
  compact?: boolean;
  decimals?: boolean;
  symbol?: boolean;
  className?: string;
  tone?: 'default' | 'money' | 'muted' | 'danger' | 'warn';
}) {
  const value = typeof paise === 'bigint' ? paise : BigInt(paise);
  const tones = {
    default: '',
    money: 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]',
    muted: 'text-[var(--muted-fg)]',
    danger: 'text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]',
    warn: 'text-[var(--color-warn-600)] dark:text-[var(--color-warn-400)]',
  } as const;

  return (
    <span
      className={cn('tnum tabular-nums', tone && tones[tone], className)}
      title={formatPaise(value)}
    >
      {compact ? formatCompactPaise(value, { symbol }) : formatPaise(value, { decimals, symbol })}
    </span>
  );
}
