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
