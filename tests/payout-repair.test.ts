import { describe, expect, it } from 'vitest';
import { generateSchedule, rescheduleRemaining } from '@/lib/payout-engine';
import { caseScheduleAnchorFor, payoutPlanFor } from '@/lib/payout-policy';
import { reconcileInstalmentLegs } from '@/lib/payment-rules';
import { makeCalendar } from '@/lib/working-days';

const calendar = makeCalendar([], { monthStartBlockedDays: 0 });

describe('the recommended payout calendar', () => {
  it('pays ₹1 lakh in 12 working-day payments starting the day after approval', () => {
    const plan = payoutPlanFor(10_000_000n, 15);
    const result = generateSchedule({
      totalPaise: 10_000_000n, days: plan.payoutDays, roundingPaise: 100_000n,
      startDate: caseScheduleAnchorFor({ formSubmittedOn: '2026-09-08', opsReviewedOn: '2026-09-09' }, calendar),
      calendar, stride: plan.stride, calendarDayGap: plan.calendarDayGap,
    });
    expect(result.installments.map((row) => row.dueDate)).toEqual([
      '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17',
      '2026-09-18', '2026-09-19', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
    ]);
    expect(result.installments.reduce((sum, row) => sum + row.amountPaise, 0n)).toBe(10_000_000n);
  });

  it('lets a holiday satisfy the gap between alternate payments', () => {
    const plan = payoutPlanFor(6_000_000n, 15);
    const result = generateSchedule({
      totalPaise: 6_000_000n, days: plan.payoutDays, roundingPaise: 100_000n,
      startDate: '2026-09-10', calendar, stride: plan.stride, calendarDayGap: plan.calendarDayGap,
    });
    expect(result.installments.map((row) => row.dueDate)).toEqual([
      '2026-09-10', '2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23',
    ]);
  });
});

describe('customer-agreed payment plans', () => {
  it('keeps one exact full payment on a typed closed date', () => {
    const result = generateSchedule({
      totalPaise: 12_345_678n, days: 1, roundingPaise: 100_000n,
      startDate: '2026-09-13', calendar, allowClosedStartDate: true,
    });
    expect(result.installments).toHaveLength(1);
    expect(result.installments[0]).toMatchObject({ dueDate: '2026-09-13', amountPaise: 12_345_678n, isFinal: true });
  });
  it('continues after a typed closed date without duplicate payout dates', () => {
    const result = generateSchedule({
      totalPaise: 3_000_000n, days: 3, roundingPaise: 100_000n,
      startDate: '2026-09-13', calendar, allowClosedStartDate: true,
    });
    expect(result.installments.map((row) => row.dueDate)).toEqual(['2026-09-13', '2026-09-14', '2026-09-15']);
  });
  it('keeps six requested payments when the default rounding step is too coarse', () => {
    const result = generateSchedule({
      totalPaise: 300_000n, days: 6, roundingPaise: 100_000n,
      startDate: '2026-09-10', calendar, preservePayoutCount: true,
    });
    expect(result.installments).toHaveLength(6);
    expect(result.installments.every((row) => row.amountPaise === 50_000n)).toBe(true);
    expect(result.warnings.some((warning) => warning.code === 'ROUNDING_REDUCED_FOR_DAYS')).toBe(true);
  });
  it('replans a custom count without filling extra days before the deadline', () => {
    const result = rescheduleRemaining({
      remainingPaise: 3_000_000n, fromDate: '2026-09-10', deadlineDate: '2026-09-30',
      roundingPaise: 100_000n, calendar, cadence: 'ALTERNATE', payoutCount: 1,
    });
    expect(result.installments).toHaveLength(1);
    expect(result.totalPaise).toBe(3_000_000n);
    expect(result.slaBreachUnavoidable).toBe(false);
  });
  it('reports a real deadline breach when a custom count extends beyond it', () => {
    const result = rescheduleRemaining({
      remainingPaise: 3_000_000n, fromDate: '2026-09-10', deadlineDate: '2026-09-11',
      roundingPaise: 100_000n, calendar, payoutCount: 3,
    });
    expect(result.slaBreachUnavoidable).toBe(true);
  });
});

describe('actual tender and the unpaid plan', () => {
  it('redistributes two missed ₹10,000 days over the eight working days still promised', () => {
    const result = rescheduleRemaining({
      // ₹1,20,000 maturity less the two ₹10,000 receipts already handed over.
      remainingPaise: 10_000_000n,
      fromDate: '2026-09-05',
      deadlineDate: '2026-09-15',
      roundingPaise: 100_000n,
      calendar,
      cadence: 'DAILY',
      equalize: true,
    });
    expect(result.installments.map((row) => row.dueDate)).toEqual([
      '2026-09-05', '2026-09-07', '2026-09-08', '2026-09-09',
      '2026-09-10', '2026-09-11', '2026-09-14', '2026-09-15',
    ]);
    expect(result.installments.every((row) => row.amountPaise === 1_250_000n)).toBe(true);
    expect(result.installments.reduce((sum, row) => sum + row.amountPaise, 0n)).toBe(10_000_000n);
  });
  it('preserves the unpaid online recommendation after a partial cash visit', () => {
    expect(reconcileInstalmentLegs(880_000n, 250_000n, 120_000n, 0n))
      .toEqual({ cashPaise: 250_000n, onlinePaise: 630_000n });
  });
  it('allows a planned online day to be paid in cash without leaving a phantom online balance', () => {
    expect(reconcileInstalmentLegs(880_000n, 0n, 880_000n, 0n))
      .toEqual({ cashPaise: 880_000n, onlinePaise: 0n });
  });
  it('refuses a paid total above the planned amount', () => {
    expect(() => reconcileInstalmentLegs(1n, 0n, 2n, 0n)).toThrow();
  });
});
