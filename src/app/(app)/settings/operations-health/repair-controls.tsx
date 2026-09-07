'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';

import { reconcileCaseLedgerAction } from '@/actions/operations-health';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';

export function RefreshHealthButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button type="button" variant="outline" loading={pending} onClick={() => startTransition(() => router.refresh())}>
      {!pending && <RefreshCw className="h-4 w-4" aria-hidden />}
      Check again
    </Button>
  );
}

export function ReconcileCaseForm({ caseId, caseNumber }: { caseId: string; caseNumber: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [pending, startTransition] = useTransition();
  const reasonLength = reason.trim().length;
  const reasonError = touched && (reasonLength < 10 || reasonLength > 1000)
    ? 'Explain the reconciliation in 10–1000 characters, excluding surrounding spaces.'
    : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completed) return;
    setTouched(true);
    setError(null);
    if (reasonLength < 10 || reasonLength > 1000) return;

    startTransition(async () => {
      try {
        const result = await reconcileCaseLedgerAction(caseId, reason.trim());
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setCompleted(true);
        toast.success(result.data.changed
          ? `${caseNumber}: paid totals reconciled and recorded in the audit log.`
          : `${caseNumber}: totals already match. No repair was needed.`);
        router.refresh();
      } catch {
        setError('The result could not be confirmed. Check again before retrying this reconciliation.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={`Reconcile ${caseNumber}`}>
      <Field
        label="Reason for reconciliation"
        required
        error={reasonError}
        hint={`${reasonLength}/1000 characters. Record what you checked and why these paid totals need to be reconciled. At least 10 characters; saved in the audit log.`}
      >
        <Textarea
          name="reason"
          value={reason}
          onChange={(event) => { setReason(event.target.value); setError(null); }}
          onBlur={() => setTouched(true)}
          required
          minLength={10}
          maxLength={1000}
          disabled={pending || completed}
          aria-invalid={Boolean(reasonError)}
          placeholder="Describe the receipts you checked and the discrepancy."
        />
      </Field>
      {error && <p role="alert" className="text-[0.8125rem] text-[var(--color-danger-500)]">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={pending} disabled={completed}>
          {completed ? 'Reconciliation complete' : 'Reconcile paid totals'}
        </Button>
        <p className="text-[0.75rem] text-[var(--faint-fg)]">
          The server checks the latest receipts again before applying the repair.
        </p>
      </div>
      {completed && <p role="status" className="text-[0.8125rem] text-[var(--muted-fg)]">Refreshing the health check…</p>}
    </form>
  );
}
