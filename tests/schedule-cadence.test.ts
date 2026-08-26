import { describe, expect, it } from 'vitest';
import { generateSchedule, rescheduleRemaining } from '../src/lib/payout-engine';
import { countWorkingDaysBetween, makeCalendar } from '../src/lib/working-days';
import { payoutPlanFor } from '../src/lib/payout-policy';

const cal = makeCalendar();

describe('rescheduling keeps the cadence', () => {
  const common = {
    remainingPaise: 3_000_000n, // ₹30,000
    fromDate: '2026-08-24',
    deadlineDate: '2026-09-11',
    roundingPaise: 100_000n,
    calendar: cal,
  } as const;

  it('an alternate-day case stays on alternate days', () => {
    const r = rescheduleRemaining({ ...common, cadence: 'ALTERNATE' });
    for (let i = 0; i + 1 < r.installments.length; i++) {
      expect(
        countWorkingDaysBetween(r.installments[i].dueDate, r.installments[i + 1].dueDate, cal),
      ).toBe(3); // two working days apart, inclusive count
    }
    expect(r.installments.reduce((s, i) => s + i.amountPaise, 0n)).toBe(common.remainingPaise);
  });

  it('a daily case is unchanged by the new option', () => {
    const withDefault = rescheduleRemaining({ ...common });
    const explicit = rescheduleRemaining({ ...common, cadence: 'DAILY' });
    expect(explicit.installments.map((i) => i.dueDate)).toEqual(
      withDefault.installments.map((i) => i.dueDate),
    );
    for (let i = 0; i + 1 < explicit.installments.length; i++) {
      expect(
        countWorkingDaysBetween(
          explicit.installments[i].dueDate,
          explicit.installments[i + 1].dueDate,
          cal,
        ),
      ).toBe(2); // consecutive working days
    }
  });

  it('an alternate remainder still finishes by the promised deadline', () => {
    const r = rescheduleRemaining({ ...common, cadence: 'ALTERNATE' });
    expect(r.installments[r.installments.length - 1].dueDate <= common.deadlineDate).toBe(true);
  });

  it('the plan a small case gets is the one the policy asked for', () => {
    expect(payoutPlanFor(6_000_000n, 15)).toEqual({
      cadence: 'ALTERNATE',
      processingDays: 3,
      payoutDays: 6,
      stride: 2,
    });
  });
});

describe('the anchor is day one, not a processing start', () => {
  const plan = payoutPlanFor(12_000_000n, 15);

  it('pays on the anchor itself', () => {
    const res = generateSchedule({
      totalPaise: 12_000_000n,
      days: plan.payoutDays,
      roundingPaise: 100_000n,
      startDate: '2026-09-23',
      calendar: cal,
      distribution: 'FRONT_LOADED',
      cashPolicy: { kind: 'CASH_ONLY' },
      startOnNextWorkingDay: false,
      stride: plan.stride,
      startOffsetWorkingDays: 0,
      policyMaxDays: plan.payoutDays,
    });
    expect(res.installments[0].dueDate).toBe('2026-09-23');
    expect(res.installments).toHaveLength(12);
  });

  it('still splits the money into twelve, unchanged', () => {
    expect(plan.payoutDays).toBe(12);
    expect(plan.stride).toBe(1);
    // The constant is untouched; the service simply stops applying it as an engine offset.
    expect(plan.processingDays).toBe(3);
  });
});
