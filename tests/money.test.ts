import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  formatCompactPaise,
  formatPaise,
  paiseToDecimalString,
  parseRupeesToPaise,
  percentOf,
  sumPaise,
  tryParseRupeesToPaise,
} from '../src/lib/money';

describe('parseRupeesToPaise', () => {
  it('parses plain integers', () => {
    expect(parseRupeesToPaise('500000')).toBe(50_000_000n);
    expect(parseRupeesToPaise('0.01')).toBe(1n);
    expect(parseRupeesToPaise('1')).toBe(100n);
  });

  it('parses Indian-grouped and symbol-prefixed strings', () => {
    expect(parseRupeesToPaise('5,00,000')).toBe(50_000_000n);
    expect(parseRupeesToPaise('₹5,00,000.50')).toBe(50_000_050n);
    expect(parseRupeesToPaise('  ₹ 1,00,000.05  ')).toBe(10_000_005n);
  });

  it('normalises leading/trailing dots', () => {
    expect(parseRupeesToPaise('.5')).toBe(50n);
    expect(parseRupeesToPaise('100.')).toBe(10_000n);
  });

  it('pads one-decimal input correctly (a classic off-by-10x bug)', () => {
    expect(parseRupeesToPaise('1.5')).toBe(150n);
    expect(parseRupeesToPaise('1.05')).toBe(105n);
  });

  it('accepts numbers without float drift', () => {
    expect(parseRupeesToPaise(0.1 + 0.2)).toBe(30n); // 0.30000000000000004 -> ₹0.30
    expect(parseRupeesToPaise(1234.56)).toBe(123_456n);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '   ', 'abc', '1e5', '1.234', '--5', '1.2.3', '₹', 'NaN']) {
      expect(() => parseRupeesToPaise(bad)).toThrow(MoneyError);
    }
  });

  it('rejects negatives unless explicitly allowed', () => {
    expect(() => parseRupeesToPaise('-100')).toThrow(MoneyError);
    expect(parseRupeesToPaise('-100', { allowNegative: true })).toBe(-10_000n);
  });

  it('rejects NaN / Infinity', () => {
    expect(() => parseRupeesToPaise(Number.NaN)).toThrow(MoneyError);
    expect(() => parseRupeesToPaise(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects absurd amounts above the ₹1000 crore ceiling', () => {
    expect(() => parseRupeesToPaise('9999999999999')).toThrow(MoneyError);
  });

  it('tryParse returns null instead of throwing', () => {
    expect(tryParseRupeesToPaise('nonsense')).toBeNull();
    expect(tryParseRupeesToPaise('12')).toBe(1200n);
  });

  it('round-trips through the decimal string form', () => {
    for (const s of ['0.01', '1.00', '999999.99', '500000.50', '123456.78']) {
      expect(paiseToDecimalString(parseRupeesToPaise(s))).toBe(s);
    }
  });
});

describe('formatting', () => {
  it('uses Indian lakh/crore grouping', () => {
    expect(formatPaise(50_000_000n)).toBe('₹5,00,000.00');
    expect(formatPaise(100_000_000_0n)).toBe('₹1,00,00,000.00');
    expect(formatPaise(12_345_678n, { decimals: false })).toBe('₹1,23,457');
  });

  it('omits the symbol on request', () => {
    expect(formatPaise(50_000_000n, { symbol: false })).toBe('5,00,000.00');
  });

  it('formats negatives', () => {
    expect(formatPaise(-50_000_000n)).toBe('-₹5,00,000.00');
  });

  it('compacts to lakh and crore', () => {
    expect(formatCompactPaise(50_000_000n)).toBe('₹5.00 L');
    expect(formatCompactPaise(1_250_000_000n)).toBe('₹1.25 Cr');
    expect(formatCompactPaise(4_500_000n)).toBe('₹45,000');
  });
});

describe('helpers', () => {
  it('sums exactly', () => {
    expect(sumPaise([1n, 2n, 3n])).toBe(6n);
    expect(sumPaise([])).toBe(0n);
  });
  it('computes percentages without float error at the boundaries', () => {
    expect(percentOf(0n, 100n)).toBe(0);
    expect(percentOf(100n, 100n)).toBe(100);
    expect(percentOf(1n, 3n)).toBeCloseTo(33.33, 2);
    expect(percentOf(5n, 0n)).toBe(0); // no division by zero
  });
});
