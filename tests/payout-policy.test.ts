import { describe, expect, it } from 'vitest';
import {
  LARGE_CASE_THRESHOLD_PAISE,
  PROCESSING_WORKING_DAYS,
  PayoutPolicyError,
  cadenceFor,
  isPriorityCase,
  payoutPlanFor,
  strideFor,
} from '../src/lib/payout-policy';

const LAKH = 10_000_000n; // ₹1,00,000 in paise

describe('the ₹1 lakh line', () => {
  it('sits at exactly ₹1,00,000, inclusive', () => {
    expect(LARGE_CASE_THRESHOLD_PAISE).toBe(LAKH);
    expect(isPriorityCase(LAKH)).toBe(true);
    expect(isPriorityCase(LAKH + 1n)).toBe(true);
    expect(isPriorityCase(LAKH - 1n)).toBe(false);
  });

  it('decides the cadence', () => {
    expect(cadenceFor(LAKH)).toBe('DAILY');
    expect(cadenceFor(LAKH - 1n)).toBe('ALTERNATE');
    expect(cadenceFor(159_095_400n)).toBe('DAILY');
    expect(cadenceFor(100n)).toBe('ALTERNATE');
  });

  it('maps cadence to a stride', () => {
    expect(strideFor('DAILY')).toBe(1);
    expect(strideFor('ALTERNATE')).toBe(2);
  });
});

describe('payoutPlanFor', () => {
  it('gives a large case 12 daily payouts in a 15-day window', () => {
    expect(payoutPlanFor(LAKH, 15)).toEqual({
      cadence: 'DAILY',
      processingDays: 3,
      payoutDays: 12,
      stride: 1,
    });
  });

  it('gives a small case 6 alternate payouts in the same window', () => {
    expect(payoutPlanFor(LAKH - 1n, 15)).toEqual({
      cadence: 'ALTERNATE',
      processingDays: 3,
      payoutDays: 6,
      stride: 2,
    });
  });

  it('generalises to a longer window rather than hard-coding 12', () => {
    expect(payoutPlanFor(LAKH, 20).payoutDays).toBe(17);
    expect(payoutPlanFor(LAKH - 1n, 20).payoutDays).toBe(9); // ceil(17 / 2)
  });

  it('the last payout always lands inside the window', () => {
    for (const windowDays of [4, 5, 8, 15, 20, 31, 60]) {
      for (const amount of [LAKH, LAKH - 1n]) {
        const p = payoutPlanFor(amount, windowDays);
        const lastOffset = (p.payoutDays - 1) * p.stride; // working days past the payout anchor
        expect(lastOffset).toBeLessThanOrEqual(windowDays - p.processingDays - 1);
      }
    }
  });

  it('refuses a window with no room to pay', () => {
    expect(() => payoutPlanFor(LAKH, 3)).toThrow(PayoutPolicyError);
    expect(() => payoutPlanFor(LAKH, 0)).toThrow(PayoutPolicyError);
    expect(() => payoutPlanFor(LAKH, 15.5)).toThrow(PayoutPolicyError);
    // 4 working days minus 3 processing leaves exactly one payout day — allowed.
    expect(payoutPlanFor(LAKH, 4).payoutDays).toBe(1);
    expect(payoutPlanFor(LAKH - 1n, 4).payoutDays).toBe(1);
  });

  it('exposes the processing constant it used', () => {
    expect(PROCESSING_WORKING_DAYS).toBe(3);
    expect(payoutPlanFor(LAKH, 15, 0).payoutDays).toBe(15);
  });
});
