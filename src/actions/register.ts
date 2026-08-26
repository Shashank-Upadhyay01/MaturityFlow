'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { maturityCases, payoutInstalments } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { tryParseRupeesToPaise } from '@/lib/money';
import { assertCan, assertCanTypeRegister, roleCan, type Actor, type ResourceRef } from '@/lib/rbac';
import type { BulkTodayMode } from '@/lib/register-view';
import { cancelCase } from '@/services/case-service';
import {
  MAX_BULK_ROWS,
  loadCaseRefs,
  runBulk,
  type BulkOutcome,
  type CaseRef,
} from '@/services/register-bulk';
import { markInstalmentMissed, markInstalmentTaken, type Tender } from '@/services/payout-service';
import {
  MAX_BLANK_ROWS_PER_CALL,
  confirmCloseDay,
  createBlankRegisterRow,
  createBlankRegisterRows,
  reopenDay,
  requestCloseDay,
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
 * Scope a day, not a case.
 *
 * The two buttons hand back an instalment id, and the case it belongs to is looked up here
 * rather than taken from the client. A client that could name the case would only have to pair
 * its own case id with somebody else's instalment id to walk straight past the branch check.
 */
async function scopeByInstalment(instalmentId: string) {
  const [row] = await db
    .select({
      caseId: maturityCases.id,
      branchId: maturityCases.branchId,
      agentId: maturityCases.agentId,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(eq(payoutInstalments.id, instalmentId))
    .limit(1);
  return row;
}

/**
 * The guard for "may this actor type into this row?".
 *
 * Several different permissions land a person in the register — a cashier is there to record
 * payouts, an admin to import, a branch manager to edit — and the register is one grid, not five.
 * So the check is: hold *some* register-typing permission, and then be asserted against the
 * strongest one you actually hold, so that the scope check (branch, agent) still runs against a
 * real permission rather than a made-up one. Bulk edits go through the same gate as single cells.
 *
 * `assertCanTypeRegister` comes first and is not redundant. It used to fall back to asserting
 * `case.edit`, which an Agent holds for the form workflow — so a role meant to be read-only in the
 * sheet sailed through on its own rows. Ask the "may you type here at all?" question by name.
 */
function assertCanTypeRow(actor: Actor, c: ResourceRef) {
  assertCanTypeRegister(actor);
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
    assertCanTypeRegister(actor);
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
    assertCanTypeRegister(actor);
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

/**
 * Turn one of the sheet's empty rows into a real case, and write the first edit into it.
 *
 * The register always shows blank rows past the end of the real ones so a clerk can type
 * straight into the sheet. Those rows exist only in the browser — nothing is written until
 * somebody types, and then only the row they typed in. That is what keeps 100 waiting rows from
 * becoming 100 DRAFT cases burning case numbers and turning up in every export.
 *
 * Create and edit are two audited steps against the same case, in that order, exactly as if the
 * clerk had pressed "Add rows" and then typed — this is not a shortcut around either path.
 *
 * Two clerks typing into the same visual blank row get one row each. That is the honest outcome:
 * they each entered a different customer, and neither edit is lost.
 */
export async function createRegisterRowWithFieldsAction(
  branchId: string,
  patch: Parameters<typeof updateRegisterRow>[2],
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, actor } = await requireActor();
    assertCanTypeRegister(actor);
    assertCan(actor, 'case.create', { branchId });
    const id = await createBlankRegisterRow(session, branchId);
    await updateRegisterRow(session, id, patch);
    revalidate();
    return ok({ id });
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleFormSubmittedAction(caseId: string, submitted: boolean): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCanTypeRegister(actor);
    assertCan(actor, 'case.submit', c);
    await setFormSubmitted(session, caseId, submitted);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/*
 * `toggleApprovedAction` lived here, with `bulkSetApprovedAction` below it.
 *
 * Both flipped a case to APPROVED without generating anything. Under auto-scheduling that
 * produced a row the register showed as live forever with nothing ever due on it, and the
 * un-tick left any instalments already generated stranded behind a SUBMITTED status. A schedule
 * is made by submitting the row — `submitCase()` — and by nothing else. The Sched. column
 * reports the result; it does not set it.
 */

/**
 * "Taken" — the customer withdrew today's scheduled amount in full.
 *
 * Goes through `markInstalmentTaken`, which is the ordinary locked, INV-4-validated, audited
 * payout path. There is no faster route for the register: a click here and a payout typed on the
 * case page leave exactly the same trail.
 */
export async function markTakenAction(
  instalmentId: string,
  tender: Tender = 'SPLIT',
  reference: string | null = null,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scopeByInstalment(instalmentId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCanTypeRegister(actor);
    assertCan(actor, 'payout.record', c);
    await markInstalmentTaken(session, instalmentId, tender, reference);
    revalidate();
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * "Not taken" — nobody came for today's payment. `clear` undoes a mis-click.
 *
 * Gated on `payout.record` rather than on a register-typing permission: it is a statement about
 * what happened at the counter, and the person at the counter is the one who knows.
 */
export async function markNotTakenAction(
  instalmentId: string,
  clear = false,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await scopeByInstalment(instalmentId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCanTypeRegister(actor);
    assertCan(actor, 'payout.record', c);
    await markInstalmentMissed(session, instalmentId, { clear });
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
    if (!['ADMIN', 'CMD', 'CEO'].includes(actor.role)) {
      return fail('Only Admin, CMD or CEO can close the day', 'FORBIDDEN');
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
    if (!['ADMIN', 'CMD', 'CEO'].includes(actor.role)) {
      return fail('Only Admin, CMD or CEO can reopen a day', 'FORBIDDEN');
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
    assertCanTypeRegister(actor);
    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCan(actor, 'case.submit', ref);
      await setFormSubmitted(session, id, submitted);
    });
    return bulkResult(outcome);
  } catch (e) {
    return bulkFailure(e);
  }
}

/** Put every ticked row under one agent. */
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
