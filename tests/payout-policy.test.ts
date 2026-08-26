import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isWorkingDay, makeCalendar } from '../src/lib/working-days';
import {
  AUTO_APPROVAL_CALENDAR_DAYS,
  firstPayoutOn,
  scheduleAnchorFor,
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

describe('auto-approval: when the first payout lands', () => {
  const cal = makeCalendar();

  it('is three calendar days after the maturity date', () => {
    // Tue 01 Sep 2026 -> Fri 04 Sep. Sept 1-3 are the month-start cooldown anyway, and the
    // three-day gap lands past them, so both rules agree here.
    expect(firstPayoutOn('2026-09-01', cal)).toBe('2026-09-04');
  });

  it('rolls forward off a Sunday', () => {
    // Fri 04 Sep + 3 = Mon 07 Sep. Sun 06 is skipped by rolling, not counted around.
    expect(firstPayoutOn('2026-09-04', cal)).toBe('2026-09-07');
    // Thu 03 Sep + 3 = Sun 06 -> rolls to Mon 07.
    expect(firstPayoutOn('2026-09-03', cal)).toBe('2026-09-07');
  });

  it('rolls forward out of the month-start cooldown', () => {
    // Sat 29 Aug + 3 = Tue 01 Sep, which is closed for month start -> Fri 04 Sep.
    expect(firstPayoutOn('2026-08-29', cal)).toBe('2026-09-04');
    // Sun 30 Aug + 3 = Wed 02 Sep -> also closed -> Fri 04 Sep.
    expect(firstPayoutOn('2026-08-30', cal)).toBe('2026-09-04');
  });

  it('rolls forward off a declared holiday', () => {
    // 5 Sept is the FIRST Saturday, so it is open under the 2nd/4th rule and takes the rollover.
    expect(firstPayoutOn('2026-09-01', makeCalendar(['2026-09-04']))).toBe('2026-09-05');
    // Close the Saturday too and it carries on to the Monday.
    expect(firstPayoutOn('2026-09-01', makeCalendar(['2026-09-04', '2026-09-05']))).toBe('2026-09-07');
  });

  it('honours an admin opening the month', () => {
    const open = makeCalendar([], {}, ['2026-09']);
    // Sat 29 Aug + 3 = Tue 01 Sep, now open.
    expect(firstPayoutOn('2026-08-29', open)).toBe('2026-09-01');
  });

  it('the gap is never shorter than three days', () => {
    for (const d of ['2026-08-10', '2026-08-15', '2026-09-20', '2026-12-29', '2027-02-26']) {
      expect(daysBetween(d, firstPayoutOn(d, cal))).toBeGreaterThanOrEqual(3);
    }
  });

  it('always lands on a day the counter is open', () => {
    for (let i = 0; i < 400; i += 7) {
      const d = addDays('2026-01-01', i);
      expect(isWorkingDay(firstPayoutOn(d, cal), cal)).toBe(true);
    }
  });

  it('rejects a date it cannot read', () => {
    expect(() => firstPayoutOn('not-a-date', cal)).toThrow();
  });
});

describe('scheduleAnchorFor', () => {
  const cal = makeCalendar();

  it('is the ordinary first-payout date when the maturity is in the future', () => {
    // Maturity 20 Sept 2026, today 1 Sept -> 23 Sept, an ordinary Wednesday.
    expect(scheduleAnchorFor('2026-09-20', '2026-09-01', cal)).toBe('2026-09-23');
  });

  it('never schedules into the past', () => {
    // Matured June 2024 and never paid. It starts now, not in 2024.
    const anchor = scheduleAnchorFor('2024-06-22', '2026-09-10', cal);
    expect(anchor >= '2026-09-10').toBe(true);
    expect(anchor).toBe('2026-09-10'); // a Thursday, already open
  });

  it('rolls a today that is itself closed', () => {
    // Today is Sun 6 Sept 2026; a long-matured case starts Mon 7th.
    expect(scheduleAnchorFor('2024-06-22', '2026-09-06', cal)).toBe('2026-09-07');
    // Today is 1 Sept, inside the month-start cooldown -> 4 Sept.
    expect(scheduleAnchorFor('2024-06-22', '2026-09-01', cal)).toBe('2026-09-04');
  });

  it('keeps the three-day promise for a maturity that is only just past', () => {
    // Matured yesterday: the customer is still owed their three days.
    expect(scheduleAnchorFor('2026-09-09', '2026-09-10', cal)).toBe('2026-09-14');
  });

  it('always lands on an open day, and never before today', () => {
    for (let i = 0; i < 400; i += 11) {
      const maturity = addDays('2024-01-01', i);
      const anchor = scheduleAnchorFor(maturity, '2026-09-10', cal);
      expect(isWorkingDay(anchor, cal)).toBe(true);
      expect(anchor >= '2026-09-10').toBe(true);
    }
  });

  it('rejects a date it cannot read', () => {
    expect(() => scheduleAnchorFor('not-a-date', '2026-09-10', cal)).toThrow();
  });
});
