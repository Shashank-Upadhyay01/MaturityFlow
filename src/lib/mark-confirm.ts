import { formatPaise } from '@/lib/money';
import { leftoverOnPayoutDay, type PayoutDayView } from '@/lib/register-view';
import { formatDMY } from '@/lib/working-days';

/**
 * What the register's two marks ask before they move anything, and what the tick is about to do.
 *
 * The words live here rather than in the buttons because a confirmation that says "Are you sure?"
 * is worse than no confirmation at all — people learn to click through it and the guard becomes a
 * reflex. The only thing that makes someone read is the sentence naming the customer, the money
 * and the day, so that sentence is built in one place, held to one shape and tested.
 */

export type MarkAction = 'taken' | 'notTaken' | 'clearNotTaken';

export interface MarkSubject {
  /** As printed on the sheet. Blank on a row nobody has named yet. */
  customerName: string;
  /** The scheduled day the mark answers, ISO. */
  dueOn: string;
  /** What is at stake on that day, in paise: what the tick records, or what stays owed. */
  amountPaise: bigint;
}

export interface MarkConfirmCopy {
  /** The small heading above the question — which of the three acts this is. */
  kicker: string;
  /** The sentence that names the customer, the amount and the day. */
  question: string;
  /** What actually happens, including what does not happen. */
  detail: string;
  confirmLabel: string;
  /** Matches a `Button` variant: green for money going out, red for a no-show. */
  tone: 'success' | 'danger' | 'primary';
}

/** A row a clerk has not named yet still has to read as a sentence. */
function nameOf(customerName: string): string {
  return customerName.trim() || 'this row';
}

function rupees(paise: bigint): string {
  return formatPaise(paise, { decimals: false });
}

export function markConfirmCopy(action: MarkAction, subject: MarkSubject): MarkConfirmCopy {
  const who = nameOf(subject.customerName);
  const day = formatDMY(subject.dueOn);
  const amount = rupees(subject.amountPaise);

  if (action === 'taken') {
    return {
      kicker: 'Record as taken',
      question: `Record ${amount} as taken for ${who} for ${day}?`,
      detail:
        'This records money as paid out. A recorded payout is never un-ticked afterwards — ' +
        'correcting one is a reversal on the case page, with a reason attached.',
      confirmLabel: 'Record as taken',
      tone: 'success',
    };
  }

  if (action === 'notTaken') {
    return {
      kicker: 'Mark not taken',
      question: `Mark ${day} as not taken for ${who}?`,
      detail:
        `No money is recorded and nothing is written off — ${amount} stays owed and the day ` +
        'stays on the schedule. Clicking the cross again clears this mark.',
      confirmLabel: 'Mark not taken',
      tone: 'danger',
    };
  }

  return {
    kicker: 'Clear the not-taken mark',
    question: `Clear the not-taken mark on ${day} for ${who}?`,
    detail:
      'The day goes back to unanswered, as though nobody had looked at it yet. No money moves ' +
      `either way and ${amount} stays owed.`,
    confirmLabel: 'Clear the mark',
    tone: 'primary',
  };
}

export interface TickPlan {
  /** Paise this ✓ records. */
  totalPaise: bigint;
  /**
   * Of that, the part going out by transfer.
   *
   * Meaningful only when a figure was typed into Actual paid, because that is the case where the
   * client does the split itself. With nothing typed the server splits the day across the legs
   * the engine planned and this stays zero — read `needsReference`, not this, to decide whether
   * to ask for a UTR.
   */
  onlinePaise: bigint;
  /** Whether INV-4 will refuse the recording without a UTR / transfer reference. */
  needsReference: boolean;
}

/**
 * What the tick is about to record on a scheduled day.
 *
 * Two shapes, because the tick answers two different gestures. With nothing typed it is
 * `markInstalmentTaken`: the whole leftover, split by the server across the legs the engine
 * planned — so a day with any online leg at all is treated as needing a reference, which is the
 * conservative reading the register has always taken (the client cannot see how much of the cash
 * leg is already settled, and asking for a UTR that turns out to be unnecessary is cheaper than
 * a round-trip rejected on INV-4).
 *
 * With a figure typed into Actual paid it is `settleRegisterRow`: that figure, cash first up to
 * the day's cash leg and the spill online but never past the online leg. A customer clearing
 * three missed days hands the cashier notes, and calling that surplus "online" would demand a
 * UTR for money that never moved by transfer.
 */
export function tickPlanFor(day: PayoutDayView, typedRupees: bigint | null): TickPlan {
  if (typedRupees == null) {
    return {
      totalPaise: leftoverOnPayoutDay(day),
      onlinePaise: 0n,
      needsReference: BigInt(day.onlinePaise) > 0n,
    };
  }
  const legCash = BigInt(day.cashPaise) / 100n;
  const legOnline = BigInt(day.onlinePaise) / 100n;
  const spill = typedRupees > legCash ? typedRupees - legCash : 0n;
  const online = spill < legOnline ? spill : legOnline;
  return {
    totalPaise: typedRupees * 100n,
    onlinePaise: online * 100n,
    needsReference: online > 0n,
  };
}
