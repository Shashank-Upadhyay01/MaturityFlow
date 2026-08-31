import { describe, expect, it } from 'vitest';

import {
  AUGUST_2026_PAYOUT_END,
  aggregateForecastPayments,
  projectForecastPayments,
} from '../src/lib/maturity-payment-plan';
import { makeCalendar } from '../src/lib/working-days';

const basePolicy = {
  calendar: makeCalendar(['2026-09-05'], {
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

  it('starts September maturities three calendar days later and never before maturity', () => {
    const instalments = projectForecastPayments('2026-09', [
      { id: 'early', maturityOn: '2026-09-01', amountPaise: 12_000_000n },
      { id: 'late', maturityOn: '2026-09-28', amountPaise: 9_000_000n },
    ], basePolicy);

    expect(instalments.find((row) => row.forecastId === 'early')?.dueDate).toBe('2026-09-04');
    expect(instalments.find((row) => row.forecastId === 'late')!.dueDate >= '2026-10-04').toBe(true);
    expect(instalments.reduce((sum, row) => sum + row.amountPaise, 0n)).toBe(21_000_000n);
  });
});
