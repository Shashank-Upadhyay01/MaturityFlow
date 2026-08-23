'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { setCashOpeningAction } from '@/actions/admin';
import { Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import { formatPaise } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDMY, formatISODateShort, weekdayShort } from '@/lib/working-days';

type Scenario = 'even' | 'front';

interface Driver {
  caseId: string;
  customerName: string;
  agentName: string;
  cashPaise: string;
  onlinePaise: string;
  committed: boolean;
}

interface Day {
  date: string;
  cashPaise: string;
  onlinePaise: string;
  heads: number;
  openingPaise: string;
  extraCashPaise: string;
  overComfort: boolean;
  drivers: Driver[];
}

interface Runway {
  days: Day[];
  remainingPaise: string;
  cashPaise: string;
  onlinePaise: string;
  extraCashPaise: string;
  peakCashPaise: string;
  peakDate: string | null;
  nextCashPaise: string;
  nextOnlinePaise: string;
  nextDate: string | null;
  beyondPaise: string;
  committedPaise: string;
  pipelinePaise: string;
  liveCases: number;
  topAgentShare: number;
  topAgentName: string | null;
}

export function RunwayBoard(props: {
  even: Runway;
  front: Runway;
  comfortPaise: string;
  cashCapPaise: string;
  todayOpeningPaise: string;
  branchLabel: string;
  branchId: string;
  today: string;
  canSetCash: boolean;
}) {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario>('even');
  const [open, setOpen] = useState<string | null>(null);
  const [drawer, setDrawer] = useState((BigInt(props.todayOpeningPaise) / 100n).toString());
  const plan = scenario === 'even' ? props.even : props.front;
  const other = scenario === 'even' ? props.front : props.even;
  const cols =
    'grid grid-cols-[6.25rem_minmax(3.5rem,1fr)_6.25rem_6.25rem_5.25rem_6.5rem] items-center gap-x-1.5';

  const peakTotal = useMemo(() => {
    let m = 1n;
    for (const d of plan.days) {
      const t = BigInt(d.cashPaise) + BigInt(d.onlinePaise);
      if (t > m) m = t;
    }
    return m;
  }, [plan.days]);

  async function saveDrawer() {
    const r = await setCashOpeningAction(props.branchId, props.today, drawer);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success('Drawer cash saved');
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <Glass className="print:hidden">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="mr-auto min-w-0 pr-2">
            <h1 className="text-[1.125rem] font-semibold leading-tight tracking-[-0.02em]">Cash runway</h1>
            <p className="truncate text-[0.75rem] text-[var(--muted-fg)]">
              {props.branchLabel}
              {plan.liveCases > 0 ? ` · ${plan.liveCases} still owed · next ${plan.days.length} working days` : ''}
            </p>
          </div>
          {plan.liveCases > 0 && (
          <div className="flex rounded-[10px] border border-[var(--input-border)] p-0.5">
            <button
              type="button"
              onClick={() => setScenario('even')}
              className={cn(
                'h-8 rounded-[8px] px-2.5 text-[0.8125rem]',
                scenario === 'even' ? 'bg-[var(--glass-bg-strong)] font-medium' : 'text-[var(--muted-fg)]',
              )}
            >
              Smooth
            </button>
            <button
              type="button"
              onClick={() => setScenario('front')}
              className={cn(
                'h-8 rounded-[8px] px-2.5 text-[0.8125rem]',
                scenario === 'front' ? 'bg-[var(--glass-bg-strong)] font-medium' : 'text-[var(--muted-fg)]',
              )}
            >
              If they queue
            </button>
          </div>
          )}
          <label className="flex items-center gap-2 text-[0.75rem] text-[var(--muted-fg)]">
            Drawer now
            <Input
              value={drawer}
              disabled={!props.canSetCash}
              onChange={(e) => setDrawer(e.target.value)}
              onBlur={() => void saveDrawer()}
              className="!h-9 !w-[8.5rem] !py-1.5 !text-[0.8125rem] !leading-none"
              inputMode="numeric"
            />
          </label>
        </div>
        {plan.liveCases > 0 && (
        <div className="grid gap-px border-t border-[var(--hairline)] sm:grid-cols-3">
          <ActionCell
            label={plan.nextDate ? `Cash to hold · ${weekdayShort(plan.nextDate)} ${formatDMY(plan.nextDate)}` : 'Cash to hold'}
            paise={plan.nextCashPaise}
            hint={`Cap ₹${formatPaise(BigInt(props.cashCapPaise), { decimals: false, symbol: false })} cash per head. Rest NEFT.`}
            tone="money"
          />
          <ActionCell
            label="Online / NEFT that day"
            paise={plan.nextOnlinePaise}
            hint="Keep this much ready to transfer, not in the drawer."
            tone="brand"
          />
          <ActionCell
            label="Extra cash vs drawer / comfort"
            paise={plan.extraCashPaise}
            hint={
              BigInt(plan.extraCashPaise) > 0n
                ? 'Sum of days where cash due beats what you said you will open with.'
                : 'Drawer + daily comfort covers the cash legs.'
            }
            tone={BigInt(plan.extraCashPaise) > 0n ? 'danger' : 'default'}
          />
        </div>
        )}
      </Glass>

      {plan.liveCases === 0 ? (
        <Glass className="px-4 py-8 text-center text-[0.875rem] text-[var(--muted-fg)]">
          Nobody is owed money on the register, so there is nothing to provision.
        </Glass>
      ) : (
        <>
          <p className="text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
            Hold the cash figure in the drawer; send the NEFT figure. Cash per head is capped at ₹
            {formatPaise(BigInt(props.cashCapPaise), { decimals: false, symbol: false })}.
            {plan.topAgentName && plan.topAgentShare >= 25 && (
              <>
                {' '}
                {plan.topAgentName} is {plan.topAgentShare}% of the next five days&apos; cash.
              </>
            )}
            {BigInt(plan.beyondPaise) > 0n && (
              <>
                {' '}
                ₹{formatPaise(BigInt(plan.beyondPaise), { decimals: false, symbol: false })} sits after these 14
                days.
              </>
            )}
          </p>

          <Glass className="overflow-hidden">
            <div className="mf-hscroll">
              <div className="min-w-[44rem] text-[0.8125rem]">
                <div
                  className={cn(
                    cols,
                    'border-b border-[var(--hairline)] px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-fg)]',
                  )}
                >
                  <span>Day</span>
                  <span>Cash vs online</span>
                  <span className="text-right">Cash</span>
                  <span className="text-right">Online</span>
                  <span className="text-right">Customers</span>
                  <span className="text-right">Extra cash</span>
                </div>
                {plan.days.map((d) => {
                  const cash = BigInt(d.cashPaise);
                  const online = BigInt(d.onlinePaise);
                  const extra = BigInt(d.extraCashPaise);
                  const total = cash + online;
                  const cashPct = peakTotal > 0n ? Number((cash * 100n) / peakTotal) : 0;
                  const onlinePct = peakTotal > 0n ? Number((online * 100n) / peakTotal) : 0;
                  const comfortPct = peakTotal > 0n ? Number((BigInt(props.comfortPaise) * 100n) / peakTotal) : 0;
                  const expanded = open === d.date;
                  return (
                    <div key={d.date} className="border-b border-[var(--hairline)] last:border-0">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : d.date)}
                        className={cn(cols, 'w-full px-3 py-2 text-left hover:bg-[var(--glass-bg-subtle)]')}
                      >
                        <span>
                          <span className="block font-medium">{formatISODateShort(d.date)}</span>
                          <span className="text-[0.7rem] text-[var(--faint-fg)]">{weekdayShort(d.date)}</span>
                        </span>
                        <span className="relative h-2 self-center overflow-hidden rounded-full bg-[var(--glass-bg-subtle)]">
                          <span
                            className="absolute inset-y-0 left-0 bg-[var(--color-money-500)]"
                            style={{ width: `${cashPct}%` }}
                          />
                          <span
                            className="absolute inset-y-0 bg-[var(--color-brand-500)]"
                            style={{ left: `${cashPct}%`, width: `${onlinePct}%` }}
                          />
                          <span
                            className="absolute inset-y-[-3px] w-px bg-[var(--faint-fg)]"
                            style={{ left: `${Math.min(100, comfortPct)}%` }}
                            title="Daily cash comfort"
                          />
                        </span>
                        <span className="text-right tabular-nums font-medium">
                          <Money paise={cash} decimals={false} />
                        </span>
                        <span className="text-right tabular-nums text-[var(--muted-fg)]">
                          <Money paise={online} decimals={false} />
                        </span>
                        <span className="text-right tabular-nums text-[var(--muted-fg)]">{d.heads || '—'}</span>
                        <span className="text-right">
                          {extra > 0n ? (
                            <span className="font-semibold tabular-nums text-[var(--color-danger-500)]">
                              <Money paise={extra} decimals={false} />
                            </span>
                          ) : total === 0n ? (
                            <span className="text-[var(--faint-fg)]">—</span>
                          ) : (
                            <span className="text-[var(--color-money-500)]">covered</span>
                          )}
                        </span>
                      </button>
                      {expanded && d.drivers.length > 0 && (
                        <div className="border-t border-[var(--hairline)] bg-[var(--glass-bg-subtle)] px-3 py-2">
                          <p className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-fg)]">
                            Customers this day is for
                          </p>
                          <ul className="space-y-1">
                            {d.drivers.map((dr) => (
                              <li
                                key={dr.caseId + dr.cashPaise}
                                className="flex flex-wrap items-baseline justify-between gap-2 text-[0.8125rem]"
                              >
                                <span>
                                  <span className="font-medium">{dr.customerName}</span>
                                  <span className="text-[var(--faint-fg)]"> · {dr.agentName}</span>
                                  {!dr.committed && (
                                    <span className="ml-1 text-[0.7rem] text-[var(--color-warn-500)]">pending</span>
                                  )}
                                </span>
                                <span className="tabular-nums text-[var(--muted-fg)]">
                                  cash <Money paise={dr.cashPaise} decimals={false} />
                                  {BigInt(dr.onlinePaise) > 0n && (
                                    <>
                                      {' '}
                                      · NEFT <Money paise={dr.onlinePaise} decimals={false} />
                                    </>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="border-t border-[var(--hairline)] px-3 py-2 text-[0.7rem] text-[var(--faint-fg)]">
              Green = cash at the counter. Indigo = online. Customers = how many names that day’s cash is
              for. Extra cash = shortfall after drawer / daily comfort. Click a day for the names.{' '}
              {other.peakDate && scenario === 'even' ? 'Use “If they queue” before a busy week.' : null}
            </p>
          </Glass>
        </>
      )}
    </div>
  );
}

function ActionCell({
  label,
  paise,
  hint,
  tone,
}: {
  label: string;
  paise: string;
  hint: string;
  tone: 'money' | 'brand' | 'danger' | 'default';
}) {
  const color =
    tone === 'money'
      ? 'text-[var(--color-money-500)]'
      : tone === 'brand'
        ? 'text-[var(--color-brand-500)]'
        : tone === 'danger'
          ? 'text-[var(--color-danger-500)]'
          : '';
  return (
    <div className="px-3 py-3">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.06em] text-[var(--faint-fg)]">{label}</p>
      <p className={cn('mt-1 text-[1.35rem] font-semibold tabular-nums tracking-[-0.02em]', color)}>
        <Money paise={paise} decimals={false} />
      </p>
      <p className="mt-1 text-[0.7rem] leading-snug text-[var(--faint-fg)]">{hint}</p>
    </div>
  );
}
