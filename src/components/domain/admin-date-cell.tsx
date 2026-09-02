'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { setInstalmentDueOnAction } from '@/actions/cases';
import { setPayoutValueDateAction } from '@/actions/payouts';
import { cn } from '@/lib/utils';

export function AdminDateCell({
  kind,
  id,
  value,
  ariaLabel,
  className,
}: {
  kind: 'instalment' | 'payout';
  id: string;
  value: string;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    if (!draft || draft === value) {
      setDraft(value);
      return;
    }
    setBusy(true);
    const result = kind === 'instalment'
      ? await setInstalmentDueOnAction(id, draft)
      : await setPayoutValueDateAction(id, draft);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? 'Could not save the date.');
      setDraft(value);
      return;
    }
    toast.success('Date saved');
  }

  return (
    <input
      type="date"
      aria-label={ariaLabel}
      value={draft}
      disabled={busy}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          (event.currentTarget as HTMLInputElement).blur();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(
        'h-8 rounded-[8px] border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 text-[0.78rem] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-[var(--color-brand-500)] disabled:opacity-70',
        className,
      )}
    />
  );
}
