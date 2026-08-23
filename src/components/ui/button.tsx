'use client';

import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'glass' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white ' +
    'shadow-[0_1px_0_rgba(255,255,255,0.28)_inset,0_6px_18px_-6px_rgba(79,70,229,0.7)] ' +
    'hover:from-[var(--color-brand-400)] hover:to-[var(--color-brand-500)]',
  success:
    'bg-gradient-to-b from-[var(--color-money-500)] to-[var(--color-money-600)] text-white ' +
    'shadow-[0_1px_0_rgba(255,255,255,0.28)_inset,0_6px_18px_-6px_rgba(5,150,105,0.7)] ' +
    'hover:from-[var(--color-money-400)] hover:to-[var(--color-money-500)]',
  danger:
    'bg-gradient-to-b from-[var(--color-danger-500)] to-[var(--color-danger-600)] text-white ' +
    'shadow-[0_1px_0_rgba(255,255,255,0.28)_inset,0_6px_18px_-6px_rgba(225,29,72,0.65)] ' +
    'hover:from-[var(--color-danger-400)] hover:to-[var(--color-danger-500)]',
  glass:
    'glass glass-flat border text-[var(--page-fg)] backdrop-blur-xl ' +
    'hover:bg-[var(--glass-bg-strong)]',
  outline:
    'border border-[var(--input-border)] bg-transparent text-[var(--page-fg)] ' +
    'hover:bg-[var(--glass-bg-subtle)]',
  ghost: 'bg-transparent text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[0.8125rem] rounded-[11px]',
  md: 'h-10 gap-2 px-4 text-[0.875rem] rounded-[13px]',
  lg: 'h-12 gap-2.5 px-6 text-[0.9375rem] rounded-[15px]',
  icon: 'h-10 w-10 rounded-[13px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'glass', size = 'md', loading, asChild, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[transform,box-shadow,background-color,opacity] duration-200',
        '[transition-timing-function:var(--ease-out-quint)]',
        'active:scale-[0.975] disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="sr-only">Working…</span>
          {size !== 'icon' && children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
});
