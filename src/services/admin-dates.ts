import 'server-only';

import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { caseEvents, maturityCases, payoutInstalments, payoutTransactions } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { canOverrideDates, ForbiddenError } from '@/lib/rbac';
import { parseISODate } from '@/lib/working-days';
import { PayoutError } from '@/services/payout-service';

function requireAdmin(actor: SessionUser) {
  if (!canOverrideDates(actor.role)) {
    throw new ForbiddenError(
      'settings.manage',
      'NO_PERMISSION',
      'Only Admin can change a date that has already been paid or locked.',
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
          ne(payoutInstalments.status, 'SUPERSEDED'),
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
    });
    return { caseId: c.id, dueOn };
  });
}

/**
 * Correct the value date on a recorded payout, including a paid (and even reversed) row.
 */
export async function setPayoutValueDate(
  actor: SessionUser,
  transactionId: string,
  valueDateRaw: string,
) {
  requireAdmin(actor);
  const valueDate = isoDate(valueDateRaw);

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

    const [txn] = await tx
      .select()
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, transactionId))
      .for('update')
      .limit(1);
    if (!txn) throw new PayoutError('Payment not found', 'NOT_FOUND');
    if (txn.valueDate === valueDate) return { caseId: c.id, valueDate };

    await tx
      .update(payoutTransactions)
      .set({ valueDate })
      .where(eq(payoutTransactions.id, txn.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'EDITED',
      actorId: actor.id,
      note: `Payout value date moved from ${txn.valueDate} to ${valueDate}`,
    });
    await writeAudit(tx, actor, {
      action: 'payout.corrected',
      entity: 'PayoutTransaction',
      entityId: txn.id,
      branchId: c.branchId,
      summary: `${c.caseNumber}: payout value date ${txn.valueDate} → ${valueDate}`,
      before: { valueDate: txn.valueDate },
      after: { valueDate },
    });
    return { caseId: c.id, valueDate };
  });
}
