/**
 * payout-policy.ts — who gets paid how often.
 *
 * Deliberately NOT part of payout-engine.ts. The engine is mechanical arithmetic and must stay
 * policy-free: if the ₹1 lakh rule ever moves, that must not be able to reach the code that
 * splits money. Pure, no I/O, bigint-only.
 */

import { addDays, nextWorkingDay, type ISODate, type WorkingDayCalendar } from './working-days';

/**
 * At or above this, a maturity is a "large" case: paid every working day and listed on the
 * priority sheet. Below it, payouts fall on alternate working days.
 *
 * Inclusive on purpose — a maturity of exactly ₹1,00,000 is a large case.
 */
export const LARGE_CASE_THRESHOLD_PAISE = 10_000_000n;

/**
 * Working days after approval that carry no payout.
 *
 * The form is checked, the schedule signed off and the cash arranged before a rupee moves, so
 * the window opens on the fourth working day. A constant, not a branch setting — see the spec's
 * non-goals before making it configurable.
 */
export const PROCESSING_WORKING_DAYS = 3;

/**
 * The shortest window that can actually pay anything: the processing days plus one payout day.
 * Validate against this at input, so a case cannot be created that can never be approved.
 */
export const MIN_WINDOW_DAYS = PROCESSING_WORKING_DAYS + 1;

export type Cadence = 'DAILY' | 'ALTERNATE';

/**
 * Calendar days between a customer's maturity date and their first payout.
 *
 * This is the window that used to be a human approving a form. It is deliberately counted in
 * CALENDAR days, not working days: "three days after your maturity" is a promise a customer can
 * check on a wall calendar, and a Friday maturity should not quietly become a following-Wednesday
 * payout because a weekend and a 2nd Saturday fell in between.
 */
export const AUTO_APPROVAL_CALENDAR_DAYS = 3;

export class PayoutPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutPolicyError';
  }
}

/** Large enough to be paid daily and tracked on the priority sheet. */
export function isPriorityCase(maturityAmountPaise: bigint): boolean {
  return maturityAmountPaise >= LARGE_CASE_THRESHOLD_PAISE;
}

export function cadenceFor(maturityAmountPaise: bigint): Cadence {
  return isPriorityCase(maturityAmountPaise) ? 'DAILY' : 'ALTERNATE';
}

/** How many working days apart consecutive payouts sit. */
export function strideFor(cadence: Cadence): 1 | 2 {
  return cadence === 'DAILY' ? 1 : 2;
}

/**
 * The day a maturity's first payout falls on, with nobody approving anything.
 *
 * Maturity date + three calendar days, then rolled forward to the next day the counter is
 * actually open — past a Sunday, a declared holiday, or the month-start cooldown. Rolling rather
 * than counting is what keeps the promise honest: the gap is never less than three days, and the
 * date it lands on is always payable.
 */
export function firstPayoutOn(maturityDate: ISODate, calendar: WorkingDayCalendar): ISODate {
  return nextWorkingDay(addDays(maturityDate, AUTO_APPROVAL_CALENDAR_DAYS), calendar);
}

export interface PayoutPlan {
  cadence: Cadence;
  /** Working days after approval with no payout. */
  processingDays: number;
  /** How many instalments the schedule should have. */
  payoutDays: number;
  /** Working days between consecutive payouts. */
  stride: 1 | 2;
}

/**
 * Turn an amount and a window into the shape of its schedule.
 *
 * `windowDays` is the TOTAL window counted in working days and inclusive of the approval day —
 * not the number of payout days. With the default 15 and 3 processing days, a large case gets 12
 * daily payouts and a small one gets 6 on alternate days, both finishing inside the same window.
 */
export function payoutPlanFor(
  maturityAmountPaise: bigint,
  windowDays: number,
  processingDays: number = PROCESSING_WORKING_DAYS,
): PayoutPlan {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new PayoutPolicyError(
      `windowDays must be a whole number of at least 1, got ${windowDays}`,
    );
  }
  if (!Number.isInteger(processingDays) || processingDays < 0) {
    throw new PayoutPolicyError(
      `processingDays must be a whole number of at least 0, got ${processingDays}`,
    );
  }

  const usableDays = windowDays - processingDays;
  if (usableDays < 1) {
    throw new PayoutPolicyError(
      `A ${windowDays}-working-day window with ${processingDays} processing days leaves no day ` +
        'to pay on. Widen the window or reduce the processing days.',
    );
  }

  const cadence = cadenceFor(maturityAmountPaise);
  const stride = strideFor(cadence);
  const payoutDays = cadence === 'DAILY' ? usableDays : Math.ceil(usableDays / 2);

  // The window has to be able to hold what we just planned. This cannot fail with the arithmetic
  // above; it is here so that it cannot start failing silently if the arithmetic changes.
  const lastOffset = (payoutDays - 1) * stride;
  if (lastOffset > usableDays - 1) {
    throw new PayoutPolicyError(
      `${payoutDays} payouts at stride ${stride} need ${lastOffset + 1} working days but only ` +
        `${usableDays} are inside the window.`,
    );
  }

  return { cadence, processingDays, payoutDays, stride };
}
