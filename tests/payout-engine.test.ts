import { describe, expect, it } from 'vitest';
import { formatPaise, rupees } from '../src/lib/money';
import {
  MAX_SCHEDULE_DAYS,
  ScheduleInputError,
  deriveDeadline,
  generateSchedule,
  rescheduleRemaining,
} from '../src/lib/payout-engine';
import { isWorkingDay, makeCalendar } from '../src/lib/working-days';

const cal = makeCalendar();
const STEP_1K = 100_000n; // ₹1,000
const STEP_10K = 1_000_000n; // ₹10,000

/** Every result must satisfy the money invariants. Applied to every case in this file. */
function assertInvariants(res: ReturnType<typeof generateSchedule>) {
  const sum = res.installments.reduce((a, i) => a + i.amountPaise, 0n);
  expect(sum).toBe(res.totalPaise); // INV-2
  for (const i of res.installments) {
    expect(i.cashLegPaise + i.onlineLegPaise).toBe(i.amountPaise); // INV-3
    expect(i.amountPaise > 0n).toBe(true);
    expect(isWorkingDay(i.dueDate, cal)).toBe(true); // INV-8
  }
  expect(res.totalCashPaise + res.totalOnlinePaise).toBe(res.totalPaise);
  expect(res.installments.filter((i) => i.isFinal)).toHaveLength(1);
  expect(res.installments[res.installments.length - 1].isFinal).toBe(true);
}

describe('the brief: ₹5,00,000 within 15 days at a ₹1,000 step', () => {
  const res = generateSchedule({
    totalPaise: rupees('500000'),
    days: 15,
    roundingPaise: STEP_1K,
    startDate: '2026-08-17',
    calendar: cal,
  });

  it('holds every invariant', () => assertInvariants(res));

  it('produces 5 days of ₹34,000 and 10 days of ₹33,000', () => {
    const amounts = res.installments.map((i) => i.amountPaise);
    expect(amounts.filter((a) => a === rupees('34000'))).toHaveLength(5);
    expect(amounts.filter((a) => a === rupees('33000'))).toHaveLength(10);
  });

  it('front-loads the heavier days by default', () => {
    expect(res.installments.slice(0, 5).every((i) => i.amountPaise === rupees('34000'))).toBe(true);
  });

  it('keeps every instalment a whole multiple of ₹1,000', () => {
    for (const i of res.installments) expect(i.amountPaise % STEP_1K).toBe(0n);
  });

  it('keeps the busiest and quietest day within one rounding step', () => {
    expect(res.largestDailyPaise - res.smallestDailyPaise).toBe(STEP_1K);
  });

  it('reports readable totals', () => {
    expect(formatPaise(res.totalPaise)).toBe('₹5,00,000.00');
    expect(res.effectiveDays).toBe(15);
    expect(res.firstPayoutDate).toBe('2026-08-17');
  });
});

describe('the lumpy-last-day problem is solved', () => {
  it('₹10,00,000 / 15 days / ₹10,000 step never dumps a giant final instalment', () => {
    const res = generateSchedule({
      totalPaise: rupees('1000000'),
      days: 15,
      roundingPaise: STEP_10K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);

    const amounts = res.installments.map((i) => i.amountPaise);
    expect(amounts.filter((a) => a === rupees('70000'))).toHaveLength(10);
    expect(amounts.filter((a) => a === rupees('60000'))).toHaveLength(5);

    // The naive algorithm would have produced ₹1,60,000 on the final day.
    expect(res.finalInstallmentPaise).toBe(rupees('60000'));
    expect(res.largestDailyPaise).toBe(rupees('70000'));
  });
});

describe('residue handling', () => {
  it('puts the sub-step remainder on the final instalment', () => {
    const res = generateSchedule({
      totalPaise: rupees('100750.50'),
      days: 10,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.installments.slice(0, 9).every((i) => i.amountPaise === rupees('10000'))).toBe(true);
    expect(res.finalInstallmentPaise).toBe(rupees('10750.50'));
    expect(res.warnings.some((w) => w.code === 'RESIDUE_ON_FINAL_DAY')).toBe(true);
  });

  it('handles a single paisa of residue', () => {
    const res = generateSchedule({
      totalPaise: rupees('50000.01'),
      days: 5,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.finalInstallmentPaise).toBe(rupees('10000.01'));
  });
});

describe('distribution modes', () => {
  const base = {
    totalPaise: rupees('500000'),
    days: 15,
    roundingPaise: STEP_1K,
    startDate: '2026-08-17',
    calendar: cal,
  } as const;

  it('FRONT_LOADED puts the extras first', () => {
    const r = generateSchedule({ ...base, distribution: 'FRONT_LOADED' });
    assertInvariants(r);
    expect(r.installments[0].amountPaise).toBe(rupees('34000'));
    expect(r.installments[14].amountPaise).toBe(rupees('33000'));
  });

  it('BACK_LOADED puts the extras last', () => {
    const r = generateSchedule({ ...base, distribution: 'BACK_LOADED' });
    assertInvariants(r);
    expect(r.installments[0].amountPaise).toBe(rupees('33000'));
    expect(r.installments[14].amountPaise).toBe(rupees('34000'));
  });

  it('EVEN spreads the extras across the window', () => {
    const r = generateSchedule({ ...base, distribution: 'EVEN' });
    assertInvariants(r);
    const heavy = r.installments.filter((i) => i.amountPaise === rupees('34000'));
    expect(heavy).toHaveLength(5);
    // not clustered at either end
    const idx = heavy.map((i) => i.seq);
    expect(Math.max(...idx) - Math.min(...idx)).toBeGreaterThan(5);
  });

  it('all three modes sum to the identical total', () => {
    const totals = (['FRONT_LOADED', 'BACK_LOADED', 'EVEN'] as const).map((d) =>
      generateSchedule({ ...base, distribution: d }).installments.reduce(
        (a, i) => a + i.amountPaise,
        0n,
      ),
    );
    expect(new Set(totals.map(String)).size).toBe(1);
    expect(totals[0]).toBe(rupees('500000'));
  });
});

describe('cash / online split', () => {
  it('CASH_CAP splits every day at the cap', () => {
    const res = generateSchedule({
      totalPaise: rupees('500000'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
      cashPolicy: { kind: 'CASH_CAP', cashCapPerDayPaise: rupees('20000') },
    });
    assertInvariants(res);
    expect(res.totalCashPaise).toBe(rupees('300000')); // 15 × 20,000
    expect(res.totalOnlinePaise).toBe(rupees('200000'));
    for (const i of res.installments) expect(i.cashLegPaise).toBe(rupees('20000'));
  });

  it('CASH_CAP above the daily amount leaves everything in cash', () => {
    const res = generateSchedule({
      totalPaise: rupees('50000'),
      days: 5,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
      cashPolicy: { kind: 'CASH_CAP', cashCapPerDayPaise: rupees('100000') },
    });
    assertInvariants(res);
    expect(res.totalOnlinePaise).toBe(0n);
    expect(res.warnings.some((w) => w.code === 'CASH_CAP_UNUSED')).toBe(true);
  });

  it('ONLINE_ONLY needs no cash at all', () => {
    const res = generateSchedule({
      totalPaise: rupees('500000'),
      days: 12,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
      cashPolicy: { kind: 'ONLINE_ONLY' },
    });
    assertInvariants(res);
    expect(res.totalCashPaise).toBe(0n);
    expect(res.totalOnlinePaise).toBe(rupees('500000'));
  });

  it('a zero cash cap degenerates to online-only', () => {
    const res = generateSchedule({
      totalPaise: rupees('50000'),
      days: 5,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
      cashPolicy: { kind: 'CASH_CAP', cashCapPerDayPaise: 0n },
    });
    assertInvariants(res);
    expect(res.totalCashPaise).toBe(0n);
  });
});

describe('small amounts degrade gracefully', () => {
  it('₹3,000 over 15 days at a ₹1,000 step compresses to 3 days and warns', () => {
    const res = generateSchedule({
      totalPaise: rupees('3000'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.effectiveDays).toBe(3);
    expect(res.requestedDays).toBe(15);
    expect(res.warnings.some((w) => w.code === 'AMOUNT_TOO_SMALL_FOR_DAYS')).toBe(true);
  });

  it('an amount below one rounding step is paid in one go, with a warning', () => {
    const res = generateSchedule({
      totalPaise: rupees('400'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.effectiveDays).toBe(1);
    expect(res.installments[0].amountPaise).toBe(rupees('400'));
    expect(res.warnings.some((w) => w.code === 'ROUNDING_STEP_EXCEEDS_AMOUNT')).toBe(true);
  });

  it('one paisa is still payable', () => {
    const res = generateSchedule({
      totalPaise: 1n,
      days: 10,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.installments).toHaveLength(1);
    expect(res.installments[0].amountPaise).toBe(1n);
  });
});

describe('working-day placement', () => {
  it('never schedules on a Sunday, 2nd/4th Saturday or holiday', () => {
    const c = makeCalendar(['2026-08-19', '2026-08-20']);
    const res = generateSchedule({
      totalPaise: rupees('500000'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-15',
      calendar: c,
    });
    for (const i of res.installments) expect(isWorkingDay(i.dueDate, c)).toBe(true);
    expect(res.installments.map((i) => i.dueDate)).not.toContain('2026-08-19');
  });

  it('rolls a non-working approval date forward to the next working day', () => {
    const res = generateSchedule({
      totalPaise: rupees('100000'),
      days: 5,
      roundingPaise: STEP_1K,
      startDate: '2026-08-16', // Sunday
      calendar: cal,
    });
    expect(res.firstPayoutDate).toBe('2026-08-17');
  });

  it('can start from the day after approval when the branch prefers that', () => {
    const res = generateSchedule({
      totalPaise: rupees('100000'),
      days: 5,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
      startOnNextWorkingDay: true,
    });
    expect(res.firstPayoutDate).toBe('2026-08-18');
  });

  it('flags when weekends stretch the calendar span past the working-day count', () => {
    const res = generateSchedule({
      totalPaise: rupees('500000'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    expect(res.calendarSpanDays).toBeGreaterThan(15);
    expect(res.warnings.some((w) => w.code === 'HOLIDAYS_EXTEND_CALENDAR_SPAN')).toBe(true);
  });
});

describe('input validation refuses to guess', () => {
  const ok = {
    totalPaise: rupees('100000'),
    days: 10,
    roundingPaise: STEP_1K,
    startDate: '2026-08-17',
    calendar: cal,
  };
  it('rejects a zero or negative amount', () => {
    expect(() => generateSchedule({ ...ok, totalPaise: 0n })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...ok, totalPaise: -1n })).toThrow(ScheduleInputError);
  });
  it('rejects non-integral or non-positive day counts', () => {
    expect(() => generateSchedule({ ...ok, days: 0 })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...ok, days: 2.5 })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...ok, days: MAX_SCHEDULE_DAYS + 1 })).toThrow(
      ScheduleInputError,
    );
  });
  it('rejects a zero rounding step', () => {
    expect(() => generateSchedule({ ...ok, roundingPaise: 0n })).toThrow(ScheduleInputError);
  });
  it('rejects a CASH_CAP policy with no cap', () => {
    expect(() => generateSchedule({ ...ok, cashPolicy: { kind: 'CASH_CAP' } })).toThrow(
      ScheduleInputError,
    );
  });
  it('warns when the window exceeds bank policy', () => {
    const r = generateSchedule({ ...ok, days: 30, policyMaxDays: 15 });
    expect(r.warnings.some((w) => w.code === 'WINDOW_EXCEEDS_POLICY')).toBe(true);
  });
});

describe('rescheduling after reality diverges', () => {
  it('re-plans the remainder over the days that are left', () => {
    const deadline = deriveDeadline('2026-08-17', 15, cal);
    const res = rescheduleRemaining({
      remainingPaise: rupees('300000'),
      fromDate: '2026-08-25',
      deadlineDate: deadline,
      roundingPaise: STEP_1K,
      calendar: cal,
    });
    assertInvariants(res);
    expect(res.slaBreachUnavoidable).toBe(false);
    expect(res.lastPayoutDate <= deadline).toBe(true);
    expect(res.installments.reduce((a, i) => a + i.amountPaise, 0n)).toBe(rupees('300000'));
  });

  it('flags a breach that can no longer be avoided', () => {
    const res = rescheduleRemaining({
      remainingPaise: rupees('300000'),
      fromDate: '2026-09-20',
      deadlineDate: '2026-09-05',
      roundingPaise: STEP_1K,
      calendar: cal,
    });
    expect(res.slaBreachUnavoidable).toBe(true);
    expect(res.warnings[0].code).toBe('SLA_BREACH_UNAVOIDABLE');
    expect(res.warnings[0].severity).toBe('CRITICAL');
    // even in breach, the arithmetic still holds
    assertInvariants(res);
  });

  it('refuses to reschedule nothing', () => {
    expect(() =>
      rescheduleRemaining({
        remainingPaise: 0n,
        fromDate: '2026-08-25',
        deadlineDate: '2026-09-05',
        roundingPaise: STEP_1K,
        calendar: cal,
      }),
    ).toThrow(ScheduleInputError);
  });
});

describe('deriveDeadline', () => {
  it('returns the last working day of the promised window', () => {
    expect(deriveDeadline('2026-08-17', 15, cal)).toBe('2026-09-03');
  });
  it('is consistent with the schedule it describes', () => {
    const res = generateSchedule({
      totalPaise: rupees('500000'),
      days: 15,
      roundingPaise: STEP_1K,
      startDate: '2026-08-17',
      calendar: cal,
    });
    expect(res.lastPayoutDate).toBe(deriveDeadline('2026-08-17', 15, cal));
  });
});
