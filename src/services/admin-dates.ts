import 'server-only';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { caseEvents, maturityCases, payoutInstalments, payoutTransactions } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { canOverrideDates, ForbiddenError } from '@/lib/rbac';
import { parseISODate, todayISO } from '@/lib/working-days';
import { PayoutError } from '@/services/payout-service';
import { ensureAllocatedLedgerInTx } from '@/services/payout-ledger';

function requireAdmin(actor: SessionUser) {
  if (!canOverrideDates(actor.role)) {
    throw new ForbiddenError(
      'settings.manage',
      'NO_PERMISSION',
      'Only Admin, CMD or CEO can change a date that has already been paid or locked.',
    );
  }
}

function isoDate(value: string): string {
  const raw = value.trim();
  try {
    parseISODate(raw);
  } catch {
    throw new PayoutError('Enter a valid date.', 'VALIDATION');
  }
  return raw;
}

/**
 * Move one schedule day — including a day that has already been paid.
 *
 * Amounts are not touched. Admin is correcting the calendar, not rewriting the money.
 */
export async function setInstalmentDueOn(
  actor: SessionUser,
  instalmentId: string,
  dueOnRaw: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  requireAdmin(actor);
  const dueOn = isoDate(dueOnRaw);

  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ caseId: payoutInstalments.caseId })
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, instalmentId))
      .limit(1);
    if (!ref) throw new PayoutError('That day is not on the schedule.', 'NOT_FOUND');

    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, ref.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');

    const [inst] = await tx
      .select()
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, instalmentId))
      .for('update')
      .limit(1);
    if (!inst) throw new PayoutError('That day is not on the schedule.', 'NOT_FOUND');
    if (inst.dueOn === dueOn) return { caseId: c.id, dueOn };

    await tx
      .update(payoutInstalments)
      .set({ dueOn, updatedAt: new Date() })
      .where(eq(payoutInstalments.id, inst.id));

    const live = await tx
      .select({ dueOn: payoutInstalments.dueOn })
      .from(payoutInstalments)
      .where(
        and(
          eq(payoutInstalments.caseId, c.id),
          eq(payoutInstalments.scheduleVersion, c.scheduleVersion),
          sql`${payoutInstalments.status} NOT IN ('SUPERSEDED','CANCELLED')`,
        ),
      );
    const dates = live.map((row) => row.dueOn).sort();
    if (dates.length > 0) {
      await tx
        .update(maturityCases)
        .set({
          firstPayoutOn: dates[0],
          deadlineOn: dates[dates.length - 1],
          updatedAt: new Date(),
        })
        .where(eq(maturityCases.id, c.id));
    }

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'EDITED',
      actorId: actor.id,
      note: `Day ${inst.seq} date moved from ${inst.dueOn} to ${dueOn}${inst.status === 'PAID' ? ' (already paid)' : ''}`,
    });
    await writeAudit(tx, actor, {
      action: 'case.updated',
      entity: 'PayoutInstalment',
      entityId: inst.id,
      branchId: c.branchId,
      summary: `${c.caseNumber}: day ${inst.seq} date ${inst.dueOn} → ${dueOn}`,
      before: { dueOn: inst.dueOn, status: inst.status },
      after: { dueOn, status: inst.status },
      ...meta,
    });
    return { caseId: c.id, dueOn };
  });
}

/**
 * Correct a live receipt's value date by audited reversal and replacement.
 */
export async function setPayoutValueDate(
  actor: SessionUser,
  transactionId: string,
  valueDateRaw: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  requireAdmin(actor);
  const valueDate = isoDate(valueDateRaw);
  if (valueDate > todayISO()) throw new PayoutError('Cannot record a payment on a future date.', 'VALIDATION');

  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ caseId: payoutTransactions.caseId })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, transactionId))
      .limit(1);
    if (!ref) throw new PayoutError('Payment not found', 'NOT_FOUND');

    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, ref.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');

    // Read the requested receipt after the CASE lock but do not lock it yet.  The ledger repair
    // below locks all instalments before all receipts, which is the global case → child order.
    const [requested] = await tx
      .select()
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, transactionId))
      .limit(1);
    if (!requested) throw new PayoutError('Payment not found', 'NOT_FOUND');
    if (requested.reversedAt) throw new PayoutError('This receipt is reversed. Correct its live replacement instead.', 'ALREADY_REVERSED');
    if (requested.valueDate === valueDate) return { caseId: c.id, valueDate };

    const historicalAllocations = await ensureAllocatedLedgerInTx(tx, actor, c, meta);
    const receiptIds = historicalAllocations.get(requested.id) ?? [requested.id];
    const [txn] = await tx
      .select()
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, requested.id))
      .for('update')
      .limit(1);
    if (!txn) throw new PayoutError('Payment not found', 'NOT_FOUND');
    // A legacy unallocated receipt is deliberately reversed by ensureAllocatedLedgerInTx; its
    // allocated replacements are the live receipts that receive the new value date.
    if (txn.reversedAt && !historicalAllocations.has(requested.id)) {
      throw new PayoutError('This receipt is reversed. Correct its live replacement instead.', 'ALREADY_REVERSED');
    }
    const allocated = await tx.select().from(payoutTransactions)
      .where(inArray(payoutTransactions.id, receiptIds)).for('update');
    const replacementIds: string[] = [];
    const reason = `Value date corrected from ${requested.valueDate} to ${valueDate}`;
    for (const receipt of allocated) {
      const id = newId('txn');
      replacementIds.push(id);
      await tx.insert(payoutTransactions).values({
        id, caseId: c.id, instalmentId: receipt.instalmentId, branchId: c.branchId,
        cashPaise: receipt.cashPaise, onlinePaise: receipt.onlinePaise, totalPaise: receipt.totalPaise,
        reference: receipt.reference, remarks: `${reason} · replaces receipt ${receipt.id}`,
        valueDate, recordedById: actor.id,
      });
    }
    await tx.update(payoutTransactions).set({
      reversedAt: new Date(), reversedById: actor.id, reversalReason: reason,
    }).where(inArray(payoutTransactions.id, receiptIds));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'EDITED',
      actorId: actor.id,
      note: `Payout value date moved from ${requested.valueDate} to ${valueDate}`,
    });
    await writeAudit(tx, actor, {
      action: 'payout.corrected',
      entity: 'PayoutTransaction',
      entityId: txn.id,
      branchId: c.branchId,
      summary: `${c.caseNumber}: payout value date ${requested.valueDate} → ${valueDate}`,
      before: { valueDate: requested.valueDate },
      after: { valueDate, reversedReceiptIds: receiptIds, replacementReceiptIds: replacementIds },
      ...meta,
    });
    return { caseId: c.id, valueDate };
  });
}
