'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatCompactPaise, formatPaise } from '@/lib/money';
import { formatISODateShort, weekdayShort } from '@/lib/working-days';

export interface LoadPoint {
  date: string;
  cashPaise: string;
  onlinePaise: string;
  count: number;
}

export function UpcomingLoadChart({ data }: { data: LoadPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[15rem] items-center justify-center text-[0.875rem] text-[var(--faint-fg)]">
        Nothing scheduled in the next 14 days.
      </div>
    );
  }

  const points = data.map((d) => ({
    date: d.date,
    label: `${weekdayShort(d.date)} ${formatISODateShort(d.date)}`,
    cash: Number(BigInt(d.cashPaise) / 100n),
    online: Number(BigInt(d.onlinePaise) / 100n),
    cashPaise: d.cashPaise,
    onlinePaise: d.onlinePaise,
    count: d.count,
  }));

  return (
    <div className="h-[15rem] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id="gCash" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-money-500)" stopOpacity={0.55} />
              <stop offset="100%" stopColor="var(--color-money-500)" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="gOnline" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--hairline)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--faint-fg)' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--faint-fg)' }}
            tickLine={false}
            axisLine={false}
            width={62}
            tickFormatter={(v: number) => formatCompactPaise(BigInt(Math.round(v)) * 100n)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-brand-500)', strokeWidth: 1, strokeDasharray: '4 4' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof points)[number];
              const total = BigInt(p.cashPaise) + BigInt(p.onlinePaise);
              return (
                <div className="glass px-3 py-2.5 text-[0.8125rem]">
                  <p className="font-semibold">{p.label}</p>
                  <p className="mt-1.5 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-money-500)]" />
                    Cash
                    <span className="ml-auto font-medium tabular-nums">
                      {formatPaise(BigInt(p.cashPaise), { decimals: false })}
                    </span>
                  </p>
                  <p className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-brand-500)]" />
                    Online
                    <span className="ml-auto font-medium tabular-nums">
                      {formatPaise(BigInt(p.onlinePaise), { decimals: false })}
                    </span>
                  </p>
                  <p className="mt-1.5 border-t pt-1.5 text-[var(--muted-fg)]">
                    {p.count} instalment{p.count === 1 ? '' : 's'} ·{' '}
                    <span className="font-medium text-[var(--page-fg)]">
                      {formatPaise(total, { decimals: false })}
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="cash" stackId="1" stroke="var(--color-money-500)" strokeWidth={2} fill="url(#gCash)" animationDuration={900} />
          <Area type="monotone" dataKey="online" stackId="1" stroke="var(--color-brand-500)" strokeWidth={2} fill="url(#gOnline)" animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
