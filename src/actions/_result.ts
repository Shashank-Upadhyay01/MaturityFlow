import 'server-only';

import { ForbiddenError } from '@/lib/rbac';
import { UnauthenticatedError } from '@/lib/auth/session';
import { MoneyError } from '@/lib/money';
import { ScheduleInputError, ScheduleIntegrityError } from '@/lib/payout-engine';
import { WorkflowError } from '@/services/case-service';
import { PayoutError } from '@/services/payout-service';
import { CashbookError } from '@/services/cashbook-service';

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

export function fail(error: string, code?: string, fieldErrors?: Record<string, string>) {
  return { ok: false as const, error, code, fieldErrors };
}

export function ok(): { ok: true };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T) {
  return data === undefined ? { ok: true as const } : { ok: true as const, data };
}

/**
 * One place that turns a thrown domain error into a message a branch clerk can act on.
 * Unexpected errors are logged server-side and reported generically — a stack trace is
 * never leaked to the browser.
 */
export function toActionError(e: unknown): { ok: false; error: string; code?: string } {
  if (e instanceof UnauthenticatedError) {
    return fail('Your session has expired. Please sign in again.', 'UNAUTHENTICATED');
  }
  if (e instanceof ForbiddenError) return fail(e.message, e.reason);
  if (e instanceof WorkflowError) return fail(e.message, e.code);
  if (e instanceof PayoutError) return fail(e.message, e.code);
  if (e instanceof CashbookError) return fail(e.message, e.code);
  if (e instanceof MoneyError) return fail(e.message, e.code);
  if (e instanceof ScheduleInputError) return fail(e.message, 'SCHEDULE_INPUT');
  if (e instanceof ScheduleIntegrityError) {
    console.error('[SCHEDULE INTEGRITY]', e);
    return fail(
      'The payout schedule failed its own arithmetic check and was not saved. Nothing has changed. ' +
        'Report this immediately.',
      'SCHEDULE_INTEGRITY',
    );
  }
  if (e && typeof e === 'object' && 'code' in e) {
    const pg = e as { code?: string; constraint?: string; message?: string };
    if (pg.code === '23514') {
      // A CHECK constraint fired — the database itself refused the write.
      const friendly: Record<string, string> = {
        cases_no_overpayment: 'That payment would exceed the maturity amount.',
        inst_legs_reconcile: 'The cash and online split does not add up to the instalment.',
        txn_legs_reconcile: 'The cash and online amounts do not add up to the total.',
        txn_online_needs_reference: 'An online transfer needs a UTR / reference number.',
        cases_approval_after_submission: 'Approval date cannot be before the submission date.',
        cashbook_day_money_non_negative: 'Cashbook amounts cannot be negative.',
        cashbook_day_counts_non_negative: 'Note counts cannot be negative.',
        cashbook_entry_amount_positive: 'Entry amount must be greater than zero.',
        cashbook_entry_cash_only_outflows: 'Opening balance, withdrawals and expenses must use cash.',
        cashbook_commitment_amount_positive: 'Named-item amount must be greater than zero.',
        cashbook_commitment_needs_name: 'A named item needs a person or customer name.',
      };
      return fail(friendly[pg.constraint ?? ''] ?? 'That change breaks a data-integrity rule.', pg.constraint);
    }
    if (pg.code === '23505') {
      const constraint = pg.constraint ?? '';
      const friendly: Record<string, string> = {
        users_email_uq: 'That email is already in use.',
        users_username_uq: 'That username is already taken.',
        users_employee_code_uq: 'That employee code is already in use.',
      };
      return fail(friendly[constraint] ?? 'That record already exists.', 'DUPLICATE');
    }
  }
  console.error('[ACTION ERROR]', e);
  return fail('Something went wrong. Nothing was saved. Please try again.', 'UNKNOWN');
}
