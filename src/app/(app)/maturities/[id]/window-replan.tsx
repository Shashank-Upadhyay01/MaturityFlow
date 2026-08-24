'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { replanWithWindowAction } from '@/actions/cases';
import {
  SchedulePreview,
  type CalendarSnapshot,
} from '@/components/domain/schedule-preview';
import { Button } from '@/components/ui/button';
import { Stepper } from '@/components/ui/field';
import { Money } from '@/components/ui/money';
import type { CashPolicy, CashPolicyKind, Distribution } from '@/lib/payout-engine';

export function WindowReplan({
  caseId,
  remainingPaise,
  currentDays,
  roundingPaise,
  distribution,
  cashKind,
  cashCapPaise,
  calendar,
  today,
  canApply,
}: {
  caseId: string;
  remainingPaise: string;
  currentDays: number;
  roundingPaise: string;
  distribution: Distribution;
  cashKind: CashPolicyKind;
  cashCapPaise: string;
  calendar: CalendarSnapshot;
  today: string;
  canApply: boolean;
}) {
  const router = useRouter();
  const remaining = BigInt(remainingPaise);
  const cashPolicy: CashPolicy =
    cashKind === 'CASH_CAP'
      ? { kind: 'CASH_CAP', cashCapPerDayPaise: BigInt(cashCapPaise) }
      : { kind: cashKind };
  const [days, setDays] = useState(currentDays);
  const [busy, setBusy] = useState(false);
  if (remaining <= 0n) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="space-y-4 rounded-[15px] border border-[var(--input-border)] p-4">
        <div>
          <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--faint-fg)]">
            Still to withdraw
          </p>
          <p className="mt-1 text-[1.5rem] font-semibold leading-none tracking-[-0.02em]">
            <Money paise={remaining} />
          </p>
        </div>
        <div>
          <p className="mb-2 text-[0.8125rem] font-medium text-[var(--muted-fg)]">
            Withdraw over how many working days?
          </p>
          <Stepper value={days} onChange={setDays} min={1} max={60} label="working days" suffix="days" />
        </div>
        {canApply && (
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await replanWithWindowAction(
                caseId,
                days,
                `Withdrawal window set to ${days} working days`,
              );
              setBusy(false);
              if (r.ok && r.data) {
                toast.success(`Re-planned over ${r.data.windowDays} working days`, {
                  description: `${r.data.instalments} instalments, last day ${r.data.lastPayoutOn}.`,
                });
                router.refresh();
              } else if (!r.ok) toast.error(r.error);
            }}
          >
            Apply this plan
          </Button>
        )}
        <p className="text-[0.75rem] leading-relaxed text-[var(--faint-fg)]">
          Changing the day count rebuilds only unpaid days. Already-paid amounts stay as they are.
        </p>
      </div>
      <SchedulePreview
        compact
        title="Recommended daily withdrawal"
        input={{
          totalPaise: remaining,
          days,
          roundingPaise: BigInt(roundingPaise),
          startDate: today,
          distribution,
          cashPolicy,
          startOnNextWorkingDay: false,
          calendar,
        }}
      />
    </div>
  );
}
