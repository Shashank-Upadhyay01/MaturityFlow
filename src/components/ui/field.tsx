'use client';

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const generatedId = useId();
  const element = isValidElement(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const directControl = Boolean(
    element &&
      (element.type === 'input' ||
        element.type === 'select' ||
        element.type === 'textarea' ||
        element.type === Input ||
        element.type === MoneyInput ||
        element.type === Select ||
        element.type === Textarea),
  );
  const controlId = htmlFor ?? element?.props.id ?? generatedId;
  const messageId = error || hint ? `${generatedId}-message` : undefined;
  const renderedChildren =
    directControl && element
      ? cloneElement(element, {
          id: controlId,
          'aria-describedby': element.props['aria-describedby'] ?? messageId,
        })
      : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        directControl ? (
          <label
            htmlFor={controlId}
            className="flex items-center gap-1 text-[0.8125rem] font-medium text-[var(--muted-fg)]"
          >
            {label}
            {required && <span className="text-[var(--color-danger-500)]" aria-hidden>*</span>}
          </label>
        ) : (
          <span className="flex items-center gap-1 text-[0.8125rem] font-medium text-[var(--muted-fg)]">
            {label}
            {required && <span className="text-[var(--color-danger-500)]" aria-hidden>*</span>}
          </span>
        )
      )}
      {renderedChildren}
      {error ? (
        <p id={messageId} className="text-[0.75rem] font-medium text-[var(--color-danger-500)]">{error}</p>
      ) : hint ? (
        <p id={messageId} className="text-[0.75rem] leading-snug text-[var(--faint-fg)]">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('mf-input', className)} {...props} />;
  },
);

export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function MoneyInput({ className, ...props }, ref) {
    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[1.25rem] font-semibold text-[var(--faint-fg)]">
          ₹
        </span>
        <input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          className={cn('mf-input mf-input-money pl-9', className)}
          {...props}
        />
      </div>
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn('mf-input appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden
        >
          <path d="m6 8 4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn('mf-input min-h-[84px] resize-y', className)} {...props} />;
  },
);

/** Segmented control — the day/rounding/mode pickers in the calculator. */
export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'inline-flex w-full items-center gap-1 rounded-[9px] border border-[var(--input-border)] bg-[var(--input-bg)] p-1',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex-1 rounded-[6px] font-medium transition-colors duration-150',
              size === 'sm' ? 'px-2 py-1 text-[0.75rem]' : 'px-3 py-1.5 text-[0.8125rem]',
              active
                ? 'bg-[var(--color-brand-600)] text-white shadow-sm'
                : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 60,
  label,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  suffix?: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={`Decrease ${label ?? 'value'}`}
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= min}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--input-border)] bg-[var(--input-bg)] text-lg font-medium transition-colors duration-150 hover:bg-[var(--glass-bg-subtle)] disabled:opacity-40"
      >
        −
      </button>
      <div className="relative flex-1">
        <input
          type="number"
          aria-label={label ?? 'Value'}
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
          className="mf-input text-center text-[1.125rem] font-semibold tabular-nums"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.75rem] text-[var(--faint-fg)]">
            {suffix}
          </span>
        )}
      </div>
      <button
        type="button"
        aria-label={`Increase ${label ?? 'value'}`}
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-[var(--input-border)] bg-[var(--input-bg)] text-lg font-medium transition-colors duration-150 hover:bg-[var(--glass-bg-subtle)] disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
