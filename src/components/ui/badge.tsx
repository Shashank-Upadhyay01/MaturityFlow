import type { ReactNode } from 'react';
import type { CaseStatus, InstalmentStatus } from '@/db/schema';
import { cn } from '@/lib/utils';

export function Badge({
  children,
  tone = 'neutral',
  className,
  dot,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'money' | 'warn' | 'danger' | 'info';
  className?: string;
  dot?: string;
}) {
  const tones = {
    neutral: 'bg-[var(--glass-bg-subtle)] text-[var(--muted-fg)] border-[var(--hairline)]',
    brand: 'bg-[color-mix(in_oklab,var(--color-brand-500)_14%,transparent)] text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)] border-[color-mix(in_oklab,var(--color-brand-500)_26%,transparent)]',
    money: 'bg-[color-mix(in_oklab,var(--color-money-500)_14%,transparent)] text-[var(--color-money-700)] dark:text-[var(--color-money-400)] border-[color-mix(in_oklab,var(--color-money-500)_26%,transparent)]',
    warn: 'bg-[color-mix(in_oklab,var(--color-warn-500)_16%,transparent)] text-[var(--color-warn-600)] dark:text-[var(--color-warn-400)] border-[color-mix(in_oklab,var(--color-warn-500)_28%,transparent)]',
    danger: 'bg-[color-mix(in_oklab,var(--color-danger-500)_14%,transparent)] text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)] border-[color-mix(in_oklab,var(--color-danger-500)_26%,transparent)]',
    info: 'bg-[color-mix(in_oklab,var(--color-info-500)_14%,transparent)] text-[var(--color-info-500)] border-[color-mix(in_oklab,var(--color-info-500)_26%,transparent)]',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px]',
        'text-[0.6875rem] font-semibold tracking-wide',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('status-dot', dot)} />}
      {children}
    </span>
  );
}

const CASE_STATUS_META: Record<
  CaseStatus,
  { label: string; tone: Parameters<typeof Badge>[0]['tone']; dot: string }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral', dot: 'status-draft' },
  SUBMITTED: { label: 'Submitted', tone: 'info', dot: 'status-submitted' },
  UNDER_REVIEW: { label: 'Under review', tone: 'brand', dot: 'status-review' },
  RETURNED: { label: 'Returned', tone: 'warn', dot: 'status-returned' },
  APPROVED: { label: 'Approved', tone: 'money', dot: 'status-approved' },
  IN_PROGRESS: { label: 'Paying out', tone: 'brand', dot: 'status-progress' },
  COMPLETED: { label: 'Completed', tone: 'money', dot: 'status-completed' },
  REJECTED: { label: 'Rejected', tone: 'danger', dot: 'status-rejected' },
  ON_HOLD: { label: 'On hold', tone: 'warn', dot: 'status-hold' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', dot: 'status-cancelled' },
};

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  const m = CASE_STATUS_META[status];
  return (
    <Badge tone={m.tone} dot={m.dot}>
      {m.label}
    </Badge>
  );
}

export const CASE_STATUS_LABEL = Object.fromEntries(
  Object.entries(CASE_STATUS_META).map(([k, v]) => [k, v.label]),
) as Record<CaseStatus, string>;

const INSTALMENT_META: Record<
  InstalmentStatus,
  { label: string; tone: Parameters<typeof Badge>[0]['tone'] }
> = {
  PENDING: { label: 'Pending', tone: 'neutral' },
  PARTIAL: { label: 'Part paid', tone: 'warn' },
  PAID: { label: 'Paid', tone: 'money' },
  MISSED: { label: 'Missed', tone: 'danger' },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function InstalmentStatusBadge({ status }: { status: InstalmentStatus }) {
  const m = INSTALMENT_META[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export const INSTALMENT_STATUS_LABEL = Object.fromEntries(
  Object.entries(INSTALMENT_META).map(([k, v]) => [k, v.label]),
) as Record<InstalmentStatus, string>;
