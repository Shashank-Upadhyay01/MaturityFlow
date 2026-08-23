'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  CalendarClock,
  Check,
  ChevronDown,
  CornerUpLeft,
  Phone,
  User,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { approveCaseAction, rejectCaseAction, returnCaseAction } from '@/actions/cases';
import { SchedulePreview, type CalendarSnapshot } from '@/components/domain/schedule-preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, SegmentedControl, Stepper, Textarea } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Callout, KeyValue } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { ROUNDING_STEPS, tryParseRupeesToPaise } from '@/lib/money';
import type { CashPolicy, Distribution } from '@/lib/payout-engine';
import { cn } from '@/lib/utils';
import { daysBetween, formatISODate } from '@/lib/working-days';

export interface QueueCase {
  id: string;
  caseNumber: string;
  status: string;
  maturityAmountPaise: string;
  formSubmittedOn: string;
  submittedAt: string | null;
  windowDays: number;
  roundingPaise: string;
  distribution: Distribution;
  cashPolicy: CashPolicy['kind'];
  cashCapPerDayPaise: string | null;
  startOnNextWorkingDay: boolean;
  customerName: string;
  customerPhone: string | null;
  agentName: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  returnReason: string | null;
  notes: string | null;
}

export function ApprovalQueue({
  cases,
  calendars,
  today,
  canOverride,
}: {
  cases: QueueCase[];
  calendars: Record<string, CalendarSnapshot>;
  today: string;
  canOverride: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(cases[0]?.id ?? null);

  return (
    <div className="space-y-3">
      {cases.map((c, idx) => {
        const waited = daysBetween(c.formSubmittedOn, today);
        const open = openId === c.id;
        return (
          <Glass
            key={c.id}
            className={cn('mf-rise overflow-hidden', open && 'shadow-[var(--glass-shadow-lifted)]')}
            style={{ animationDelay: `${Math.min(idx * 40, 320)}ms` }}
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : c.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--glass-bg-subtle)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.caseNumber}</span>
                  <Badge tone="neutral">{c.branchCode}</Badge>
                  {waited >= 3 && (
                    <Badge tone={waited >= 7 ? 'danger' : 'warn'}>
                      waiting {waited} day{waited === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {c.returnReason && <Badge tone="warn">was returned</Badge>}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-[var(--muted-fg)]">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" />
                    {c.customerName}
                  </span>
                  {c.customerPhone && (
                    <span className="flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" />
                      {c.customerPhone}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5" />
                    submitted {formatISODate(c.formSubmittedOn)}
                  </span>
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[1.125rem] font-semibold tabular-nums">
                  <Money paise={c.maturityAmountPaise} compact />
                </p>
                <p className="text-[0.75rem] text-[var(--faint-fg)]">
                  over {c.windowDays} working days
                </p>
              </div>

              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-[var(--faint-fg)] transition-transform duration-300',
                  open && 'rotate-180',
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden border-t"
                >
                  <ApprovalPanel
                    c={c}
                    calendar={
                      calendars[c.branchId] ?? {
                        holidays: [],
                        sundaysOff: true,
                        saturdayRule: 'SECOND_FOURTH',
                      }
                    }
                    today={today}
                    canOverride={canOverride}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </Glass>
        );
      })}
    </div>
  );
}

function ApprovalPanel({
  c,
  calendar,
  today,
  canOverride,
}: {
  c: QueueCase;
  calendar: CalendarSnapshot;
  today: string;
  canOverride: boolean;
}) {
  const router = useRouter();
  const [approvedOn, setApprovedOn] = useState(today);
  const [days, setDays] = useState(c.windowDays);
  const [roundingPaise, setRoundingPaise] = useState(BigInt(c.roundingPaise));
  const [distribution, setDistribution] = useState<Distribution>(c.distribution);
  const [cashMode, setCashMode] = useState<CashPolicy['kind']>(c.cashPolicy);
  const [cashCap, setCashCap] = useState(
    c.cashCapPerDayPaise ? (BigInt(c.cashCapPerDayPaise) / 100n).toString() : '20000',
  );
  const [startNext, setStartNext] = useState(c.startOnNextWorkingDay);
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'approve' | 'return' | 'reject'>('approve');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [state, formAction, pending] = useActionState(approveCaseAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(`${state.data.caseNumber} approved`, {
        description: `${state.data.instalments} instalments, completing ${formatISODate(state.data.lastPayoutOn)}.`,
      });
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const cashCapPaise = tryParseRupeesToPaise(cashCap || '0') ?? 0n;
  const cashPolicy: CashPolicy =
    cashMode === 'CASH_CAP' ? { kind: 'CASH_CAP', cashCapPerDayPaise: cashCapPaise } : { kind: cashMode };

  const lag = daysBetween(c.formSubmittedOn, approvedOn);

  async function doReturn() {
    if (!reason.trim()) return toast.error('Say what needs correcting.');
    setBusy(true);
    const r = await returnCaseAction(c.id, reason);
    setBusy(false);
    if (r.ok) {
      toast.success('Returned to the agent');
      router.refresh();
    } else toast.error(r.error);
  }

  async function doReject() {
    if (!reason.trim()) return toast.error('A reason is required to reject.');
    setBusy(true);
    const r = await rejectCaseAction(c.id, reason);
    setBusy(false);
    if (r.ok) {
      toast.success('Case rejected');
      router.refresh();
    } else toast.error(r.error);
  }

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KeyValue label="Agent">{c.agentName}</KeyValue>
          <KeyValue label="Branch">{c.branchName}</KeyValue>
          <KeyValue label="Amount">
            <Money paise={c.maturityAmountPaise} />
          </KeyValue>
          <KeyValue label="Submitted">{formatISODate(c.formSubmittedOn)}</KeyValue>
        </div>

        {c.notes && (
          <Callout tone="info" title="Agent's note">
            {c.notes}
          </Callout>
        )}
        {c.returnReason && (
          <Callout tone="warn" title="Previously returned for">
            {c.returnReason}
          </Callout>
        )}

        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          options={[
            { value: 'approve', label: 'Approve' },
            { value: 'return', label: 'Return for correction' },
            { value: 'reject', label: 'Reject' },
          ]}
        />

        {mode === 'approve' ? (
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="caseId" value={c.id} />
            <input type="hidden" name="roundingPaise" value={roundingPaise.toString()} />
            <input type="hidden" name="distribution" value={distribution} />
            <input type="hidden" name="cashPolicy" value={cashMode} />
            <input type="hidden" name="windowDays" value={days} />
            <input type="hidden" name="startOnNextWorkingDay" value={startNext ? 'on' : ''} />
            {cashMode === 'CASH_CAP' && <input type="hidden" name="cashCapPerDay" value={cashCap} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Approval date"
                required
                hint={
                  lag === 0
                    ? 'Approving today — the payout clock starts now.'
                    : `${lag} day${lag === 1 ? '' : 's'} after submission. The clock starts on this date, not the submission date.`
                }
              >
                <Input
                  name="approvedOn"
                  type="date"
                  value={approvedOn}
                  min={c.formSubmittedOn}
                  max={today}
                  onChange={(e) => setApprovedOn(e.target.value)}
                  required
                />
              </Field>

              <Field label="Give the full amount within">
                <Stepper value={days} onChange={setDays} min={1} max={60} suffix="working days" />
              </Field>
            </div>

            <Field label="Round each day's payout to">
              <SegmentedControl
                value={roundingPaise.toString()}
                onChange={(v) => setRoundingPaise(BigInt(v))}
                options={ROUNDING_STEPS.map((s) => ({ value: s.paise.toString(), label: s.label }))}
                size="sm"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Handed over as">
                <SegmentedControl
                  value={cashMode}
                  onChange={(v) => setCashMode(v as CashPolicy['kind'])}
                  options={[
                    { value: 'CASH_ONLY', label: 'Cash' },
                    { value: 'CASH_CAP', label: 'Cash + online' },
                    { value: 'ONLINE_ONLY', label: 'Online' },
                  ]}
                  size="sm"
                />
              </Field>
              {cashMode === 'CASH_CAP' && (
                <Field label="Maximum cash per day">
                  <MoneyInput value={cashCap} onChange={(e) => setCashCap(e.target.value)} />
                </Field>
              )}
            </div>

            {canOverride && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Heavier days sit">
                  <SegmentedControl
                    value={distribution}
                    onChange={(v) => setDistribution(v as Distribution)}
                    options={[
                      { value: 'FRONT_LOADED', label: 'Early' },
                      { value: 'EVEN', label: 'Spread' },
                      { value: 'BACK_LOADED', label: 'Late' },
                    ]}
                    size="sm"
                  />
                </Field>
                <Field label="First payout">
                  <SegmentedControl
                    value={startNext ? 'next' : 'same'}
                    onChange={(v) => setStartNext(v === 'next')}
                    options={[
                      { value: 'same', label: 'Approval day' },
                      { value: 'next', label: 'Next working day' },
                    ]}
                    size="sm"
                  />
                </Field>
              </div>
            )}

            <Field label="Approval note">
              <Textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional — recorded in the audit trail"
              />
            </Field>

            <div className="flex items-center gap-3">
              <Button type="submit" variant="success" loading={pending}>
                <Check className="h-4 w-4" />
                Approve &amp; generate schedule
              </Button>
              <p className="text-[0.75rem] text-[var(--muted-fg)]">
                The schedule on the right is committed exactly as shown.
              </p>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <Field
              label={mode === 'return' ? 'What needs correcting?' : 'Why is this being rejected?'}
              required
            >
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  mode === 'return'
                    ? 'e.g. PAN copy not attached; signature mismatch on the discharge receipt'
                    : 'e.g. instrument already encashed'
                }
              />
            </Field>
            {mode === 'return' ? (
              <Button variant="glass" loading={busy} onClick={doReturn}>
                <CornerUpLeft className="h-4 w-4" />
                Return to agent
              </Button>
            ) : (
              <Button variant="danger" loading={busy} onClick={doReject}>
                <X className="h-4 w-4" />
                Reject case
              </Button>
            )}
          </div>
        )}
      </div>

      <div>
        <SchedulePreview
          compact
          title="What approving commits to"
          input={{
            totalPaise: BigInt(c.maturityAmountPaise),
            days,
            roundingPaise,
            startDate: approvedOn,
            distribution,
            cashPolicy,
            startOnNextWorkingDay: startNext,
            calendar,
            policyMaxDays: 15,
          }}
        />
      </div>
    </div>
  );
}
