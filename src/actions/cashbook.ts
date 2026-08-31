'use server';

import { revalidatePath } from 'next/cache';

import { fail, ok, toActionError, type ActionResult } from '@/actions/_result';
import { requireActor } from '@/lib/auth/session';
import {
  CASHBOOK_COMMITMENT_KINDS,
  CASHBOOK_ENTRY_CATEGORIES,
  CASHBOOK_ENTRY_CHANNELS,
  type CashbookCommitmentKind,
  type CashbookEntryCategory,
  type CashbookEntryChannel,
} from '@/lib/daily-cashbook';
import { parseRupeesToPaise } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { parseISODate } from '@/lib/working-days';
import {
  CashbookError,
  addCashbookCommitment,
  addCashbookEntry,
  confirmCashbookClose,
  getCashbookCommitmentResource,
  getCashbookEntryResource,
  reopenCashbookDay,
  requestCashbookClose,
  saveCashbookDay,
  setCashbookCommitmentSettled,
  updateCashbookCommitment,
  updateCashbookEntry,
  voidCashbookCommitment,
  voidCashbookEntry,
} from '@/services/cashbook-service';

function refreshCashbook(): void {
  revalidatePath('/cashbook');
  revalidatePath('/dashboard');
  revalidatePath('/reports');
}
function validDate(value: string, optional = false): string | null {
  const clean = value.trim();
  if (!clean && optional) return null;
  try {
    parseISODate(clean);
    return clean;
  } catch {
    throw new CashbookError('INVALID_ENTRY', 'Use a valid date in YYYY-MM-DD format.');
  }
}

function money(value: string): bigint {
  return parseRupeesToPaise(value.trim() || '0');
}

function positiveMoney(value: string): bigint {
  const parsed = parseRupeesToPaise(value);
  if (parsed <= 0n) throw new CashbookError('INVALID_ENTRY', 'Amount must be greater than zero.');
  return parsed;
}

function count(value: string, label: string): number {
  const clean = value.trim() || '0';
  if (!/^\d+$/.test(clean)) {
    throw new CashbookError('INVALID_ENTRY', `${label} must be a non-negative whole number.`);
  }
  const parsed = Number(clean);
  if (!Number.isSafeInteger(parsed) || parsed > 2_000_000_000) {
    throw new CashbookError('INVALID_ENTRY', `${label} is too large.`);
  }
  return parsed;
}

function category(value: string): CashbookEntryCategory {
  if ((CASHBOOK_ENTRY_CATEGORIES as readonly string[]).includes(value)) {
    return value as CashbookEntryCategory;
  }
  throw new CashbookError('INVALID_ENTRY', 'Choose a valid cashbook category.');
}

function channel(value: string): CashbookEntryChannel {
  if ((CASHBOOK_ENTRY_CHANNELS as readonly string[]).includes(value)) {
    return value as CashbookEntryChannel;
  }
  throw new CashbookError('INVALID_ENTRY', 'Choose cash or by account.');
}

function commitmentKind(value: string): CashbookCommitmentKind {
  if ((CASHBOOK_COMMITMENT_KINDS as readonly string[]).includes(value)) {
    return value as CashbookCommitmentKind;
  }
  throw new CashbookError('INVALID_COMMITMENT', 'Choose a valid named-item type.');
}

export async function saveCashbookDayAction(input: {
  branchId: string;
  date: string;
  expectedVersion: number;
  oldPortalTotal: string;
  fixedDeposit: string;
  newBusiness: string;
  membershipCollection: string;
  oldLoan: string;
  note500Count: string;
  note200Count: string;
  note100Count: string;
  note50Count: string;
  note20Count: string;
  note10Count: string;
  coins: string;
  notes: string;
}): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(input.date)!;
    assertCan(actor, 'cashbook.edit', { branchId: input.branchId });
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
      return fail('This cashbook version is invalid. Refresh and try again.', 'VERSION_CONFLICT');
    }
    const result = await saveCashbookDay(session, input.branchId, date, {
      expectedVersion: input.expectedVersion,
      oldPortalTotalPaise: money(input.oldPortalTotal),
      fixedDepositPaise: money(input.fixedDeposit),
      newBusinessPaise: money(input.newBusiness),
      membershipCollectionPaise: money(input.membershipCollection),
      oldLoanPaise: money(input.oldLoan),
      note500Count: count(input.note500Count, '₹500 note count'),
      note200Count: count(input.note200Count, '₹200 note count'),
      note100Count: count(input.note100Count, '₹100 note count'),
      note50Count: count(input.note50Count, '₹50 note count'),
      note20Count: count(input.note20Count, '₹20 note count'),
      note10Count: count(input.note10Count, '₹10 note count'),
      coinsPaise: money(input.coins),
      notes: input.notes,
    });
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function addCashbookEntryAction(input: {
  branchId: string;
  date: string;
  category: string;
  channel: string;
  amount: string;
  partyName?: string;
  reference?: string;
  note?: string;
}): Promise<ActionResult<{ id: string; version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(input.date)!;
    assertCan(actor, 'cashbook.edit', { branchId: input.branchId });
    const result = await addCashbookEntry(session, input.branchId, date, {
      category: category(input.category),
      channel: channel(input.channel),
      amountPaise: positiveMoney(input.amount),
      partyName: input.partyName,
      reference: input.reference,
      note: input.note,
    });
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateCashbookEntryAction(input: {
  id: string;
  category: string;
  channel: string;
  amount: string;
  partyName?: string;
  reference?: string;
  note?: string;
}): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const resource = await getCashbookEntryResource(input.id);
    if (!resource) return fail('Cashbook entry not found.', 'NOT_FOUND');
    assertCan(actor, 'cashbook.edit', { branchId: resource.branchId });
    const result = await updateCashbookEntry(session, input.id, {
      category: category(input.category),
      channel: channel(input.channel),
      amountPaise: positiveMoney(input.amount),
      partyName: input.partyName,
      reference: input.reference,
      note: input.note,
    });
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function voidCashbookEntryAction(
  id: string,
  reason: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const resource = await getCashbookEntryResource(id);
    if (!resource) return fail('Cashbook entry not found.', 'NOT_FOUND');
    assertCan(actor, 'cashbook.edit', { branchId: resource.branchId });
    const result = await voidCashbookEntry(session, id, reason);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function addCashbookCommitmentAction(input: {
  branchId: string;
  date: string;
  kind: string;
  amount: string;
  partyName: string;
  reference?: string;
  note?: string;
  dueOn?: string;
}): Promise<ActionResult<{ id: string; version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(input.date)!;
    assertCan(actor, 'cashbook.edit', { branchId: input.branchId });
    const result = await addCashbookCommitment(session, input.branchId, date, {
      kind: commitmentKind(input.kind),
      amountPaise: positiveMoney(input.amount),
      partyName: input.partyName,
      reference: input.reference,
      note: input.note,
      dueOn: validDate(input.dueOn ?? '', true),
    });
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateCashbookCommitmentAction(input: {
  id: string;
  kind: string;
  amount: string;
  partyName: string;
  reference?: string;
  note?: string;
  dueOn?: string;
}): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const resource = await getCashbookCommitmentResource(input.id);
    if (!resource) return fail('Named item not found.', 'NOT_FOUND');
    assertCan(actor, 'cashbook.edit', { branchId: resource.branchId });
    const result = await updateCashbookCommitment(session, input.id, {
      kind: commitmentKind(input.kind),
      amountPaise: positiveMoney(input.amount),
      partyName: input.partyName,
      reference: input.reference,
      note: input.note,
      dueOn: validDate(input.dueOn ?? '', true),
    });
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function setCashbookCommitmentSettledAction(
  id: string,
  settled: boolean,
  note?: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const resource = await getCashbookCommitmentResource(id);
    if (!resource) return fail('Named item not found.', 'NOT_FOUND');
    assertCan(actor, 'cashbook.edit', { branchId: resource.branchId });
    const result = await setCashbookCommitmentSettled(session, id, settled, note);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function voidCashbookCommitmentAction(
  id: string,
  reason: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const resource = await getCashbookCommitmentResource(id);
    if (!resource) return fail('Named item not found.', 'NOT_FOUND');
    assertCan(actor, 'cashbook.edit', { branchId: resource.branchId });
    const result = await voidCashbookCommitment(session, id, reason);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function requestCashbookCloseAction(
  branchId: string,
  dateInput: string,
  reason?: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(dateInput)!;
    assertCan(actor, 'cashbook.edit', { branchId });
    const result = await requestCashbookClose(session, branchId, date, reason);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function confirmCashbookCloseAction(
  branchId: string,
  dateInput: string,
  approve: boolean,
  note?: string,
): Promise<ActionResult<{ version: number; closeRevision: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(dateInput)!;
    assertCan(actor, 'cashbook.close', { branchId });
    const result = await confirmCashbookClose(session, branchId, date, approve, note);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}

export async function reopenCashbookDayAction(
  branchId: string,
  dateInput: string,
  reason: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const { session, actor } = await requireActor();
    const date = validDate(dateInput)!;
    assertCan(actor, 'cashbook.close', { branchId });
    const result = await reopenCashbookDay(session, branchId, date, reason);
    refreshCashbook();
    return ok(result);
  } catch (error) {
    return toActionError(error);
  }
}
