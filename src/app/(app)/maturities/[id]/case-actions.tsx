'use client';

import { Ban, CalendarSync, PauseCircle, PlayCircle, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { cancelCaseAction, rescheduleCaseAction, setHoldAction, submitCaseAction } from '@/actions/cases';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import type { CaseStatus } from '@/db/schema';
import { formatISODate } from '@/lib/working-days';

export function CaseActions({
  caseId,
  status,
  hasPayments,
  permissions,
}: {
  caseId: string;
  status: CaseStatus;
  hasPayments: boolean;
  permissions: { hold: boolean; cancel: boolean; reschedule: boolean; submit: boolean };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<null | 'hold' | 'cancel' | 'reschedule'>(null);
  const [reason, setReason] = useState('');

  const isLive = status === 'APPROVED' || status === 'IN_PROGRESS';
  const canSubmit = permissions.submit && (status === 'DRAFT' || status === 'RETURNED');

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      toast.success(success);
      setPrompt(null);
      setReason('');
      router.refresh();
    } else {
      toast.error(r.error ?? 'Could not complete that');
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canSubmit && (
          <Button
            variant="primary"
            loading={busy}
            onClick={() => run(() => submitCaseAction(caseId), 'Submitted and scheduled')}
          >
            <Send className="h-4 w-4" />
            Submit &amp; schedule
          </Button>
        )}

        {permissions.reschedule && isLive && (
          <Button variant="glass" onClick={() => setPrompt(prompt === 'reschedule' ? null : 'reschedule')}>
            <CalendarSync className="h-4 w-4" />
            Re-plan remaining
          </Button>
        )}

        {permissions.hold && isLive && (
          <Button variant="glass" onClick={() => setPrompt(prompt === 'hold' ? null : 'hold')}>
            <PauseCircle className="h-4 w-4" />
            Put on hold
          </Button>
        )}

        {permissions.hold && status === 'ON_HOLD' && (
          <Button
            variant="success"
            loading={busy}
            onClick={() => run(() => setHoldAction(caseId, false, null), 'Case resumed')}
          >
            <PlayCircle className="h-4 w-4" />
            Resume
          </Button>
        )}

        {permissions.cancel && !hasPayments && status !== 'CANCELLED' && status !== 'COMPLETED' && (
          <Button variant="ghost" onClick={() => setPrompt(prompt === 'cancel' ? null : 'cancel')}>
            <Ban className="h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>

      {prompt && (
        <Glass className="mf-fade w-full max-w-md p-4 text-left">
          <Field
            label={
              prompt === 'hold'
                ? 'Why is this case being held?'
                : prompt === 'cancel'
                  ? 'Why is this case being cancelled?'
                  : 'Why is the remaining amount being re-planned?'
            }
            required
            hint={
              prompt === 'reschedule'
                ? 'Paid instalments are never touched. Only what is still owed is spread over the working days that are left before the promised date.'
                : undefined
            }
          >
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant={prompt === 'cancel' ? 'danger' : 'primary'}
              size="sm"
              loading={busy}
              onClick={() => {
                if (prompt === 'hold') return run(() => setHoldAction(caseId, true, reason), 'Case put on hold');
                if (prompt === 'cancel') return run(() => cancelCaseAction(caseId, reason), 'Case cancelled');
                setBusy(true);
                rescheduleCaseAction(caseId, reason).then((r) => {
                  setBusy(false);
                  if (r.ok && r.data) {
                    if (r.data.slaBreachUnavoidable) {
                      toast.warning('Re-planned, but the promised date cannot be met', {
                        description: 'Escalate this case — the customer needs to be told before they find out at the counter.',
                      });
                    } else {
                      toast.success('Remaining amount re-planned', {
                        description: `${r.data.instalments} instalments, completing ${formatISODate(r.data.lastPayoutOn)}.`,
                      });
                    }
                    setPrompt(null);
                    setReason('');
                    router.refresh();
                  } else if (!r.ok) {
                    toast.error(r.error);
                  }
                });
              }}
            >
              Confirm
            </Button>
          </div>
        </Glass>
      )}
    </div>
  );
}
