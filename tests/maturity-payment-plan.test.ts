import { describe, expect, it } from 'vitest';

import {
  AUGUST_2026_PAYOUT_END,
  aggregateForecastPayments,
  carryForwardWindowFor,
  projectForecastPayments,
} from '../src/lib/maturity-payment-plan';
import { makeCalendar } from '../src/lib/working-days';

const basePolicy = {
  calendar: makeCalendar(['2026-09-05', '2026-10-02'], {
    sundaysOff: true,
    saturdayRule: 'NONE' as const,
  }),
  windowDays: 15,
  roundingPaise: 100_000n,
  cashPolicy: { kind: 'CASH_CAP' as const, cashCapPerDayPaise: 2_000_000n },
};

describe('maturity forecast payment projection', () => {
  it('fits the August 2026 cohort inside 1–12 September and reconciles exactly', () => {
    const rows = [
      { id: 'large', maturityOn: '2026-08-29', amountPaise: 12_000_000n },
      { id: 'small', maturityOn: '2026-08-29', amountPaise: 9_000_000n },
    ];
    const instalments = projectForecastPayments('2026-08', rows, basePolicy);
    const daily = aggregateForecastPayments(instalments);

    expect(instalments.filter((row) => row.forecastId === 'large')).toHaveLength(10);
    expect(instalments.filter((row) => row.forecastId === 'small')).toHaveLength(5);
    expect(daily[0]!.dueOn).toBe('2026-09-01');
    expect(daily.at(-1)!.dueOn <= AUGUST_2026_PAYOUT_END).toBe(true);
    expect(daily.map((day) => day.dueOn)).not.toContain('2026-09-05');
    expect(daily.map((day) => day.dueOn)).not.toContain('2026-09-06');
    expect(daily.reduce((sum, day) => sum + day.totalPaise, 0n)).toBe(21_000_000n);
  });

  it('carries September maturities into 1–12 October and reconciles exactly', () => {
    const instalments = projectForecastPayments('2026-09', [
      { id: 'early', maturityOn: '2026-09-01', amountPaise: 12_000_000n },
      { id: 'late', maturityOn: '2026-09-28', amountPaise: 9_000_000n },
    ], basePolicy);

    expect(carryForwardWindowFor('2026-09')).toEqual({
      paymentMonth: '2026-10',
      startsOn: '2026-10-01',
      endsOn: '2026-10-12',
    });
    expect(instalments.find((row) => row.forecastId === 'early')?.dueDate).toBe('2026-10-01');
    expect(instalments.find((row) => row.forecastId === 'late')?.dueDate).toBe('2026-10-01');
    expect(instalments.every((row) => row.dueDate >= '2026-10-01' && row.dueDate <= '2026-10-12')).toBe(true);
    expect(instalments.reduce((sum, row) => sum + row.amountPaise, 0n)).toBe(21_000_000n);
  });

  it('balances alternate-day cases between both open-day tracks', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      id: `small-${String(index).padStart(2, '0')}`,
      maturityOn: '2026-09-20',
      amountPaise: 9_000_000n,
    }));
    const daily = aggregateForecastPayments(projectForecastPayments('2026-09', rows, basePolicy));
    const busiest = daily.reduce((max, day) => day.totalPaise > max ? day.totalPaise : max, 0n);
    const quietest = daily.reduce(
      (min, day) => min === null || day.totalPaise < min ? day.totalPaise : min,
      null as bigint | null,
    )!;

    expect(daily).toHaveLength(9);
    expect(daily.every((day) => day.cases > 0)).toBe(true);
    expect(busiest - quietest).toBeLessThanOrEqual(1_000_000n);
    expect(daily.reduce((sum, day) => sum + day.totalPaise, 0n)).toBe(180_000_000n);
  });
});
