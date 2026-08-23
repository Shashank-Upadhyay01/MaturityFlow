import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="mf-hscroll -mx-5 sm:-mx-6">
      <table className={cn('w-full border-collapse text-[0.875rem]', className)}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)] first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className,
  highlight,
}: {
  children: ReactNode;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <tr
      className={cn(
        'border-b border-[var(--hairline)] transition-colors duration-200 last:border-0',
        'hover:bg-[var(--glass-bg-subtle)]',
        highlight && 'bg-[color-mix(in_oklab,var(--color-brand-500)_7%,transparent)]',
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align = 'left',
  className,
  colSpan,
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        'px-3 py-2.5 align-middle first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {children}
    </td>
  );
}
