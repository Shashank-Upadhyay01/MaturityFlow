'use client';

import { Banknote, Check, ChevronDown, Landmark, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { recordPayoutAction } from '@/actions/payouts';
import { Badge, InstalmentStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { Progress } from '@/components/ui/progress';
import { formatPaise, percentOf } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatISODate } from '@/lib/working-days';
import type { InstalmentStatus } from '@/db/schema';

export interface DueRow {
  instalmentId: string;
  seq: number;
  dueOn: string;
  amountPaise: string;
  cashLegPaise: string;
  onlineLegPaise: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  status: InstalmentStatus;
  isFinal: boolean;
  caseId: string;
  caseNumber: string;
  maturityAmountPaise: string;
  casePaidCashPaise: string;
  casePaidOnlinePaise: string;
  deadlineOn: string | null;
  branchId: string;
}

export function PayoutDesk({ rows, date, today }: { rows: DueRow[]; date: string; today: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {rows.map((r, idx) => {
        const amount = BigInt(r.amountPaise);
        const paid = BigInt(r.paidCashPaise) + BigInt(r.paidOnlinePaise);
        const outstanding = amount - paid;
        const casePaid = BigInt(r.casePaidCashPaise) + BigInt(r.casePaidOnlinePaise);
        const caseTotal = BigInt(r.maturityAmountPaise);
        const open = openId === r.instalmentId;
        const late = r.dueOn < today;

        return (
          <Glass
            key={r.instalmentId}
            className={cn('mf-rise overflow-hidden', open && 'shadow-[var(--glass-shadow-lifted)]')}
            style={{ animationDelay: `${Math.min(idx * 35, 300)}ms` }}
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : r.instalmentId)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--glass-bg-subtle)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.caseNumber}</span>
                  <Badge tone="neutral">day {r.seq}</Badge>
                  {r.isFinal && <Badge tone="brand">final instalment</Badge>}
                  {late && <Badge tone="danger">overdue since {formatISODate(r.dueOn)}</Badge>}
                  <InstalmentStatusBadge status={r.status} />
                </div>
                <div className="mt-2 flex max-w-md items-center gap-3">
                  <Progress
                    value={percentOf(casePaid, caseTotal)}
                    height="sm"
                    tone={casePaid >= caseTotal ? 'money' : 'brand'}
                    className="flex-1"
                  />
                  <span className="shrink-0 text-[0.75rem] tabular-nums text-[var(--muted-fg)]">
                    <Money paise={casePaid} compact /> of <Money paise={caseTotal} compact />
                  </span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[1.125rem] font-semibold tabular-nums">
                  <Money paise={outstanding} />
                </p>
                <p className="text-[0.75rem] text-[var(--faint-fg)]">
                  {BigInt(r.cashLegPaise) > 0n && (
                    <>cash {formatPaise(BigInt(r.cashLegPaise), { decimals: false })}</>
                  )}
                  {BigInt(r.cashLegPaise) > 0n && BigInt(r.onlineLegPaise) > 0n && ' · '}
                  {BigInt(r.onlineLegPaise) > 0n && (
                    <>online {formatPaise(BigInt(r.onlineLegPaise), { decimals: false })}</>
                  )}
                </p>
              </div>

              <ChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-[var(--faint-fg)] transition-transform duration-300',
                  open && 'rotate-180',
                )}
              />
            </button>

            <div
              className="grid transition-[grid-template-rows,opacity] duration-[320ms] [transition-timing-function:var(--ease-out-quint)]"
              style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
            >
              <div className="min-h-0 overflow-hidden">
                {open && (
                  <div className="border-t">
                    <PayoutForm row={r} valueDate={date} onDone={() => setOpenId(null)} />
                  </div>
                )}
              </div>
            </div>
          </Glass>
        );
      })}
    </div>
  );
}

function PayoutForm({
  row,
  valueDate,
  onDone,
}: {
  row: DueRow;
  valueDate: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const amount = BigInt(row.amountPaise);
  const paid = BigInt(row.paidCashPaise) + BigInt(row.paidOnlinePaise);
  const outstanding = amount - paid;
  const cashDue = maxi(BigInt(row.cashLegPaise) - BigInt(row.paidCashPaise), 0n);
  const onlineDue = maxi(BigInt(row.onlineLegPaise) - BigInt(row.paidOnlinePaise), 0n);

  const [cash, setCash] = useState(rupeeString(cashDue));
  const [online, setOnline] = useState(rupeeString(onlineDue));
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');

  const [state, formAction, pending] = useActionState(recordPayoutAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(
        state.data.caseCompleted ? 'Fully paid — case completed' : 'Payout recorded',
        {
          description: `${formatPaise(BigInt(state.data.remainingPaise))} remaining on this case.`,
        },
      );
      onDone();
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const entered =
    (parseLoose(cash) ?? 0n) + (parseLoose(online) ?? 0n);
  const over = entered > outstanding;

  return (
    <form action={formAction} className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <input type="hidden" name="instalmentId" value={row.instalmentId} />
      <input type="hidden" name="valueDate" value={valueDate} />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Banknote className="h-3.5 w-3.5 text-[var(--color-money-500)]" /> Cash handed over
              </span>
            }
            hint={cashDue > 0n ? `Planned: ${formatPaise(cashDue, { decimals: false })}` : 'No cash planned today'}
          >
            <MoneyInput name="cash" value={cash} onChange={(e) => setCash(e.target.value)} />
          </Field>

          <Field
            label={
              <span className="flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5 text-[var(--color-brand-500)]" /> Online transfer
              </span>
            }
            hint={onlineDue > 0n ? `Planned: ${formatPaise(onlineDue, { decimals: false })}` : 'No transfer planned today'}
          >
            <MoneyInput name="online" value={online} onChange={(e) => setOnline(e.target.value)} />
          </Field>
        </div>

        {(parseLoose(online) ?? 0n) > 0n && (
          <Field label="UTR / transaction reference" required hint="Mandatory for any online leg — the database will refuse the entry without it.">
            <Input
              name="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR123456789012"
              required
            />
          </Field>
        )}

        <Field label="Remarks">
          <Input
            name="remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="success" loading={pending} disabled={entered <= 0n}>
            <Check className="h-4 w-4" />
            Record payout
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCash(rupeeString(cashDue));
              setOnline(rupeeString(onlineDue));
            }}
          >
            Reset to plan
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/maturities/${row.caseId}`}>Open case</Link>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-[15px] border border-[var(--input-border)] bg-[var(--glass-bg-subtle)] p-4">
          <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">
            Outstanding on day {row.seq}
          </p>
          <p className="mt-1 text-[1.375rem] font-semibold tabular-nums">
            <Money paise={outstanding} />
          </p>
          <div className="mt-3 space-y-1.5 border-t pt-3 text-[0.8125rem]">
            <Line label="Entering now" value={<Money paise={entered} />} />
            <Line
              label="Left after this"
              value={<Money paise={maxi(outstanding - entered, 0n)} />}
            />
          </div>
        </div>

        {over && (
          <div className="rounded-[13px] border border-[color-mix(in_oklab,var(--color-warn-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-500)_11%,transparent)] px-3.5 py-2.5 text-[0.8125rem] leading-relaxed">
            This is more than today&apos;s planned amount. Only an Operations Head can authorise
            paying ahead of schedule — and never more than the maturity total.
          </div>
        )}

        {row.deadlineOn && (
          <p className="flex items-start gap-2 px-1 text-[0.75rem] leading-relaxed text-[var(--faint-fg)]">
            <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Promised in full by {formatISODate(row.deadlineOn)}.
          </p>
        )}
      </div>
    </form>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="text-[var(--muted-fg)]">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </p>
  );
}

function maxi(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function rupeeString(p: bigint): string {
  if (p <= 0n) return '';
  const whole = p / 100n;
  const frac = p % 100n;
  return frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, '0')}`;
}
function parseLoose(s: string): bigint | null {
  const t = s.replace(/[₹,\s]/g, '');
  if (!t || !/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return BigInt(w) * 100n + BigInt((f + '00').slice(0, 2));
}
