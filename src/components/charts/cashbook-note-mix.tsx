'use client';

import { useMemo } from 'react';

import {
  type CashbookDayFigures,
  largestNoteHolding,
  noteMixRows,
} from '@/lib/daily-cashbook';
import { formatPaise } from '@/lib/money';

interface CashbookNoteMixProps {
  figures: CashbookDayFigures;
  countedCashPaise: bigint;
}

/**
 * Which note the drawer holds most of.
 *
 * Deliberately NOT a charting library. Six proportional bars are a div with a percentage
 * width, and going without Recharts here buys three things: the panel cannot re-measure
 * itself into an endless vertical stretch the way a ResponsiveContainer in an auto-height
 * grid row does (see the traps note in CLAUDE.md), it prints, and it costs no bundle.
 */
export function CashbookNoteMix({ figures, countedCashPaise }: CashbookNoteMixProps) {
  const rows = useMemo(() => noteMixRows(figures), [figures]);
  const top = largestNoteHolding(rows);
  const coinsPaise = figures.coinsPaise;

  return (
    <div className="flex h-full min-h-[15.5rem] flex-col">
      <div className="min-h-0 flex-1 px-3 pb-1 pt-2">
        {top ? (
          <ul className="flex h-full flex-col justify-between">
            {rows.map((row) => (
              <li key={row.field} className="grid grid-cols-[2.4rem_minmax(0,1fr)_2.6rem] items-center gap-2">
                <span className="text-[0.72rem] font-bold tabular-nums text-[var(--muted-fg)]">{row.label}</span>
                <span className="relative h-3.5 overflow-hidden rounded-[4px] bg-[var(--glass-bg-strong)]">
                  <span
                    className="absolute inset-y-0 left-0 rounded-[4px] bg-[var(--color-money-500)] transition-[width] duration-300 ease-out"
                    style={{ width: `${row.share * 100}%` }}
                  />
                </span>
                <span
                  className="text-right text-[0.72rem] font-bold tabular-nums"
                  title={`${row.count} × ${row.label} = ${formatPaise(row.valuePaise, { decimals: false })}`}
                >
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex h-full items-center justify-center px-4">
            <p className="text-center text-[0.68rem] font-medium text-[var(--faint-fg)]">
              Count the notes to see which denomination you hold most of.
            </p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 border-t bg-[var(--glass-bg-subtle)]">
        <div className="border-r px-2.5 py-2">
          <p className="text-[0.6rem] font-bold uppercase tracking-wide text-[var(--faint-fg)]">Most held</p>
          <p className="mt-0.5 text-[0.76rem] font-extrabold tabular-nums">
            {top ? `${top.count} × ${top.label}` : '—'}
          </p>
          <p className="text-[0.62rem] font-semibold tabular-nums text-[var(--muted-fg)]">
            {top ? formatPaise(top.valuePaise, { decimals: false }) : 'nothing counted'}
          </p>
        </div>
        <div className="px-2.5 py-2">
          <p className="text-[0.6rem] font-bold uppercase tracking-wide text-[var(--faint-fg)]">Coins · In hand</p>
          <p className="mt-0.5 text-[0.76rem] font-extrabold tabular-nums">
            {formatPaise(coinsPaise, { decimals: false })}
          </p>
          <p className="text-[0.62rem] font-semibold tabular-nums text-[var(--muted-fg)]">
            {formatPaise(countedCashPaise, { decimals: false })}
          </p>
        </div>
      </div>
    </div>
  );
}
