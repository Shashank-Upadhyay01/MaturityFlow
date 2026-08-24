/**
 * payout-policy.ts — who gets paid how often.
 *
 * Deliberately NOT part of payout-engine.ts. The engine is mechanical arithmetic and must stay
 * policy-free: if the ₹1 lakh rule ever moves, that must not be able to reach the code that
 * splits money. Pure, no I/O, bigint-only.
 */

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

export type Cadence = 'DAILY' | 'ALTERNATE';

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
