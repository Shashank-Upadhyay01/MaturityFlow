import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, type Tx } from '@/db';
import {
  branches,
  cashbookCommitments,
  cashbookDays,
  cashbookEntries,
  type CashbookCommitment,
  type CashbookCommitmentKind,
  type CashbookDay,
  type CashbookEntry,
  type CashbookEntryCategory,
  type CashbookEntryChannel,
} from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit';
import {
  CASHBOOK_CATEGORY_META,
  CASHBOOK_COMMITMENT_META,
  calculateDailyCashbook,
  type CashbookDayFigures,
} from '@/lib/daily-cashbook';
import { newId } from '@/lib/id';

export type CashbookErrorCode =
  | 'NOT_FOUND'
  | 'DAY_LOCKED'
  | 'CLOSE_PENDING'
  | 'VERSION_CONFLICT'
  | 'INVALID_ENTRY'
  | 'INVALID_COMMITMENT'
  | 'INVALID_STATE'
  | 'REASON_REQUIRED'
  | 'EMPTY_DAY';

export class CashbookError extends Error {
  constructor(
    readonly code: CashbookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CashbookError';
  }
}

export interface SaveCashbookDayInput extends CashbookDayFigures {
  notes: string | null;
  expectedVersion: number;
}

export interface CashbookEntryInput {
  category: CashbookEntryCategory;
  channel: CashbookEntryChannel;
  amountPaise: bigint;
  partyName?: string | null;
  reference?: string | null;
  note?: string | null;
}

export interface CashbookCommitmentInput {
  kind: CashbookCommitmentKind;
  amountPaise: bigint;
  partyName: string;
  reference?: string | null;
  note?: string | null;
  dueOn?: string | null;
}

type Resource = { branchId: string; date: string; cashbookDayId: string };

const textOrNull = (value?: string | null): string | null => {
  const clean = value?.trim();
  return clean ? clean : null;
};

function figuresOf(day: CashbookDay): CashbookDayFigures {
  return {
    oldPortalTotalPaise: day.oldPortalTotalPaise,
    fixedDepositPaise: day.fixedDepositPaise,
    newBusinessPaise: day.newBusinessPaise,
    membershipCollectionPaise: day.membershipCollectionPaise,
    oldLoanPaise: day.oldLoanPaise,
    note500Count: day.note500Count,
    note200Count: day.note200Count,
    note100Count: day.note100Count,
    note50Count: day.note50Count,
    note20Count: day.note20Count,
    note10Count: day.note10Count,
    coinsPaise: day.coinsPaise,
  };
}

function assertEditable(day: CashbookDay): void {
  if (day.status === 'CLOSED') {
    throw new CashbookError('DAY_LOCKED', 'This cashbook is closed. An authorised user must reopen it first.');
  }
  if (day.status === 'CLOSE_REQUESTED') {
    throw new CashbookError(
      'CLOSE_PENDING',
      'This cashbook is waiting for close approval. Reject or reopen the request before editing it.',
    );
  }
}

function validateEntry(input: CashbookEntryInput): void {
  if (input.amountPaise <= 0n) {
    throw new CashbookError('INVALID_ENTRY', 'Entry amount must be greater than zero.');
  }
  if (
    ['WITHDRAWAL', 'EXPENSE', 'OPENING_BALANCE'].includes(input.category) &&
    input.channel !== 'CASH'
  ) {
    throw new CashbookError(
      'INVALID_ENTRY',
      `${CASHBOOK_CATEGORY_META[input.category].label} is cash-only in this cashbook.`,
    );
  }
}

function validateCommitment(input: CashbookCommitmentInput): void {
  if (input.amountPaise <= 0n) {
    throw new CashbookError('INVALID_COMMITMENT', 'Amount must be greater than zero.');
  }
  if (!input.partyName.trim()) {
    throw new CashbookError(
      'INVALID_COMMITMENT',
      `${CASHBOOK_COMMITMENT_META[input.kind].label} needs a person or customer name.`,
    );
  }
}

async function ensureDayLocked(
  tx: Tx,
  actor: SessionUser,
  branchId: string,
  date: string,
): Promise<CashbookDay> {
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);
  if (!branch) throw new CashbookError('NOT_FOUND', 'Branch not found.');

  await tx
    .insert(cashbookDays)
    .values({
      id: newId('cday'),
      branchId,
      date,
      createdById: actor.id,
      updatedById: actor.id,
    })
    .onConflictDoNothing({ target: [cashbookDays.branchId, cashbookDays.date] });

  const [day] = await tx
    .select()
    .from(cashbookDays)
    .where(and(eq(cashbookDays.branchId, branchId), eq(cashbookDays.date, date)))
    .for('update')
    .limit(1);
  if (!day) throw new CashbookError('NOT_FOUND', 'Cashbook day could not be created.');
  return day;
}

async function lockDayById(tx: Tx, dayId: string): Promise<CashbookDay> {
  const [day] = await tx
    .select()
    .from(cashbookDays)
    .where(eq(cashbookDays.id, dayId))
    .for('update')
    .limit(1);
  if (!day) throw new CashbookError('NOT_FOUND', 'Cashbook day not found.');
  return day;
}

async function bumpDay(tx: Tx, day: CashbookDay, actor: SessionUser): Promise<number> {
  const [updated] = await tx
    .update(cashbookDays)
    .set({
      version: sql`${cashbookDays.version} + 1`,
      updatedById: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(cashbookDays.id, day.id))
    .returning({ version: cashbookDays.version });
  return updated.version;
}

async function loadTotals(tx: Tx, day: CashbookDay) {
  const entryRows = await tx
    .select({
      category: cashbookEntries.category,
      channel: cashbookEntries.channel,
      amountPaise: cashbookEntries.amountPaise,
    })
    .from(cashbookEntries)
    .where(and(eq(cashbookEntries.cashbookDayId, day.id), isNull(cashbookEntries.voidedAt)));
  const commitmentRows = await tx
    .select({ kind: cashbookCommitments.kind, amountPaise: cashbookCommitments.amountPaise })
    .from(cashbookCommitments)
    .where(and(eq(cashbookCommitments.cashbookDayId, day.id), isNull(cashbookCommitments.voidedAt)));

  return {
    totals: calculateDailyCashbook(entryRows, figuresOf(day), commitmentRows),
    entryCount: entryRows.length,
    commitmentCount: commitmentRows.length,
  };
}

function jsonSafe(value: unknown): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  ) as Record<string, unknown>;
}

async function locateEntry(id: string): Promise<Resource | null> {
  const [row] = await db
    .select({
      branchId: cashbookDays.branchId,
      date: cashbookDays.date,
      cashbookDayId: cashbookEntries.cashbookDayId,
    })
    .from(cashbookEntries)
    .innerJoin(cashbookDays, eq(cashbookDays.id, cashbookEntries.cashbookDayId))
    .where(eq(cashbookEntries.id, id))
    .limit(1);
  return row ?? null;
}

async function locateCommitment(id: string): Promise<Resource | null> {
  const [row] = await db
    .select({
      branchId: cashbookDays.branchId,
      date: cashbookDays.date,
      cashbookDayId: cashbookCommitments.cashbookDayId,
    })
    .from(cashbookCommitments)
    .innerJoin(cashbookDays, eq(cashbookDays.id, cashbookCommitments.cashbookDayId))
    .where(eq(cashbookCommitments.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCashbookEntryResource(id: string): Promise<Resource | null> {
  return locateEntry(id);
}

export async function getCashbookCommitmentResource(id: string): Promise<Resource | null> {
  return locateCommitment(id);
}

export async function saveCashbookDay(
  actor: SessionUser,
  branchId: string,
  date: string,
  input: SaveCashbookDayInput,
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const day = await ensureDayLocked(tx, actor, branchId, date);
    assertEditable(day);
    if (day.version !== input.expectedVersion) {
      throw new CashbookError(
        'VERSION_CONFLICT',
        'Someone else changed this cashbook. The latest values have been loaded; review and save again.',
      );
    }

    const before = { ...figuresOf(day), notes: day.notes, version: day.version };
    const { expectedVersion: _expectedVersion, notes, ...figures } = input;
    const [updated] = await tx
      .update(cashbookDays)
      .set({
        ...figures,
        notes: textOrNull(notes),
        version: day.version + 1,
        updatedById: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(cashbookDays.id, day.id))
      .returning();

    await writeAudit(tx, actor, {
      action: 'cashbook.day_saved',
      entity: 'CashbookDay',
      entityId: day.id,
      branchId,
      summary: `Cash count and manual totals saved for ${date}`,
      before,
      after: { ...figuresOf(updated), notes: updated.notes, version: updated.version },
    });
    return { version: updated.version };
  });
}

export async function addCashbookEntry(
  actor: SessionUser,
  branchId: string,
  date: string,
  input: CashbookEntryInput,
): Promise<{ id: string; version: number }> {
  validateEntry(input);
  return db.transaction(async (tx) => {
    const day = await ensureDayLocked(tx, actor, branchId, date);
    assertEditable(day);
    const id = newId('centry');
    const row = {
      id,
      cashbookDayId: day.id,
      category: input.category,
      channel: input.channel,
      amountPaise: input.amountPaise,
      partyName: textOrNull(input.partyName),
      reference: textOrNull(input.reference),
      note: textOrNull(input.note),
      createdById: actor.id,
      updatedById: actor.id,
    };
    await tx.insert(cashbookEntries).values(row);
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.entry_added',
      entity: 'CashbookEntry',
      entityId: id,
      branchId,
      summary: `${CASHBOOK_CATEGORY_META[input.category].label} entry added for ${date}`,
      after: row,
    });
    return { id, version };
  });
}

export async function updateCashbookEntry(
  actor: SessionUser,
  id: string,
  input: CashbookEntryInput,
): Promise<{ version: number }> {
  validateEntry(input);
  const located = await locateEntry(id);
  if (!located) throw new CashbookError('NOT_FOUND', 'Cashbook entry not found.');

  return db.transaction(async (tx) => {
    const day = await lockDayById(tx, located.cashbookDayId);
    assertEditable(day);
    const [entry] = await tx
      .select()
      .from(cashbookEntries)
      .where(and(eq(cashbookEntries.id, id), eq(cashbookEntries.cashbookDayId, day.id)))
      .for('update')
      .limit(1);
    if (!entry || entry.voidedAt) throw new CashbookError('NOT_FOUND', 'Active cashbook entry not found.');

    const patch = {
      category: input.category,
      channel: input.channel,
      amountPaise: input.amountPaise,
      partyName: textOrNull(input.partyName),
      reference: textOrNull(input.reference),
      note: textOrNull(input.note),
      updatedById: actor.id,
      updatedAt: new Date(),
    };
    await tx.update(cashbookEntries).set(patch).where(eq(cashbookEntries.id, id));
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.entry_updated',
      entity: 'CashbookEntry',
      entityId: id,
      branchId: day.branchId,
      summary: `${CASHBOOK_CATEGORY_META[input.category].label} entry edited for ${day.date}`,
      before: entry,
      after: { ...entry, ...patch },
    });
    return { version };
  });
}

export async function voidCashbookEntry(
  actor: SessionUser,
  id: string,
  reason: string,
): Promise<{ version: number }> {
  const cleanReason = textOrNull(reason);
  if (!cleanReason) throw new CashbookError('REASON_REQUIRED', 'Enter a reason for voiding this entry.');
  const located = await locateEntry(id);
  if (!located) throw new CashbookError('NOT_FOUND', 'Cashbook entry not found.');

  return db.transaction(async (tx) => {
    const day = await lockDayById(tx, located.cashbookDayId);
    assertEditable(day);
    const [entry] = await tx
      .select()
      .from(cashbookEntries)
      .where(and(eq(cashbookEntries.id, id), eq(cashbookEntries.cashbookDayId, day.id)))
      .for('update')
      .limit(1);
    if (!entry || entry.voidedAt) throw new CashbookError('NOT_FOUND', 'Active cashbook entry not found.');
    const at = new Date();
    await tx
      .update(cashbookEntries)
      .set({ voidedAt: at, voidedById: actor.id, voidReason: cleanReason, updatedById: actor.id, updatedAt: at })
      .where(eq(cashbookEntries.id, id));
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.entry_voided',
      entity: 'CashbookEntry',
      entityId: id,
      branchId: day.branchId,
      summary: `${CASHBOOK_CATEGORY_META[entry.category].label} entry voided: ${cleanReason}`,
      before: entry,
      after: { voidedAt: at, voidReason: cleanReason },
    });
    return { version };
  });
}

export async function addCashbookCommitment(
  actor: SessionUser,
  branchId: string,
  date: string,
  input: CashbookCommitmentInput,
): Promise<{ id: string; version: number }> {
  validateCommitment(input);
  return db.transaction(async (tx) => {
    const day = await ensureDayLocked(tx, actor, branchId, date);
    assertEditable(day);
    const id = newId('citem');
    const row = {
      id,
      cashbookDayId: day.id,
      kind: input.kind,
      amountPaise: input.amountPaise,
      partyName: input.partyName.trim(),
      reference: textOrNull(input.reference),
      note: textOrNull(input.note),
      dueOn: textOrNull(input.dueOn),
      createdById: actor.id,
      updatedById: actor.id,
    };
    await tx.insert(cashbookCommitments).values(row);
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.commitment_added',
      entity: 'CashbookCommitment',
      entityId: id,
      branchId,
      summary: `${CASHBOOK_COMMITMENT_META[input.kind].label} added for ${input.partyName.trim()}`,
      after: row,
    });
    return { id, version };
  });
}

export async function updateCashbookCommitment(
  actor: SessionUser,
  id: string,
  input: CashbookCommitmentInput,
): Promise<{ version: number }> {
  validateCommitment(input);
  const located = await locateCommitment(id);
  if (!located) throw new CashbookError('NOT_FOUND', 'Named item not found.');
  return db.transaction(async (tx) => {
    const day = await lockDayById(tx, located.cashbookDayId);
    assertEditable(day);
    const [item] = await tx
      .select()
      .from(cashbookCommitments)
      .where(and(eq(cashbookCommitments.id, id), eq(cashbookCommitments.cashbookDayId, day.id)))
      .for('update')
      .limit(1);
    if (!item || item.voidedAt) throw new CashbookError('NOT_FOUND', 'Active named item not found.');
    if (item.settledAt) {
      throw new CashbookError(
        'INVALID_COMMITMENT',
        'A settled named item cannot be edited. Reopen the item first so the correction is explicit.',
      );
    }
    const patch = {
      kind: input.kind,
      amountPaise: input.amountPaise,
      partyName: input.partyName.trim(),
      reference: textOrNull(input.reference),
      note: textOrNull(input.note),
      dueOn: textOrNull(input.dueOn),
      updatedById: actor.id,
      updatedAt: new Date(),
    };
    await tx.update(cashbookCommitments).set(patch).where(eq(cashbookCommitments.id, id));
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.commitment_updated',
      entity: 'CashbookCommitment',
      entityId: id,
      branchId: day.branchId,
      summary: `${CASHBOOK_COMMITMENT_META[input.kind].label} edited for ${input.partyName.trim()}`,
      before: item,
      after: { ...item, ...patch },
    });
    return { version };
  });
}

export async function setCashbookCommitmentSettled(
  actor: SessionUser,
  id: string,
  settled: boolean,
  note?: string | null,
): Promise<{ version: number }> {
  const located = await locateCommitment(id);
  if (!located) throw new CashbookError('NOT_FOUND', 'Named item not found.');
  return db.transaction(async (tx) => {
    // Settlement is allowed after the origin day closes: named items deliberately carry forward.
    const day = await lockDayById(tx, located.cashbookDayId);
    const [item] = await tx
      .select()
      .from(cashbookCommitments)
      .where(and(eq(cashbookCommitments.id, id), eq(cashbookCommitments.cashbookDayId, day.id)))
      .for('update')
      .limit(1);
    if (!item || item.voidedAt) throw new CashbookError('NOT_FOUND', 'Active named item not found.');
    if ((settled && item.settledAt) || (!settled && !item.settledAt)) return { version: day.version };
    const at = new Date();
    const patch = settled
      ? { settledAt: at, settledById: actor.id, settlementNote: textOrNull(note) }
      : { settledAt: null, settledById: null, settlementNote: textOrNull(note) };
    await tx
      .update(cashbookCommitments)
      .set({ ...patch, updatedById: actor.id, updatedAt: at })
      .where(eq(cashbookCommitments.id, id));
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: settled ? 'cashbook.commitment_settled' : 'cashbook.commitment_reopened',
      entity: 'CashbookCommitment',
      entityId: id,
      branchId: day.branchId,
      summary: `${CASHBOOK_COMMITMENT_META[item.kind].label} ${settled ? 'settled' : 'reopened'} for ${item.partyName}`,
      before: item,
      after: patch,
    });
    return { version };
  });
}

export async function voidCashbookCommitment(
  actor: SessionUser,
  id: string,
  reason: string,
): Promise<{ version: number }> {
  const cleanReason = textOrNull(reason);
  if (!cleanReason) throw new CashbookError('REASON_REQUIRED', 'Enter a reason for voiding this item.');
  const located = await locateCommitment(id);
  if (!located) throw new CashbookError('NOT_FOUND', 'Named item not found.');
  return db.transaction(async (tx) => {
    const day = await lockDayById(tx, located.cashbookDayId);
    assertEditable(day);
    const [item] = await tx
      .select()
      .from(cashbookCommitments)
      .where(and(eq(cashbookCommitments.id, id), eq(cashbookCommitments.cashbookDayId, day.id)))
      .for('update')
      .limit(1);
    if (!item || item.voidedAt) throw new CashbookError('NOT_FOUND', 'Active named item not found.');
    if (item.settledAt) {
      throw new CashbookError(
        'INVALID_COMMITMENT',
        'A settled named item cannot be voided. Reopen the item first so the correction is explicit.',
      );
    }
    const at = new Date();
    await tx
      .update(cashbookCommitments)
      .set({ voidedAt: at, voidedById: actor.id, voidReason: cleanReason, updatedById: actor.id, updatedAt: at })
      .where(eq(cashbookCommitments.id, id));
    const version = await bumpDay(tx, day, actor);
    await writeAudit(tx, actor, {
      action: 'cashbook.commitment_voided',
      entity: 'CashbookCommitment',
      entityId: id,
      branchId: day.branchId,
      summary: `${CASHBOOK_COMMITMENT_META[item.kind].label} voided: ${cleanReason}`,
      before: item,
      after: { voidedAt: at, voidReason: cleanReason },
    });
    return { version };
  });
}

export async function requestCashbookClose(
  actor: SessionUser,
  branchId: string,
  date: string,
  reason?: string | null,
): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const day = await ensureDayLocked(tx, actor, branchId, date);
    assertEditable(day);
    const { totals, entryCount, commitmentCount } = await loadTotals(tx, day);
    if (!totals.hasActivity) throw new CashbookError('EMPTY_DAY', 'Enter the day’s figures before requesting close.');
    const cleanReason = textOrNull(reason);
    if (totals.cashDifferencePaise !== 0n && !cleanReason) {
      throw new CashbookError(
        'REASON_REQUIRED',
        'This drawer is not balanced. Enter a reason for the shortage or excess before requesting close.',
      );
    }
    const at = new Date();
    const [updated] = await tx
      .update(cashbookDays)
      .set({
        status: 'CLOSE_REQUESTED',
        closeRequestedById: actor.id,
        closeRequestedAt: at,
        closeReason: cleanReason,
        version: day.version + 1,
        updatedById: actor.id,
        updatedAt: at,
      })
      .where(eq(cashbookDays.id, day.id))
      .returning({ version: cashbookDays.version });
    await writeAudit(tx, actor, {
      action: 'cashbook.close_requested',
      entity: 'CashbookDay',
      entityId: day.id,
      branchId,
      summary: `Close requested for ${date}; difference ${totals.cashDifferencePaise.toString()} paise`,
      after: { totals, entryCount, commitmentCount, reason: cleanReason },
    });
    return { version: updated.version };
  });
}

export async function confirmCashbookClose(
  actor: SessionUser,
  branchId: string,
  date: string,
  approve: boolean,
  note?: string | null,
): Promise<{ version: number; closeRevision: number }> {
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select()
      .from(cashbookDays)
      .where(and(eq(cashbookDays.branchId, branchId), eq(cashbookDays.date, date)))
      .for('update')
      .limit(1);
    if (!day) throw new CashbookError('NOT_FOUND', 'Cashbook day not found.');
    if (day.status !== 'CLOSE_REQUESTED') {
      throw new CashbookError('INVALID_STATE', 'This cashbook is not waiting for close approval.');
    }

    const at = new Date();
    if (!approve) {
      const [updated] = await tx
        .update(cashbookDays)
        .set({
          status: 'OPEN',
          closeRequestedById: null,
          closeRequestedAt: null,
          closeReason: null,
          version: day.version + 1,
          updatedById: actor.id,
          updatedAt: at,
        })
        .where(eq(cashbookDays.id, day.id))
        .returning({ version: cashbookDays.version, closeRevision: cashbookDays.closeRevision });
      await writeAudit(tx, actor, {
        action: 'cashbook.close_rejected',
        entity: 'CashbookDay',
        entityId: day.id,
        branchId,
        summary: `Close request rejected for ${date}${textOrNull(note) ? `: ${textOrNull(note)}` : ''}`,
        before: day,
        after: { status: 'OPEN', note: textOrNull(note) },
      });
      return updated;
    }

    const { totals, entryCount, commitmentCount } = await loadTotals(tx, day);
    const closeRevision = day.closeRevision + 1;
    const snapshot = jsonSafe({
      schemaVersion: 1,
      branchId,
      date,
      closeRevision,
      figures: figuresOf(day),
      totals,
      entryCount,
      commitmentCount,
      requestedById: day.closeRequestedById,
      requestedAt: day.closeRequestedAt,
      closeReason: day.closeReason,
      closedById: actor.id,
      closedAt: at,
    });
    const [updated] = await tx
      .update(cashbookDays)
      .set({
        status: 'CLOSED',
        closedById: actor.id,
        closedAt: at,
        closeSnapshot: snapshot,
        closeRevision,
        version: day.version + 1,
        updatedById: actor.id,
        updatedAt: at,
      })
      .where(eq(cashbookDays.id, day.id))
      .returning({ version: cashbookDays.version, closeRevision: cashbookDays.closeRevision });
    await writeAudit(tx, actor, {
      action: 'cashbook.closed',
      entity: 'CashbookDay',
      entityId: day.id,
      branchId,
      summary: `Cashbook ${date} closed at revision ${closeRevision}`,
      before: day,
      after: snapshot,
    });
    return updated;
  });
}

export async function reopenCashbookDay(
  actor: SessionUser,
  branchId: string,
  date: string,
  reason: string,
): Promise<{ version: number }> {
  const cleanReason = textOrNull(reason);
  if (!cleanReason) throw new CashbookError('REASON_REQUIRED', 'Enter a reason for reopening the day.');
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select()
      .from(cashbookDays)
      .where(and(eq(cashbookDays.branchId, branchId), eq(cashbookDays.date, date)))
      .for('update')
      .limit(1);
    if (!day) throw new CashbookError('NOT_FOUND', 'Cashbook day not found.');
    if (day.status !== 'CLOSED') throw new CashbookError('INVALID_STATE', 'Only a closed cashbook can be reopened.');
    const at = new Date();
    const [updated] = await tx
      .update(cashbookDays)
      .set({
        status: 'OPEN',
        closeRequestedById: null,
        closeRequestedAt: null,
        closeReason: null,
        closedById: null,
        closedAt: null,
        // Keep the last signed snapshot/revision; a subsequent close supersedes it explicitly.
        version: day.version + 1,
        updatedById: actor.id,
        updatedAt: at,
      })
      .where(eq(cashbookDays.id, day.id))
      .returning({ version: cashbookDays.version });
    await writeAudit(tx, actor, {
      action: 'cashbook.reopened',
      entity: 'CashbookDay',
      entityId: day.id,
      branchId,
      summary: `Cashbook ${date} reopened: ${cleanReason}`,
      before: day,
      after: { status: 'OPEN', reason: cleanReason, previousCloseRevision: day.closeRevision },
    });
    return updated;
  });
}

/** Used only by tests/diagnostics that need the exact stored child row shape. */
export type { CashbookEntry, CashbookCommitment };
