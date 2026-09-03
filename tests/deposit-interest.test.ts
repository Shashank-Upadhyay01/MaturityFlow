import { describe, expect, it } from 'vitest';

import {
  applyInterest,
  DEFAULT_INTEREST_BPS,
  formatBpsAsPercent,
  formatShare,
  interestOn,
  maturityWithInterest,
  parseDepositInterestGrid,
  parsePercentToBps,
  summariseDepositInterest,
} from '../src/lib/deposit-interest';
import { rupees } from '../src/lib/money';
import { LARGE_CASE_THRESHOLD_PAISE } from '../src/lib/payout-policy';

describe('interestOn', () => {
  it('applies 8.50% to a lakh exactly', () => {
    expect(interestOn(rupees('100000'), DEFAULT_INTEREST_BPS)).toBe(rupees('8500'));
    expect(maturityWithInterest(rupees('100000'), 850)).toBe(rupees('108500'));
  });

  it('rounds half-up to the nearest paise', () => {
    // ₹1 at 8.50% is 8.5 paise → 9 paise.
    expect(interestOn(100n, 850)).toBe(9n);
  });

  it('is zero at 0% and on a zero deposit', () => {
    expect(interestOn(rupees('100000'), 0)).toBe(0n);
    expect(interestOn(0n, 850)).toBe(0n);
  });

  it('rejects a negative principal and a rate outside 0–100%', () => {
    expect(() => interestOn(-1n, 850)).toThrow(/negative/);
    expect(() => interestOn(100n, -1)).toThrow(/basis points/);
    expect(() => interestOn(100n, 10_001)).toThrow(/basis points/);
    expect(() => interestOn(100n, 8.5)).toThrow(/basis points/);
  });
});

describe('parsePercentToBps', () => {
  it('reads the published rate and live typing', () => {
    expect(parsePercentToBps('8.50')).toBe(850);
    expect(parsePercentToBps('8.5%')).toBe(850);
    expect(parsePercentToBps('8')).toBe(800);
    expect(parsePercentToBps('8.')).toBe(800);
    expect(parsePercentToBps('0.25')).toBe(25);
    expect(parsePercentToBps('100')).toBe(10_000);
  });

  it('rejects empty, extra decimals, and more than 100%', () => {
    expect(parsePercentToBps('')).toBeNull();
    expect(parsePercentToBps('8.555')).toBeNull();
    expect(parsePercentToBps('100.01')).toBeNull();
    expect(parsePercentToBps('abc')).toBeNull();
  });

  it('prints two decimals so the field matches 8.50%', () => {
    expect(formatBpsAsPercent(850)).toBe('8.50');
    expect(formatBpsAsPercent(800)).toBe('8.00');
    expect(formatBpsAsPercent(25)).toBe('0.25');
  });
});

describe('applyInterest / summariseDepositInterest', () => {
  const book = [
    { name: 'Asha', depositedPaise: rupees('100000') },
    { name: 'Bala', depositedPaise: rupees('50000') },
    { name: 'Asha', depositedPaise: rupees('25000') },
    { name: '  ', depositedPaise: rupees('10') },
    { name: 'Empty', depositedPaise: 0n },
  ];

  it('keeps Σ(deposit) + Σ(interest) = Σ(maturity) and ignores blank rows', () => {
    const lines = applyInterest(book.filter((r) => r.name.trim() && r.depositedPaise > 0n), 850);
    const deposit = lines.reduce((s, l) => s + l.depositedPaise, 0n);
    const interest = lines.reduce((s, l) => s + l.interestPaise, 0n);
    const maturity = lines.reduce((s, l) => s + l.maturityPaise, 0n);
    expect(deposit + interest).toBe(maturity);
    expect(deposit).toBe(rupees('175000'));
    expect(interest).toBe(rupees('14875'));
  });

  it('counts unique customers and uses maturity — not deposit — for the ₹1 lakh rule', () => {
    const insights = summariseDepositInterest(book, 850);
    expect(insights.lineCount).toBe(3);
    expect(insights.customerCount).toBe(2);
    expect(insights.depositedPaise).toBe(rupees('175000'));
    expect(insights.interestPaise).toBe(rupees('14875'));
    expect(insights.maturityPaise).toBe(rupees('189875'));
    expect(insights.averageDepositPaise).toBe(rupees('175000') / 3n);
    expect(insights.medianDepositPaise).toBe(rupees('50000'));
    expect(insights.largest?.name).toBe('Asha');
    expect(insights.largest?.depositedPaise).toBe(rupees('100000'));
    // ₹1,00,000 deposited → ₹1,08,500 with interest: daily cadence.
    // ₹50,000 and ₹25,000 stay below the threshold: alternate.
    expect(insights.dailyCadenceCount).toBe(1);
    expect(insights.alternateCadenceCount).toBe(2);
    expect(insights.dailyCadenceMaturityPaise).toBeGreaterThanOrEqual(LARGE_CASE_THRESHOLD_PAISE);
  });

  it('splits the book into deposit bands and measures concentration', () => {
    const insights = summariseDepositInterest(book, 850);
    const under50 = insights.bands.find((b) => b.id === 'under_50k')!;
    const from50 = insights.bands.find((b) => b.id === 'from_50k_to_1l')!;
    const from1l = insights.bands.find((b) => b.id === 'from_1l_to_5l')!;
    expect(under50.count).toBe(1);
    expect(from50.count).toBe(1);
    expect(from1l.count).toBe(1);
    expect(insights.top5ShareBps).toBe(10_000);
    expect(formatShare(insights.largest!.shareBps)).toMatch(/%$/);
  });

  it('recomputes interest when the rate moves by 0.25 percentage points', () => {
    const at850 = summariseDepositInterest(book, 850);
    const at875 = summariseDepositInterest(book, 875);
    const at825 = summariseDepositInterest(book, 825);
    expect(at850.plus25BpsInterestPaise).toBe(at875.interestPaise);
    expect(at850.minus25BpsInterestPaise).toBe(at825.interestPaise);
    expect(at875.interestPaise).toBeGreaterThan(at850.interestPaise);
    expect(at825.interestPaise).toBeLessThan(at850.interestPaise);
  });
});

describe('parseDepositInterestGrid', () => {
  it('reads the template headers and Indian-formatted amounts', () => {
    const parsed = parseDepositInterestGrid([
      ['Customer Name', 'Total Deposited Amount'],
      ['Asha', '1,00,000'],
      ['Bala', 50000.5],
      ['', ''],
      ['Broken', 'not-money'],
    ]);
    expect(parsed.rows).toEqual([
      { name: 'Asha', depositedPaise: rupees('100000'), maturityOn: null, agentName: null },
      { name: 'Bala', depositedPaise: rupees('50000.50'), maturityOn: null, agentName: null },
    ]);
    expect(parsed.skipped).toBe(1);
    expect(parsed.errors.some((e) => e.includes('Broken'))).toBe(true);
  });

  it('accepts a filled export that also has interest columns', () => {
    const parsed = parseDepositInterestGrid([
      ['Customer Name', 'Total Deposited Amount', 'Interest', 'Amount with interest', 'Rate %'],
      ['Asha', 100000, 8500, 108500, '8.50'],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].depositedPaise).toBe(rupees('100000'));
  });

  it('rejects a sheet without the two required columns', () => {
    const parsed = parseDepositInterestGrid([
      ['Agent', 'Branch'],
      ['X', 'Y'],
    ]);
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors[0]).toMatch(/Customer Name/);
  });

  it('reads an Indian maturity date and keeps a row if the date is blank', () => {
    const parsed = parseDepositInterestGrid([
      ['Customer Name', 'Maturity Date', 'Total Deposited Amount'],
      ['Asha', '29/08/2026', '1,00,000'],
      ['Bala', '', 50000],
      ['Chitra', new Date(Date.UTC(2026, 8, 15)), 25000],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { name: 'Asha', depositedPaise: rupees('100000'), maturityOn: '2026-08-29', agentName: null },
      { name: 'Bala', depositedPaise: rupees('50000'), maturityOn: null, agentName: null },
      { name: 'Chitra', depositedPaise: rupees('25000'), maturityOn: '2026-09-15', agentName: null },
    ]);
  });
});

describe('maturity-date insights', () => {
  it('groups dated deposits by month and splits past from upcoming', () => {
    const insights = summariseDepositInterest(
      [
        { name: 'Asha', depositedPaise: rupees('100000'), maturityOn: '2026-08-29' },
        { name: 'Bala', depositedPaise: rupees('50000'), maturityOn: '2026-08-15' },
        { name: 'Chitra', depositedPaise: rupees('25000'), maturityOn: '2026-09-01' },
        { name: 'Dev', depositedPaise: rupees('10000') },
      ],
      850,
      { asOf: '2026-08-20' },
    );
    expect(insights.datedCount).toBe(3);
    expect(insights.undatedCount).toBe(1);
    expect(insights.earliestOn).toBe('2026-08-15');
    expect(insights.latestOn).toBe('2026-09-01');
    expect(insights.nextOn).toBe('2026-08-29');
    expect(insights.pastCount).toBe(1);
    expect(insights.upcomingCount).toBe(2);
    expect(insights.months.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(insights.months[0].count).toBe(2);
    expect(insights.months[0].depositedPaise).toBe(rupees('150000'));
  });
});
