'use client';

import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'glass' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-brand-600)] text-white shadow-sm hover:bg-[var(--color-brand-700)]',
  success:
    'bg-[var(--color-money-600)] text-white shadow-sm hover:bg-[var(--color-money-700)]',
  danger:
    'bg-[var(--color-danger-600)] text-white shadow-sm hover:bg-[var(--color-danger-500)]',
  glass:
    'glass glass-flat border text-[var(--page-fg)] ' +
    'hover:bg-[var(--glass-bg-strong)]',
  outline:
    'border border-[var(--input-border)] bg-transparent text-[var(--page-fg)] ' +
    'hover:bg-[var(--glass-bg-subtle)]',
  ghost: 'bg-transparent text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[0.8125rem] rounded-[8px]',
  md: 'h-10 gap-2 px-4 text-[0.875rem] rounded-[9px]',
  lg: 'h-12 gap-2.5 px-6 text-[0.9375rem] rounded-[10px]',
  icon: 'h-10 w-10 rounded-[9px]',
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
        'active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
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
