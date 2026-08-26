'use client';

import { motion } from 'framer-motion';

import type { CaseEventType, Role } from '@/db/schema';
import { ROLE_SHORT, activeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';

const DOT: Partial<Record<CaseEventType, string>> = {
  CREATED: 'bg-[#94a3b8]',
  SUBMITTED: 'bg-[var(--color-info-500)]',
  RETURNED: 'bg-[var(--color-warn-500)]',
  APPROVED: 'bg-[var(--color-money-500)]',
  REJECTED: 'bg-[var(--color-danger-500)]',
  SCHEDULE_GENERATED: 'bg-[var(--color-brand-500)]',
  RESCHEDULED: 'bg-[var(--color-warn-500)]',
  PAYMENT_RECORDED: 'bg-[var(--color-money-500)]',
  PAYMENT_REVERSED: 'bg-[var(--color-danger-500)]',
  PUT_ON_HOLD: 'bg-[var(--color-warn-600)]',
  RESUMED: 'bg-[var(--color-brand-400)]',
  COMPLETED: 'bg-[var(--color-money-600)]',
  CANCELLED: 'bg-[#64748b]',
};

const LABEL: Record<string, string> = {
  CREATED: 'Case created',
  SUBMITTED: 'Maturity form submitted',
  PICKED_UP: 'Picked up for review',
  RETURNED: 'Returned for correction',
  APPROVED: 'Approved — money became payable',
  REJECTED: 'Rejected',
  SCHEDULE_GENERATED: 'Payout schedule generated',
  SCHEDULE_OVERRIDDEN: 'Schedule overridden',
  RESCHEDULED: 'Remaining amount re-planned',
  PAYMENT_RECORDED: 'Payout recorded',
  PAYMENT_REVERSED: 'Payout reversed',
  PUT_ON_HOLD: 'Put on hold',
  RESUMED: 'Resumed',
  COMPLETED: 'Fully paid',
  CANCELLED: 'Cancelled',
  DOCUMENT_UPLOADED: 'Document uploaded',
  DOCUMENT_VERIFIED: 'Document verified',
  NOTE_ADDED: 'Note added',
  EDITED: 'Edited',
};

export interface TimelineEvent {
  e: { id: string; type: CaseEventType; note: string | null; at: string };
  actor: { name: string; role: Role } | null;
}

export function CaseTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-[0.875rem] text-[var(--muted-fg)]">Nothing recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-4 pl-5">
      <span
        className="absolute left-[5px] top-2 h-[calc(100%-1rem)] w-px bg-[var(--hairline)]"
        aria-hidden
      />
      {events.map((ev, i) => (
        <motion.li
          key={ev.e.id}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <span
            className={cn(
              'absolute -left-5 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-[var(--page-bg)]',
              DOT[ev.e.type] ?? 'bg-[var(--faint-fg)]',
            )}
            aria-hidden
          />
          <p className="text-[0.875rem] font-medium">{LABEL[ev.e.type] ?? ev.e.type}</p>
          {ev.e.note && (
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">{ev.e.note}</p>
          )}
          <p className="mt-0.5 text-[0.75rem] text-[var(--faint-fg)]">
            {new Date(ev.e.at).toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            })}
            {ev.actor && ` · ${ev.actor.name} (${ROLE_SHORT[activeRole(ev.actor.role)]})`}
          </p>
        </motion.li>
      ))}
    </ol>
  );
}
