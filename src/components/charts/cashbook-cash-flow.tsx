'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { cashFlowDomain, cashFlowSeries } from '@/lib/daily-cashbook';
import { formatCompactPaise, formatPaise, paiseToRupeeNumber } from '@/lib/money';

interface CashbookCashFlowProps {
  openingBalancePaise: bigint;
  oldPortalTotalPaise: bigint;
  newLoanPaise: bigint;
  savingsDepositPaise: bigint;
  byAccountPaise: bigint;
  withdrawalsPaise: bigint;
  expensesPaise: bigint;
  expectedPhysicalCashPaise: bigint;
  countedCashPaise: bigint;
  cashDifferencePaise: bigint;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function CashbookCashFlow({
  openingBalancePaise,
  oldPortalTotalPaise,
  newLoanPaise,
  savingsDepositPaise,
  byAccountPaise,
  withdrawalsPaise,
  expensesPaise,
  expectedPhysicalCashPaise,
  countedCashPaise,
  cashDifferencePaise,
}: CashbookCashFlowProps) {
  const gradientId = `cash-flow-${useId().replaceAll(':', '')}`;
  const reducedMotion = useReducedMotion();
  const points = useMemo(
    () =>
      cashFlowSeries({
        openingBalancePaise,
        oldPortalTotalPaise,
        newLoanPaise,
        savingsDepositPaise,
        byAccountPaise,
        withdrawalsPaise,
        expensesPaise,
        expectedPhysicalCashPaise,
      }).map((item) => ({ ...item, value: paiseToRupeeNumber(item.valuePaise) })),
    [byAccountPaise, expensesPaise, expectedPhysicalCashPaise, newLoanPaise, oldPortalTotalPaise, openingBalancePaise, savingsDepositPaise, withdrawalsPaise],
  );

  // Range comes from cashFlowDomain(), never from Recharts — see the note on that function.
  const yDomain = useMemo(() => cashFlowDomain(points, countedCashPaise), [countedCashPaise, points]);

  const hasCashData = points.some((item) => item.valuePaise !== 0n) || countedCashPaise !== 0n;
  const differenceTone = cashDifferencePaise < 0n
    ? 'text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]'
    : cashDifferencePaise > 0n
      ? 'text-[var(--color-warn-700)] dark:text-[var(--color-warn-400)]'
      : 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        {/* The plot is taken OUT OF FLOW on purpose. ResponsiveContainer measures its
            parent and writes a pixel height back into it; in flow, inside an auto-height
            grid row, that measurement grows the row, which grows the parent, which the
            observer measures again — the panel stretches down the page forever. Pinned to
            inset-0 the plot reads a definite box and can never feed its own height back. */}
        <div className="absolute inset-0 px-1 pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart accessibilityLayer data={points} margin={{ top: 14, right: 10, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-money-500)" stopOpacity={0.44} />
                  <stop offset="100%" stopColor="var(--color-money-500)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--hairline)" vertical={false} />
              <XAxis dataKey="shortLabel" axisLine={false} tickLine={false} minTickGap={8} interval="preserveStartEnd" tick={{ fontSize: 9, fontWeight: 600, fill: 'var(--faint-fg)' }} />
              <YAxis domain={yDomain} allowDataOverflow={false} allowDecimals={false} axisLine={false} tickLine={false} width={56} tick={{ fontSize: 9, fill: 'var(--faint-fg)' }} tickFormatter={(value: number) => formatCompactPaise(BigInt(Math.round(value * 100)))} />
              <Tooltip
                cursor={{ stroke: 'var(--color-brand-500)', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0].payload as (typeof points)[number];
                  return (
                    <div className="rounded-[10px] border px-2.5 py-2 text-[0.7rem] shadow-xl" style={{ background: 'var(--surface-solid)' }}>
                      <p className="font-bold">{item.label}</p>
                      <p className="mt-1 flex justify-between gap-4 text-[var(--muted-fg)]"><span>Cash position</span><span className="font-bold tabular-nums text-[var(--page-fg)]">{formatPaise(item.valuePaise, { decimals: false })}</span></p>
                      {item.deltaPaise !== 0n && <p className="flex justify-between gap-4 text-[var(--muted-fg)]"><span>Movement</span><span className="font-semibold tabular-nums">{item.deltaPaise > 0n ? '+' : ''}{formatPaise(item.deltaPaise, { decimals: false })}</span></p>}
                    </div>
                  );
                }}
              />
              <ReferenceLine y={paiseToRupeeNumber(countedCashPaise)} stroke="var(--color-brand-500)" strokeWidth={1.5} strokeDasharray="5 4" />
              <Area type="linear" dataKey="value" stroke="var(--color-money-500)" strokeWidth={2.5} fill={`url(#${gradientId})`} dot={{ r: 2.5, fill: 'var(--surface-solid)', strokeWidth: 2 }} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={520} animationEasing="ease-out" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {!hasCashData && (
          <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-4 text-center text-[0.68rem] font-medium text-[var(--faint-fg)]">
            Enter movements or count notes to start the live flow.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 border-t bg-[var(--glass-bg-subtle)]">
        <div className="border-r px-2.5 py-2"><p className="text-[0.6rem] font-bold uppercase tracking-wide text-[var(--faint-fg)]">Expected</p><p className="mt-0.5 text-[0.76rem] font-extrabold tabular-nums">{formatPaise(expectedPhysicalCashPaise, { decimals: false })}</p></div>
        <div className="px-2.5 py-2"><p className="text-[0.6rem] font-bold uppercase tracking-wide text-[var(--faint-fg)]">Counted · Difference</p><p className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-1.5 gap-y-0 text-[0.76rem] font-extrabold tabular-nums"><span>{formatPaise(countedCashPaise, { decimals: false })}</span><span className={differenceTone}>{cashDifferencePaise > 0n ? '+' : ''}{formatPaise(cashDifferencePaise, { decimals: false })}</span></p></div>
      </div>
    </div>
  );
}
