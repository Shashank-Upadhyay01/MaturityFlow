/**
 * payment-rules.ts — pure guards for recording a disbursement.
 *
 * Kept separate from the database action so the rules can be unit-tested exhaustively and
 * reused by the UI to disable the Save button before the server ever refuses it.
 *
 * INV-4: Σ(paid) can never exceed the maturity amount. Enforced here and again, under a row
 * lock, inside the transaction that writes the payment.
 */

import type { Paise } from './money';
import { formatPaise } from './money';

export type PayoutRejectionCode =
  | 'NON_POSITIVE_AMOUNT'
  | 'NEGATIVE_LEG'
  | 'EXCEEDS_INSTALMENT'
  | 'EXCEEDS_CASE_TOTAL'
  | 'INSTALMENT_ALREADY_SETTLED'
  | 'ONLINE_LEG_NEEDS_REFERENCE'
  | 'CASE_NOT_PAYABLE';

export interface PayoutAttempt {
  cashPaise: Paise;
  onlinePaise: Paise;
  /** UTR / NEFT / IMPS reference — mandatory whenever an online leg is present. */
  reference?: string | null;
}

export interface PayoutContext {
  instalmentAmountPaise: Paise;
  instalmentPaidPaise: Paise;
  casePaidTotalPaise: Paise;
  caseTotalPaise: Paise;
  caseIsPayable: boolean;
  /** Ops Head / CEO / CMD may exceed a single day's planned amount (never the case total). */
  allowExceedInstalment: boolean;
}

export type PayoutValidation =
  | { ok: true; totalPaise: Paise; settlesInstalment: boolean; settlesCase: boolean }
  | { ok: false; code: PayoutRejectionCode; message: string };

export function validatePayout(attempt: PayoutAttempt, ctx: PayoutContext): PayoutValidation {
  const { cashPaise, onlinePaise } = attempt;

  if (cashPaise < 0n || onlinePaise < 0n) {
    return { ok: false, code: 'NEGATIVE_LEG', message: 'Cash and online amounts cannot be negative.' };
  }

  const totalPaise = cashPaise + onlinePaise;
  if (totalPaise <= 0n) {
    return { ok: false, code: 'NON_POSITIVE_AMOUNT', message: 'Enter an amount greater than zero.' };
  }

  if (!ctx.caseIsPayable) {
    return {
      ok: false,
      code: 'CASE_NOT_PAYABLE',
      message: 'This case is not in a payable state. It must be approved and not on hold or cancelled.',
    };
  }

  if (onlinePaise > 0n && !attempt.reference?.trim()) {
    return {
      ok: false,
      code: 'ONLINE_LEG_NEEDS_REFERENCE',
      message: 'A UTR / transaction reference is required for the online portion.',
    };
  }

  const instalmentOutstanding = ctx.instalmentAmountPaise - ctx.instalmentPaidPaise;
  if (instalmentOutstanding <= 0n && !ctx.allowExceedInstalment) {
    return {
      ok: false,
      code: 'INSTALMENT_ALREADY_SETTLED',
      message: 'This instalment is already fully paid.',
    };
  }
  if (totalPaise > instalmentOutstanding && !ctx.allowExceedInstalment) {
    return {
      ok: false,
      code: 'EXCEEDS_INSTALMENT',
      message:
        `Only ${formatPaise(instalmentOutstanding)} is outstanding on this instalment. ` +
        'An Operations Head can authorise paying more than the planned daily amount.',
    };
  }

  // INV-4 — the hard ceiling nobody can override.
  const caseOutstanding = ctx.caseTotalPaise - ctx.casePaidTotalPaise;
  if (totalPaise > caseOutstanding) {
    return {
      ok: false,
      code: 'EXCEEDS_CASE_TOTAL',
      message:
        `This would pay out more than the maturity amount. Only ${formatPaise(caseOutstanding)} ` +
        'remains on this case.',
    };
  }

  return {
    ok: true,
    totalPaise,
    settlesInstalment: ctx.instalmentPaidPaise + totalPaise >= ctx.instalmentAmountPaise,
    settlesCase: ctx.casePaidTotalPaise + totalPaise >= ctx.caseTotalPaise,
  };
}

/** Progress summary shown on every case card. */
export interface CaseProgress {
  totalPaise: Paise;
  paidPaise: Paise;
  remainingPaise: Paise;
  paidCashPaise: Paise;
  paidOnlinePaise: Paise;
  percent: number;
  isComplete: boolean;
}

export function computeProgress(
  totalPaise: Paise,
  paidCashPaise: Paise,
  paidOnlinePaise: Paise,
): CaseProgress {
  const paidPaise = paidCashPaise + paidOnlinePaise;
  const remainingPaise = totalPaise - paidPaise;
  return {
    totalPaise,
    paidPaise,
    remainingPaise: remainingPaise > 0n ? remainingPaise : 0n,
    paidCashPaise,
    paidOnlinePaise,
    percent:
      totalPaise === 0n ? 0 : Number((paidPaise * 10_000n) / totalPaise) / 100,
    isComplete: paidPaise >= totalPaise,
  };
}

// ── Settling several days with one figure ────────────────────────────────────

/**
 * settlement-allocation — one amount at the counter, spread across the days it actually pays.
 *
 * The register has one "Paid today" box per customer, and it used to be bound to exactly one
 * instalment: today's. A customer who missed yesterday and came in today owing two days could
 * not be served from that box at all — the server refused anything above the single day's
 * planned figure, and if nothing was scheduled for today there was no box to type into.
 *
 * The fix is not to loosen the per-day ceiling. It is to stop pretending one receipt belongs to
 * one day. A cashier counts out one sum; this decides which days that sum clears, oldest first,
 * and the ledger keeps a row per day so the schedule still means what it says.
 *
 * Pure and bigint-only, like every other rule in this file: the browser runs it to enable the
 * Save button and the transaction runs it again under the case lock. They cannot disagree.
 */

export type SettlementRejectionCode =
  | 'NON_POSITIVE_AMOUNT'
  | 'NEGATIVE_LEG'
  | 'ONLINE_LEG_NEEDS_REFERENCE'
  | 'CASE_NOT_PAYABLE'
  | 'NOTHING_OUTSTANDING'
  | 'EXCEEDS_DUE_TODAY'
  | 'AHEAD_NEEDS_REASON'
  | 'EXCEEDS_CASE_TOTAL'
  | 'EXCEEDS_CASH_CAP';

/** One live instalment, as the allocator needs to see it. */
export interface SettleableInstalment {
  id: string;
  seq: number;
  dueOn: string;
  amountPaise: Paise;
  paidCashPaise: Paise;
  paidOnlinePaise: Paise;
}

export interface SettlementAttempt {
  cashPaise: Paise;
  onlinePaise: Paise;
  reference?: string | null;
  /** Required once the money reaches past today into days not yet due. */
  reason?: string | null;
}

export interface SettlementContext {
  /** Live instalments for the case — any order; this sorts them. */
  instalments: SettleableInstalment[];
  today: string;
  caseTotalPaise: Paise;
  casePaidTotalPaise: Paise;
  caseIsPayable: boolean;
  /**
   * Cash already handed to this customer today, across every day it settled.
   *
   * The cap is a limit on notes leaving the drawer on one date, not on bookkeeping, so clearing
   * three days of arrears in cash counts once against it — see `cashCapPerDayPaise`.
   */
  cashAlreadyPaidTodayPaise: Paise;
  /** Null when the case has no CASH_CAP policy. */
  cashCapPerDayPaise: Paise | null;
  /**
   * When set, only these days may take money. The clerk ticked them. Order is still oldest
   * first among the tick, so an unticked yesterday is left unpaid on purpose.
   */
  allowedInstalmentIds?: readonly string[];
}

/** What one instalment takes from the figure the cashier typed. */
export interface SettlementLine {
  instalmentId: string;
  seq: number;
  dueOn: string;
  cashPaise: Paise;
  onlinePaise: Paise;
  totalPaise: Paise;
  /** True when this allocation closes the day out. */
  settlesInstalment: boolean;
  /** True for a day that was not due yet — only reachable with a reason. */
  isAhead: boolean;
}

export type SettlementPlan =
  | {
      ok: true;
      totalPaise: Paise;
      lines: SettlementLine[];
      arrearsClearedPaise: Paise;
      paidAheadPaise: Paise;
      settlesCase: boolean;
    }
  | { ok: false; code: SettlementRejectionCode; message: string };

const outstandingOf = (i: SettleableInstalment): Paise =>
  i.amountPaise - i.paidCashPaise - i.paidOnlinePaise;

/**
 * Decide which days a single counter payment clears.
 *
 * Order is oldest first and it is not configurable. Arrears are what the customer is chasing and
 * what the sheet shows in red; clearing today while yesterday stays red would be a lie told to
 * whoever reads the register next.
 *
 * Cash is drawn down before online for the same reason `tenderSplit` does it: the drawer is the
 * constrained resource, so it settles the earliest days and the transfer covers the tail. Every
 * line is exact — no proportional split, so no rounding, so INV-1 stays trivially true.
 */
export function planSettlement(
  attempt: SettlementAttempt,
  ctx: SettlementContext,
): SettlementPlan {
  const { cashPaise, onlinePaise } = attempt;

  if (cashPaise < 0n || onlinePaise < 0n) {
    return { ok: false, code: 'NEGATIVE_LEG', message: 'Cash and online amounts cannot be negative.' };
  }
  const totalPaise = cashPaise + onlinePaise;
  if (totalPaise <= 0n) {
    return { ok: false, code: 'NON_POSITIVE_AMOUNT', message: 'Enter an amount greater than zero.' };
  }
  if (!ctx.caseIsPayable) {
    return {
      ok: false,
      code: 'CASE_NOT_PAYABLE',
      message: 'This case is not in a payable state. It must be approved and not on hold or cancelled.',
    };
  }
  if (onlinePaise > 0n && !attempt.reference?.trim()) {
    return {
      ok: false,
      code: 'ONLINE_LEG_NEEDS_REFERENCE',
      message: 'A UTR / transaction reference is required for the online portion.',
    };
  }

  // INV-4 first, because no reason and no role gets past it.
  const caseOutstanding = ctx.caseTotalPaise - ctx.casePaidTotalPaise;
  if (totalPaise > caseOutstanding) {
    return {
      ok: false,
      code: 'EXCEEDS_CASE_TOTAL',
      message:
        `This would pay out more than the maturity amount. Only ${formatPaise(caseOutstanding)} ` +
        'remains on this case.',
    };
  }

  if (ctx.cashCapPerDayPaise != null && cashPaise > 0n) {
    const capLeft = ctx.cashCapPerDayPaise - ctx.cashAlreadyPaidTodayPaise;
    if (cashPaise > capLeft) {
      return {
        ok: false,
        code: 'EXCEEDS_CASH_CAP',
        message:
          `Cash to this customer is capped at ${formatPaise(ctx.cashCapPerDayPaise)} a day and ` +
          `${formatPaise(capLeft > 0n ? capLeft : 0n)} is left today. ` +
          'Clearing several days at once does not raise the cap — pay the rest online.',
      };
    }
  }

  const allowed = ctx.allowedInstalmentIds ? new Set(ctx.allowedInstalmentIds) : null;
  const open = ctx.instalments
    .filter((i) => outstandingOf(i) > 0n && (!allowed || allowed.has(i.id)))
    .sort((a, b) => (a.dueOn === b.dueOn ? a.seq - b.seq : a.dueOn < b.dueOn ? -1 : 1));

  if (open.length === 0) {
    return {
      ok: false,
      code: 'NOTHING_OUTSTANDING',
      message: 'Every scheduled day on this case is already paid.',
    };
  }

  const dueNow = open.filter((i) => i.dueOn <= ctx.today);
  const capacityNow = dueNow.reduce((sum, i) => sum + outstandingOf(i), 0n);

  if (totalPaise > capacityNow) {
    const hasReason = Boolean(attempt.reason?.trim());
    if (!hasReason) {
      return {
        ok: false,
        code: capacityNow === 0n ? 'EXCEEDS_DUE_TODAY' : 'EXCEEDS_DUE_TODAY',
        message:
          capacityNow === 0n
            ? 'Nothing is due on this case today or earlier. Paying a future day early needs a reason.'
            : `${formatPaise(capacityNow)} is due today and earlier. Paying more than that settles ` +
              'days that have not come round yet — type a reason to authorise it.',
      };
    }
  }

  let cashLeft = cashPaise;
  let onlineLeft = onlinePaise;
  const lines: SettlementLine[] = [];
  let arrearsClearedPaise = 0n;
  let paidAheadPaise = 0n;

  for (const inst of open) {
    const want = cashLeft + onlineLeft;
    if (want <= 0n) break;
    const outstanding = outstandingOf(inst);
    const take = outstanding < want ? outstanding : want;

    const cash = cashLeft < take ? cashLeft : take;
    const online = take - cash;
    cashLeft -= cash;
    onlineLeft -= online;

    const isAhead = inst.dueOn > ctx.today;
    if (isAhead) paidAheadPaise += take;
    else if (inst.dueOn < ctx.today) arrearsClearedPaise += take;

    lines.push({
      instalmentId: inst.id,
      seq: inst.seq,
      dueOn: inst.dueOn,
      cashPaise: cash,
      onlinePaise: online,
      totalPaise: take,
      settlesInstalment: take >= outstanding,
      isAhead,
    });
  }

  // Belt and braces. `caseOutstanding` is the sum of what is open, so the loop cannot run dry
  // before the money is placed — but a schedule whose rows disagree with the case total would
  // otherwise lose a payment silently, and losing money silently is the one thing this system
  // may never do.
  const placed = lines.reduce((sum, l) => sum + l.totalPaise, 0n);
  if (placed !== totalPaise) {
    return {
      ok: false,
      code: 'NOTHING_OUTSTANDING',
      message:
        `Only ${formatPaise(placed)} of ${formatPaise(totalPaise)} could be matched to a scheduled ` +
        'day. The schedule and the case total disagree — nothing was recorded.',
    };
  }

  return {
    ok: true,
    totalPaise,
    lines,
    arrearsClearedPaise,
    paidAheadPaise,
    settlesCase: ctx.casePaidTotalPaise + totalPaise >= ctx.caseTotalPaise,
  };
}
