'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { maturityCases } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { tryParseRupeesToPaise } from '@/lib/money';
import { assertCan, canTypeRegister, roleCan, type Actor, type ResourceRef } from '@/lib/rbac';
import type { BulkTodayMode } from '@/lib/register-view';
import { cancelCase } from '@/services/case-service';
import {
  MAX_BULK_ROWS,
  loadCaseRefs,
  runBulk,
  type BulkOutcome,
  type CaseRef,
} from '@/services/register-bulk';
import {
  MAX_BLANK_ROWS_PER_CALL,
  confirmCloseDay,
  createBlankRegisterRow,
  createBlankRegisterRows,
  markGiven,
  reopenDay,
  requestCloseDay,
  setApproved,
  setDayCash,
  setFormSubmitted,
  setTodayAmount,
  updateRegisterRow,
} from '@/services/register-service';
import { fail, ok, toActionError, type ActionResult } from './_result';

function revalidate() {
  revalidatePath('/maturities');
  revalidatePath('/cash-planner');
  revalidatePath('/dashboard');
  revalidatePath('/payouts');
}

async function scope(caseId: string) {
  const [c] = await db
    .select({ branchId: maturityCases.branchId, agentId: maturityCases.agentId })
    .from(maturityCases)
    .where(eq(maturityCases.id, caseId))
    .limit(1);
  return c;
}

/**
 * The guard for "may this actor type into this row?".
 *
 * Several different permissions land a person in the register — a cashier is there to record
 * payouts, an admin to import, a branch manager to edit — and the register is one grid, not five.
 * So the check is: hold *some* register-typing permission, and then be asserted against the
 * strongest one you actually hold, so that the scope check (branch, agent) still runs against a
 * real permission rather than a made-up one. Bulk edits go through the same gate as single cells.
 */
function assertCanTypeRow(actor: Actor, c: ResourceRef) {
  if (!canTypeRegister(actor.role)) {
    assertCan(actor, 'case.edit', c);
    return;
  }
  assertCan(
    actor,
    roleCan(actor.role, 'case.edit')
      ? 'case.edit'
      : roleCan(actor.role, 'payout.record')
        ? 'payout.record'
        : roleCan(actor.role, 'schedule.override')
          ? 'schedule.override'
          : roleCan(actor.role, 'data.import')
            ? 'data.import'
            : 'case.create',
    c,
  );
}

/** Shared front door for every bulk action: authenticate, sanity-check the list, load scope. */
async function openBulk(caseIds: string[]) {
  const { session, actor } = await requireActor();
  const ids = [...new Set(caseIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (ids.length === 0) throw new BulkInputError('Select at least one row first.');
  if (ids.length > MAX_BULK_ROWS) {
    throw new BulkInputError(`You can act on at most ${MAX_BULK_ROWS} rows at a time.`);
  }
  const refs = await loadCaseRefs(ids);
  return { session, actor, ids, refs };
}

class BulkInputError extends Error {}

/** Turn a per-row outcome into the one result shape the toolbar knows how to report. */
function bulkResult(outcome: BulkOutcome): ActionResult<BulkOutcome> {
  revalidate();
  return ok(outcome);
}

function bulkFailure(e: unknown): ActionResult<BulkOutcome> {
  if (e instanceof BulkInputError) return fail(e.message, 'VALIDATION');
  return toActionError(e);
}

export async function addRegisterRowAction(branchId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'case.create', { branchId });
    const id = await createBlankRegisterRow(session, branchId);
    revalidate();
    return ok({ id });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Add several blank rows at once.
 *
 * The count comes from a text box, so it arrives as whatever the clerk typed. It is clamped
 * server-side as well as in the UI — never trust the browser with a loop bound.
 */
export async function addRegisterRowsAction(
  branchId: string,
  count: number,
): Promise<ActionResult<{ ids: string[]; added: number }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'case.create', { branchId });
    const n = Number.isFinite(count) ? Math.floor(count) : 1;
    if (n < 1) return fail('Enter how many rows to add.', 'VALIDATION');
    if (n > MAX_BLANK_ROWS_PER_CALL) {
      return fail(`You can add at most ${MAX_BLANK_ROWS_PER_CALL} rows at a time.`, 'VALIDATION');
    }
    const ids = await createBlankRegisterRows(session, branchId, n);
    revalidate();
    return ok({ ids, added: ids.length });
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveRegisterFieldsAction(
  caseId: string,
  patch: Parameters<typeof updateRegisterRow>[2],
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCanTypeRow(actor, c);
    await updateRegisterRow(session, caseId, patch);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleFormSubmittedAction(caseId: string, submitted: boolean): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCan(actor, 'case.submit', c);
    await setFormSubmitted(session, caseId, submitted);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleApprovedAction(caseId: string, approved: boolean): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCan(actor, 'case.approve', c);
    await setApproved(session, caseId, approved);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function markGivenAction(
  caseId: string,
  mode: 'CASH' | 'ONLINE' | 'SPLIT',
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCan(actor, 'payout.record', c);
    await markGiven(session, caseId, mode);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveDayCashAction(
  branchId: string,
  date: string,
  cashInHand: string,
  onlinePlanned: string,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'cash.setOpening', { branchId });
    await setDayCash(session, branchId, date, cashInHand, onlinePlanned);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function requestCloseDayAction(branchId: string, date: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (actor.role === 'ADMIN') {
      assertCan(actor, 'settings.manage', { branchId });
    } else {
      assertCan(actor, 'payout.record', { branchId });
    }
    await requestCloseDay(session, branchId, date);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function confirmCloseDayAction(
  branchId: string,
  date: string,
  approve: boolean,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!['ADMIN', 'OPS_HEAD', 'CMD', 'CEO'].includes(actor.role)) {
      return fail('Only Admin or Operations Head can close the day', 'FORBIDDEN');
    }
    await confirmCloseDay(session, branchId, date, approve);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function reopenDayAction(branchId: string, date: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!['ADMIN', 'OPS_HEAD', 'CMD', 'CEO'].includes(actor.role)) {
      return fail('Only Admin or Operations Head can reopen a day', 'FORBIDDEN');
    }
    await reopenDay(session, branchId, date);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ── Bulk actions on the ticked rows ────────────────────────────────────────
//
// Every one of these takes the SAME permission as its single-row equivalent and re-checks it per
// row, because a selection can span branches for an HQ user and scope is a per-row question. The
// client sends ids and an intent; it never sends the resulting amounts.

/**
 * Remove the ticked rows from the Register.
 *
 * "Remove" is a cancellation, not a delete. The case, its events and its audit trail survive —
 * `listRegister()` simply stops returning CANCELLED rows, so the sheet is clean and the history
 * is intact. A row with money already paid against it cannot be cancelled at all; those come back
 * in `failed` with the reason, so the clerk sees exactly which ones stayed and why.
 */
export async function removeRegisterRowsAction(
  caseIds: string[],
  reason: string,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor, ids, refs } = await openBulk(caseIds);
    const why = reason?.trim() || 'Removed from register';
    const outcome = await runBulk(ids, refs, async (id, ref: CaseRef) => {
      assertCan(actor, 'case.cancel', ref);
      await cancelCase(session, id, why);
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}

/**
 * Set today's withdrawable amount across the ticked rows.
 *
 * `mode` is a rule, not a number — see `setTodayAmount()`. The only number that ever crosses is
 * the fixed amount for mode `'amount'`, and it is parsed here and clamped per row on the server.
 */
export async function bulkSetTodayAction(
  caseIds: string[],
  mode: BulkTodayMode,
  amountRupees?: string,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor, ids, refs } = await openBulk(caseIds);
    let amountPaise: bigint | undefined;
    if (mode === 'amount') {
      amountPaise = tryParseRupeesToPaise(amountRupees ?? '') ?? undefined;
      if (amountPaise == null) throw new BulkInputError('Enter an amount in rupees.');
      if (amountPaise <= 0n) throw new BulkInputError('Amount must be greater than zero.');
    }
    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCanTypeRow(actor, ref);
      await setTodayAmount(session, id, mode, amountPaise);
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}

/** Tick or untick "form in" across the ticked rows. */
export async function bulkSetFormSubmittedAction(
  caseIds: string[],
  submitted: boolean,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor, ids, refs } = await openBulk(caseIds);
    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCan(actor, 'case.submit', ref);
      await setFormSubmitted(session, id, submitted);
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}

/** Approve or un-approve the ticked rows. */
export async function bulkSetApprovedAction(
  caseIds: string[],
  approved: boolean,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor, ids, refs } = await openBulk(caseIds);
    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCan(actor, 'case.approve', ref);
      await setApproved(session, id, approved);
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}

/**
 * Move the ticked rows to one agent.
 *
 * Routed through `updateRegisterRow` so it behaves exactly like typing the agent's name into the
 * cell — same matching, same audit line, and the customer record follows the case.
 */
export async function bulkAssignAgentAction(
  caseIds: string[],
  agentName: string,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor, ids, refs } = await openBulk(caseIds);
    const name = agentName?.trim();
    if (!name) throw new BulkInputError('Choose an agent first.');
    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCanTypeRow(actor, ref);
      await updateRegisterRow(session, id, { agentName: name });
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}
