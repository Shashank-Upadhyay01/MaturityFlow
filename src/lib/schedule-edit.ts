/**
 * schedule-edit.ts — moving money between the days of an existing schedule.
 *
 * Pure, bigint-only, no I/O. The browser runs this on every keystroke to preview the result and
 * the server runs the SAME function on save, so the figure a clerk saw is the figure written.
 *
 * The rule: the difference spreads across the days AFTER the edited one. Days before it keep the
 * figures the branch has already planned cash against, and money that has actually gone out is
 * never rewritten.
 */

export interface EditableInstalment {
  id: string;
  seq: number;
  dueOn: string;
  amountPaise: bigint;
  /** cash + online already paid against this row. */
  paidPaise: bigint;
  isFinal: boolean;
}

export type RebalanceError =
  | 'NEGATIVE_AMOUNT'
  | 'EDITED_ROW_ALREADY_PAID'
  | 'AMOUNT_BELOW_ALREADY_PAID'
  | 'NO_LATER_UNPAID_DAYS'
  | 'AMOUNT_EXCEEDS_REMAINING'
  | 'ROW_NOT_FOUND';

export type RebalanceResult =
  | { ok: true; instalments: EditableInstalment[] }
  | { ok: false; error: RebalanceError; message: string };

/** Thrown when the arithmetic itself is wrong — never in response to clerk input. */
export class ScheduleEditIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleEditIntegrityError';
  }
}

const fail = (error: RebalanceError, message: string): RebalanceResult => ({
  ok: false,
  error,
  message,
});

/**
 * Set one day's amount and spread the difference over the later days.
 *
 * Returns a typed error for anything a clerk can do by accident — those need a message, not a
 * stack trace. It THROWS only if the result would not sum to what it started at, which is an
 * arithmetic bug and must be loud.
 */
export function rebalanceAfter(
  instalments: readonly EditableInstalment[],
  id: string,
  newAmountPaise: bigint,
  roundingPaise: bigint,
): RebalanceResult {
  if (newAmountPaise < 0n) {
    return fail('NEGATIVE_AMOUNT', 'A day cannot be a negative amount.');
  }
  const idx = instalments.findIndex((i) => i.id === id);
  if (idx < 0) return fail('ROW_NOT_FOUND', 'That day is not part of this schedule.');

  const target = instalments[idx];
  if (target.paidPaise >= target.amountPaise) {
    return fail('EDITED_ROW_ALREADY_PAID', 'This day has already been paid in full.');
  }
  if (newAmountPaise < target.paidPaise) {
    return fail(
      'AMOUNT_BELOW_ALREADY_PAID',
      'This day cannot go below what has already been handed over against it.',
    );
  }

  const startingTotal = instalments.reduce((a, i) => a + i.amountPaise, 0n);
  const next = instalments.map((i) => ({ ...i }));

  // delta > 0 => the edit freed money that the later days must take on.
  // delta < 0 => the edit needs money that must come out of the later days.
  const delta = target.amountPaise - newAmountPaise;
  next[idx].amountPaise = newAmountPaise;

  if (delta === 0n) return { ok: true, instalments: next };

  // Only later rows that still have something unpaid can move. A fully paid day is a fact.
  const movable = next.slice(idx + 1).filter((r) => r.paidPaise < r.amountPaise);
  if (movable.length === 0) {
    return fail(
      'NO_LATER_UNPAID_DAYS',
      'There is no later unpaid day to move the difference into. Edit an earlier day, or ' +
        'reschedule the case.',
    );
  }

  const step = roundingPaise > 0n ? roundingPaise : 1n;
  const n = BigInt(movable.length);

  if (delta < 0n) {
    // Money is needed. Each row can give up at most what it has not already paid out.
    let need = -delta;
    const headroom = movable.reduce((a, r) => a + (r.amountPaise - r.paidPaise), 0n);
    if (need > headroom) {
      return fail(
        'AMOUNT_EXCEEDS_REMAINING',
        'The later days do not hold enough to cover that increase.',
      );
    }

    // First pass: whole rounding steps, spread as evenly as the engine spreads its units, so the
    // days stay round numbers a cashier can actually count out.
    let extra = (need / step) % n;
    const per = (need / step) / n;
    for (const r of movable) {
      let take = per * step;
      if (extra > 0n) {
        take += step;
        extra -= 1n;
      }
      const spare = r.amountPaise - r.paidPaise;
      if (take > spare) take = spare;
      if (take <= 0n) continue;
      r.amountPaise -= take;
      need -= take;
    }
    // Second pass: the sub-step remainder, and anything a capped row could not give. Taken from
    // the back, so the days nearest the edit keep their shape.
    for (let k = movable.length - 1; k >= 0 && need > 0n; k--) {
      const r = movable[k];
      const spare = r.amountPaise - r.paidPaise;
      const take = spare < need ? spare : need;
      if (take <= 0n) continue;
      r.amountPaise -= take;
      need -= take;
    }
    if (need > 0n) {
      return fail(
        'AMOUNT_EXCEEDS_REMAINING',
        'The later days do not hold enough to cover that increase.',
      );
    }
  } else {
    // Money is being given away. Nothing caps how much a later day may grow.
    let give = delta;
    let extra = (give / step) % n;
    const per = (give / step) / n;
    for (const r of movable) {
      let add = per * step;
      if (extra > 0n) {
        add += step;
        extra -= 1n;
      }
      if (add <= 0n) continue;
      r.amountPaise += add;
      give -= add;
    }
    // Whatever cannot be expressed in whole steps lands on the last movable day — the same place
    // the engine parks its residue.
    if (give > 0n) {
      movable[movable.length - 1].amountPaise += give;
      give = 0n;
    }
  }

  const endingTotal = next.reduce((a, i) => a + i.amountPaise, 0n);
  if (endingTotal !== startingTotal) {
    throw new ScheduleEditIntegrityError(
      `Rebalance changed the total: ${startingTotal} became ${endingTotal}.`,
    );
  }
  for (const row of next) {
    if (row.amountPaise < 0n) {
      throw new ScheduleEditIntegrityError(`Rebalance produced a negative day on ${row.dueOn}.`);
    }
    if (row.amountPaise < row.paidPaise) {
      throw new ScheduleEditIntegrityError(
        `Rebalance put ${row.dueOn} below what was already paid against it.`,
      );
    }
  }

  return { ok: true, instalments: next };
}
