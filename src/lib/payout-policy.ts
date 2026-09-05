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

/**
 * Calendar days between the form going in and the approval date the sheet fills in for it.
 *
 * A default the office asked for, not a rule the schedule obeys: payouts are anchored on the
 * payment date and never on this. It exists so a case waiting to be looked at shows the date it
 * is expected by, instead of a blank cell nobody can chase.
 */
export const APPROVAL_LEAD_CALENDAR_DAYS = 3;

/**
 * Calendar days between the approval date and the day the payouts start.
 *
 * The office types the approval date; the payment date follows it by three days and the sheet
 * fills it in. Counted in CALENDAR days for the same reason the maturity gap is: "three days
 * after approval" is a promise a customer can check on a wall calendar. The clerk can still
 * overwrite the payment date afterwards — this is the default, not a lock.
 */
export const PAYMENT_LEAD_CALENDAR_DAYS = 3;

/**
 * The payment date an approval date implies.
 *
 * Deliberately NOT rolled onto the next working day. The office reads this as plain arithmetic —
 * approval on the 1st, payment on the 4th — and a date that silently jumped a Sunday would stop
 * matching what they wrote on the form. `scheduleAnchorFor` still rolls the first payout onto an
 * open day when the schedule is built, which is where that belongs.
 */
export function paymentFollowingApproval(approvalOn: ISODate): ISODate {
  return addDays(approvalOn, PAYMENT_LEAD_CALENDAR_DAYS);
}

/**
 * Is a typed approval date consistent with the two dates either side of it?
 *
 * An approval cannot precede the form that asked for it, and it cannot fall after the day the
 * counter starts paying. Both were already enforced when a clerk types the cell on the register;
 * the importer used to enforce neither and silently blanked the column instead, which is how a
 * row could arrive approved four weeks before it was submitted. One predicate so the two paths
 * cannot drift apart again.
 *
 * Returns null when the date is fine, otherwise which rule it breaks.
 */
export function approvalDateProblem(
  approvalOn: ISODate,
  formSubmittedOn: ISODate,
  paymentOn: ISODate | null,
): 'BEFORE_FORM' | 'AFTER_PAYMENT' | null {
  if (approvalOn < formSubmittedOn) return 'BEFORE_FORM';
  if (paymentOn && approvalOn > paymentOn) return 'AFTER_PAYMENT';
  return null;
}

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

/**
 * The day a case's schedule actually starts.
 *
 * `firstPayoutOn` answers "three days after maturity", which is the right answer only while the
 * maturity is still ahead of us. The live register carries cases that matured as long ago as 2024
 * and were never paid; anchoring those on their own maturity date would generate a schedule that
 * was overdue the moment it was written, with a deadline in the past and every instalment already
 * missed. So the anchor is the later of the promised date and today, rolled onto an open day.
 *
 * Pure: "today" is a parameter, never `Date.now()`. That is what lets the browser preview and the
 * server-persisted schedule agree.
 */
export function scheduleAnchorFor(
  maturityDate: ISODate,
  today: ISODate,
  calendar: WorkingDayCalendar,
): ISODate {
  const promised = firstPayoutOn(maturityDate, calendar);
  // `nextWorkingDay` returns its argument untouched when that day is already open, so a case whose
  // promised date has passed starts today when today is open and on the next open day when it is not.
  return promised >= today ? promised : nextWorkingDay(today, calendar);
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

/**
 * Window length that yields `payoutDays` instalments at this amount's cadence.
 *
 * The sheet's Days column is the number of days the customer can withdraw, not the processing
 * gap. ₹1 lakh+ at 12 → window 15 daily; below ₹1 lakh at 6 → alternate days inside that window.
 */
export function windowDaysForPayoutCount(maturityAmountPaise: bigint, payoutDays: number): number {
  const n = Math.max(1, Math.floor(payoutDays) || 1);
  const stride = strideFor(cadenceFor(maturityAmountPaise));
  const usable = stride === 1 ? n : n * stride - (stride - 1);
  return Math.max(MIN_WINDOW_DAYS, usable + PROCESSING_WORKING_DAYS);
}
