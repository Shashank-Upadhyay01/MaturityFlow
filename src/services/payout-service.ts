import 'server-only';

import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  caseEvents,
  maturityCases,
  payoutInstalments,
  payoutTransactions,
  type MaturityCase,
} from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { formatPaise } from '@/lib/money';
import { planSettlement, validatePayout } from '@/lib/payment-rules';
import { todayISO } from '@/lib/working-days';

export class PayoutError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

const PAYABLE_STATUSES = new Set<MaturityCase['status']>(['APPROVED', 'IN_PROGRESS']);

export interface RecordPayoutInput {
  instalmentId: string;
  cashPaise: bigint;
  onlinePaise: bigint;
  reference?: string | null;
  remarks?: string | null;
  valueDate?: string;
  /** ADMIN / CEO / CMD may exceed the planned daily amount. Never the case total. */
  allowExceedInstalment?: boolean;
}

/**
 * Record a disbursement.
 *
 * Everything happens inside one transaction with a row lock on the case, so two cashiers
 * clicking "Pay" at the same second cannot both succeed against the same remaining balance.
 * INV-4 is checked here in application code AND by a CHECK constraint on the table.
 */
export async function recordPayout(
  actor: SessionUser,
  input: RecordPayoutInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    // Resolve the parent case WITHOUT locking, purely so the locks below can be taken in a
    // fixed order.
    const [ref] = await tx
      .select({ caseId: payoutInstalments.caseId })
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, input.instalmentId))
      .limit(1);
    if (!ref) throw new PayoutError('Instalment not found', 'NOT_FOUND');

    // Lock order is always CASE then INSTALMENT. Two payouts on the same case therefore
    // queue in the same order and cannot deadlock.
    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, ref.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');

    // Re-read the instalment INSIDE the lock. Reading it before the lock was a real bug:
    // twelve cashiers all saw paid = 0, queued on the case lock, and each validated against
    // its own stale snapshot — so the same day's instalment could be paid several times over
    // while the case total still looked fine. The row lock is what makes the check truthful.
    const [inst] = await tx
      .select()
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, input.instalmentId))
      .for('update')
      .limit(1);
    if (!inst) throw new PayoutError('Instalment not found', 'NOT_FOUND');
    if (inst.status === 'SUPERSEDED' || inst.status === 'CANCELLED') {
      throw new PayoutError('This instalment is no longer part of the live schedule.', 'SUPERSEDED');
    }

    const check = validatePayout(
      { cashPaise: input.cashPaise, onlinePaise: input.onlinePaise, reference: input.reference },
      {
        instalmentAmountPaise: inst.amountPaise,
        instalmentPaidPaise: inst.paidCashPaise + inst.paidOnlinePaise,
        casePaidTotalPaise: c.paidCashPaise + c.paidOnlinePaise,
        caseTotalPaise: c.maturityAmountPaise,
        caseIsPayable: PAYABLE_STATUSES.has(c.status),
        allowExceedInstalment: input.allowExceedInstalment ?? false,
      },
    );
    if (!check.ok) throw new PayoutError(check.message, check.code);

    const txnId = newId('txn');
    const valueDate = input.valueDate ?? todayISO();

    await tx.insert(payoutTransactions).values({
      id: txnId,
      caseId: c.id,
      instalmentId: inst.id,
      branchId: c.branchId,
      cashPaise: input.cashPaise,
      onlinePaise: input.onlinePaise,
      totalPaise: check.totalPaise,
      reference: input.reference?.trim() || null,
      remarks: input.remarks ?? null,
      valueDate,
      recordedById: actor.id,
    });

    const newInstCash = inst.paidCashPaise + input.cashPaise;
    const newInstOnline = inst.paidOnlinePaise + input.onlinePaise;
    const instPaid = newInstCash + newInstOnline;

    await tx
      .update(payoutInstalments)
      .set({
        paidCashPaise: newInstCash,
        paidOnlinePaise: newInstOnline,
        status: instPaid >= inst.amountPaise ? 'PAID' : 'PARTIAL',
        updatedAt: new Date(),
      })
      .where(eq(payoutInstalments.id, inst.id));

    const newCaseCash = c.paidCashPaise + input.cashPaise;
    const newCaseOnline = c.paidOnlinePaise + input.onlinePaise;
    const casePaid = newCaseCash + newCaseOnline;
    const complete = casePaid >= c.maturityAmountPaise;

    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: newCaseCash,
        paidOnlinePaise: newCaseOnline,
        status: complete ? 'COMPLETED' : c.status === 'APPROVED' ? 'IN_PROGRESS' : c.status,
        completedAt: complete ? new Date() : c.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, c.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'PAYMENT_RECORDED',
      actorId: actor.id,
      note:
        `Day ${inst.seq} (${inst.dueOn}) — ${formatPaise(check.totalPaise)}` +
        (input.cashPaise > 0n && input.onlinePaise > 0n
          ? ` (${formatPaise(input.cashPaise)} cash + ${formatPaise(input.onlinePaise)} online)`
          : input.onlinePaise > 0n
            ? ' online'
            : ' cash'),
    });

    if (complete) {
      await tx.insert(caseEvents).values({
        id: newId('evt'),
        caseId: c.id,
        type: 'COMPLETED',
        actorId: actor.id,
        toStatus: 'COMPLETED',
        note: `Fully paid — ${formatPaise(c.maturityAmountPaise)}`,
      });
    }

    await writeAudit(tx, actor, {
      action: 'payout.recorded',
      entity: 'PayoutTransaction',
      entityId: txnId,
      branchId: c.branchId,
      summary:
        `${c.caseNumber} day ${inst.seq}: ${formatPaise(check.totalPaise)} paid ` +
        `(cash ${formatPaise(input.cashPaise)}, online ${formatPaise(input.onlinePaise)})` +
        (input.reference ? ` ref ${input.reference}` : ''),
      before: { casePaidPaise: c.paidCashPaise + c.paidOnlinePaise },
      after: {
        casePaidPaise: casePaid,
        caseRemainingPaise: c.maturityAmountPaise - casePaid,
        complete,
      },
      ...meta,
    });

    return {
      ok: true as const,
      totalPaise: check.totalPaise,
      remainingPaise: c.maturityAmountPaise - casePaid,
      instalmentSettled: check.settlesInstalment,
      caseCompleted: complete,
    };
  });
}

// ── The register's two buttons ───────────────────────────────────────────────

/**
 * How a day that was taken in full gets split between the drawer and a transfer.
 *
 * `'SPLIT'` is not a free choice — it honours the legs the engine already planned for that day,
 * so the common case is the clerk agreeing with the plan in one click. It only has to think when
 * the day is part-paid, and then cash is filled first because that is the leg a counter settles
 * from and the one a cash cap constrains.
 */
function tenderSplit(
  tender: Tender,
  inst: { amountPaise: bigint; cashLegPaise: bigint; paidCashPaise: bigint },
  remainingPaise: bigint,
): { cash: bigint; online: bigint } {
  if (tender === 'CASH') return { cash: remainingPaise, online: 0n };
  if (tender === 'ONLINE') return { cash: 0n, online: remainingPaise };
  const cashDue = inst.cashLegPaise - inst.paidCashPaise;
  const cash = cashDue <= 0n ? 0n : cashDue < remainingPaise ? cashDue : remainingPaise;
  return { cash, online: remainingPaise - cash };
}

export type Tender = 'CASH' | 'ONLINE' | 'SPLIT';

/**
 * "Taken" — the customer withdrew everything the schedule planned for them today.
 *
 * All-or-nothing by design. The register exists so a clerk can answer one question per row
 * without typing, and a box that accepts any figure is how the old sheet drifted away from the
 * plan. A genuine part payment is a different act and is entered on the case page.
 *
 * The read below is deliberately NOT locked: it only proposes the amounts. `recordPayout`
 * re-reads the instalment inside the case lock and re-validates against INV-4, so a racing
 * cashier makes this one fail loudly rather than pay the same day twice (CLAUDE.md #7).
 */
export async function markInstalmentTaken(
  actor: SessionUser,
  instalmentId: string,
  tender: Tender,
  /**
   * UTR / NEFT / IMPS reference. Mandatory the moment any of the day goes out online — INV-4,
   * enforced in `validatePayout` and not negotiable from the register. A cash-only day needs
   * none, which is why marking one is a single click and marking a transfer is not.
   */
  reference: string | null = null,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const [inst] = await db
    .select()
    .from(payoutInstalments)
    .where(eq(payoutInstalments.id, instalmentId))
    .limit(1);
  if (!inst) throw new PayoutError('Instalment not found', 'NOT_FOUND');
  if (inst.status === 'SUPERSEDED' || inst.status === 'CANCELLED') {
    throw new PayoutError('This instalment is no longer part of the live schedule.', 'SUPERSEDED');
  }
  // Yesterday (and any earlier unpaid day) is still collectable from the Register. The
  // Not-paid tab exists so a clerk can mark those days taken when the customer comes in
  // later. A future day is not an observation yet.
  if (inst.dueOn > todayISO()) {
    throw new PayoutError('That day has not arrived yet.', 'NOT_YET_DUE');
  }

  const remaining = inst.amountPaise - inst.paidCashPaise - inst.paidOnlinePaise;
  if (remaining <= 0n) throw new PayoutError('This day is already paid in full.', 'ALREADY_PAID');

  const { cash, online } = tenderSplit(tender, inst, remaining);
  if (online > 0n && !reference?.trim()) {
    throw new PayoutError(
      'A UTR / transaction reference is required for the online portion.',
      'ONLINE_LEG_NEEDS_REFERENCE',
    );
  }
  return recordPayout(
    actor,
    {
      instalmentId,
      cashPaise: cash,
      onlinePaise: online,
      reference: reference?.trim() || null,
      remarks: 'Register: marked taken',
    },
    meta,
  );
}

/**
 * "Not taken" — nobody came for this day.
 *
 * No money moves, so this is not a payout; what it does is turn an unanswered day into an
 * answered one, which is what the Not-taken tab and the red row are built from. The day stays on
 * the schedule and stays owed — marking it missed never writes the money off.
 *
 * A future day cannot be marked: a no-show is an observation, and there is nothing yet to
 * observe. Pass `clear` to undo a mis-click, which returns the day to whatever it was before the
 * mark — pending, or partial if some of it had already gone out.
 *
 * Takes the CASE lock before the instalment, in the same order as `recordPayout`, so the two
 * cannot deadlock against each other.
 */
export async function markInstalmentMissed(
  actor: SessionUser,
  instalmentId: string,
  opts: { clear?: boolean; asOf?: string } = {},
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  const asOf = opts.asOf ?? todayISO();
  const clear = opts.clear ?? false;

  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ caseId: payoutInstalments.caseId })
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, instalmentId))
      .limit(1);
    if (!ref) throw new PayoutError('Instalment not found', 'NOT_FOUND');

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
    if (!inst) throw new PayoutError('Instalment not found', 'NOT_FOUND');
    if (inst.status === 'SUPERSEDED' || inst.status === 'CANCELLED') {
      throw new PayoutError('This instalment is no longer part of the live schedule.', 'SUPERSEDED');
    }

    const paid = inst.paidCashPaise + inst.paidOnlinePaise;

    if (clear) {
      if (inst.status !== 'MISSED') {
        throw new PayoutError('This day is not marked as not taken.', 'NOT_MISSED');
      }
    } else {
      if (inst.status === 'PAID') {
        throw new PayoutError('This day is already paid — reverse the payout instead.', 'ALREADY_PAID');
      }
      if (inst.status === 'MISSED') return { ok: true as const, status: 'MISSED' as const };
      if (inst.dueOn > asOf) {
        throw new PayoutError('That day has not arrived yet.', 'NOT_YET_DUE');
      }
    }

    const next = clear ? (paid > 0n ? ('PARTIAL' as const) : ('PENDING' as const)) : ('MISSED' as const);

    await tx
      .update(payoutInstalments)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(payoutInstalments.id, inst.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'NOTE_ADDED',
      actorId: actor.id,
      note: clear
        ? `Day ${inst.seq} (${inst.dueOn}) — not-taken mark cleared`
        : `Day ${inst.seq} (${inst.dueOn}) — not taken, ${formatPaise(inst.amountPaise - paid)} still owed`,
    });

    await writeAudit(tx, actor, {
      action: clear ? 'payout.missed_cleared' : 'payout.missed',
      entity: 'PayoutInstalment',
      entityId: inst.id,
      branchId: c.branchId,
      summary: clear
        ? `${c.caseNumber} day ${inst.seq}: not-taken mark cleared`
        : `${c.caseNumber} day ${inst.seq} (${inst.dueOn}): not taken, ${formatPaise(inst.amountPaise - paid)} still owed`,
      before: { status: inst.status },
      after: { status: next },
      ...meta,
    });

    return { ok: true as const, status: next };
  });
}

/** Reverse a transaction. The row is kept and flagged — the ledger is never rewritten. */
export async function reversePayout(
  actor: SessionUser,
  txnId: string,
  reason: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ caseId: payoutTransactions.caseId })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, txnId))
      .limit(1);
    if (!ref) throw new PayoutError('Transaction not found', 'NOT_FOUND');

    // Same lock order as recordPayout: case first, then the row being changed.
    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, ref.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');

    // Re-read under the lock so two people reversing the same receipt at the same moment
    // cannot both get past the already-reversed check and unwind the ledger twice.
    const [txn] = await tx
      .select()
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, txnId))
      .for('update')
      .limit(1);
    if (!txn) throw new PayoutError('Transaction not found', 'NOT_FOUND');
    if (txn.reversedAt) throw new PayoutError('This transaction is already reversed.', 'ALREADY_REVERSED');

    await tx
      .update(payoutTransactions)
      .set({ reversedAt: new Date(), reversedById: actor.id, reversalReason: reason })
      .where(eq(payoutTransactions.id, txnId));

    if (txn.instalmentId) {
      const [inst] = await tx
        .select()
        .from(payoutInstalments)
        .where(eq(payoutInstalments.id, txn.instalmentId))
        .for('update')
        .limit(1);
      if (inst) {
        const cash = inst.paidCashPaise - txn.cashPaise;
        const online = inst.paidOnlinePaise - txn.onlinePaise;
        const paid = cash + online;
        await tx
          .update(payoutInstalments)
          .set({
            paidCashPaise: cash < 0n ? 0n : cash,
            paidOnlinePaise: online < 0n ? 0n : online,
            status: paid <= 0n ? 'PENDING' : paid >= inst.amountPaise ? 'PAID' : 'PARTIAL',
            updatedAt: new Date(),
          })
          .where(eq(payoutInstalments.id, inst.id));
      }
    }

    const newCash = c.paidCashPaise - txn.cashPaise;
    const newOnline = c.paidOnlinePaise - txn.onlinePaise;
    const paid = newCash + newOnline;

    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: newCash < 0n ? 0n : newCash,
        paidOnlinePaise: newOnline < 0n ? 0n : newOnline,
        status: paid <= 0n ? 'APPROVED' : 'IN_PROGRESS',
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, c.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'PAYMENT_REVERSED',
      actorId: actor.id,
      note: `${formatPaise(txn.totalPaise)} reversed — ${reason}`,
    });

    await writeAudit(tx, actor, {
      action: 'payout.reversed',
      entity: 'PayoutTransaction',
      entityId: txnId,
      branchId: c.branchId,
      summary: `${c.caseNumber}: reversed ${formatPaise(txn.totalPaise)} — ${reason}`,
      before: { casePaidPaise: c.paidCashPaise + c.paidOnlinePaise },
      after: { casePaidPaise: paid },
      ...meta,
    });

    return { ok: true as const, remainingPaise: c.maturityAmountPaise - paid };
  });
}

/**
 * Replace the cash/online split recorded for one scheduled day.
 *
 * Spreadsheet entry needs a "set this cell" operation, while the payout ledger must remain
 * append-only. We bridge those two models by reversing every live transaction for this
 * instalment on the selected value date, then inserting one replacement transaction. The case
 * row is locked first, followed by the instalment and its transactions, preserving the global
 * lock order used by every payout writer.
 */
export async function replaceInstalmentPayout(
  actor: SessionUser,
  input: {
    instalmentId: string;
    cashPaise: bigint;
    onlinePaise: bigint;
    reference?: string | null;
    reason?: string | null;
    valueDate?: string;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  if (input.cashPaise < 0n || input.onlinePaise < 0n) {
    throw new PayoutError('Paid amounts cannot be negative.', 'NEGATIVE');
  }

  return db.transaction(async (tx) => {
    const [ref] = await tx
      .select({ caseId: payoutInstalments.caseId })
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, input.instalmentId))
      .limit(1);
    if (!ref) throw new PayoutError('Instalment not found', 'NOT_FOUND');

    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, ref.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');
    if (!PAYABLE_STATUSES.has(c.status) && c.status !== 'COMPLETED') {
      throw new PayoutError('This row is not open for payment.', 'NOT_PAYABLE');
    }

    const [inst] = await tx
      .select()
      .from(payoutInstalments)
      .where(eq(payoutInstalments.id, input.instalmentId))
      .for('update')
      .limit(1);
    if (!inst) throw new PayoutError('Instalment not found', 'NOT_FOUND');
    if (inst.status === 'SUPERSEDED' || inst.status === 'CANCELLED') {
      throw new PayoutError('This instalment is no longer part of the live schedule.', 'SUPERSEDED');
    }

    const valueDate = input.valueDate ?? todayISO();
    const current = await tx
      .select()
      .from(payoutTransactions)
      .where(
        and(
          eq(payoutTransactions.instalmentId, inst.id),
          eq(payoutTransactions.valueDate, valueDate),
          isNull(payoutTransactions.reversedAt),
        ),
      )
      .for('update');

    const oldCash = current.reduce((sum, row) => sum + row.cashPaise, 0n);
    const oldOnline = current.reduce((sum, row) => sum + row.onlinePaise, 0n);
    const oldTotal = oldCash + oldOnline;
    const newTotal = input.cashPaise + input.onlinePaise;
    const instCashWithoutToday = inst.paidCashPaise - oldCash;
    const instOnlineWithoutToday = inst.paidOnlinePaise - oldOnline;
    const caseCashWithoutToday = c.paidCashPaise - oldCash;
    const caseOnlineWithoutToday = c.paidOnlinePaise - oldOnline;

    if (
      instCashWithoutToday < 0n || instOnlineWithoutToday < 0n ||
      caseCashWithoutToday < 0n || caseOnlineWithoutToday < 0n
    ) {
      throw new PayoutError('The payout ledger is inconsistent; correction was not applied.', 'LEDGER_MISMATCH');
    }
    if (instCashWithoutToday + instOnlineWithoutToday + newTotal > inst.amountPaise) {
      throw new PayoutError(
        `Cannot set ${formatPaise(newTotal)} — this day has only ${formatPaise(inst.amountPaise - instCashWithoutToday - instOnlineWithoutToday)} left.`,
        'EXCEEDS_INSTALMENT',
      );
    }
    if (caseCashWithoutToday + caseOnlineWithoutToday + newTotal > c.maturityAmountPaise) {
      throw new PayoutError('The entered payment exceeds the case balance.', 'EXCEEDS_REMAINING');
    }
    if (input.onlinePaise > 0n && !input.reference?.trim()) {
      throw new PayoutError('Online payment needs a UTR / reference.', 'REF_REQUIRED');
    }
    if (oldTotal > 0n && !input.reason?.trim()) {
      throw new PayoutError('Enter a reason for changing a recorded payment.', 'REASON_REQUIRED');
    }

    const now = new Date();
    if (current.length > 0) {
      await tx
        .update(payoutTransactions)
        .set({
          reversedAt: now,
          reversedById: actor.id,
          reversalReason: input.reason?.trim() || 'Spreadsheet correction',
        })
        .where(inArray(payoutTransactions.id, current.map((row) => row.id)));
    }

    let replacementId: string | null = null;
    if (newTotal > 0n) {
      replacementId = newId('txn');
      await tx.insert(payoutTransactions).values({
        id: replacementId,
        caseId: c.id,
        instalmentId: inst.id,
        branchId: c.branchId,
        cashPaise: input.cashPaise,
        onlinePaise: input.onlinePaise,
        totalPaise: newTotal,
        reference: input.reference?.trim() || null,
        remarks: input.reason?.trim() || 'Spreadsheet entry',
        valueDate,
        recordedById: actor.id,
      });
    }

    const newInstCash = instCashWithoutToday + input.cashPaise;
    const newInstOnline = instOnlineWithoutToday + input.onlinePaise;
    const newInstPaid = newInstCash + newInstOnline;
    await tx
      .update(payoutInstalments)
      .set({
        paidCashPaise: newInstCash,
        paidOnlinePaise: newInstOnline,
        status: newInstPaid <= 0n ? 'PENDING' : newInstPaid >= inst.amountPaise ? 'PAID' : 'PARTIAL',
        updatedAt: now,
      })
      .where(eq(payoutInstalments.id, inst.id));

    const newCaseCash = caseCashWithoutToday + input.cashPaise;
    const newCaseOnline = caseOnlineWithoutToday + input.onlinePaise;
    const newCasePaid = newCaseCash + newCaseOnline;
    const complete = newCasePaid >= c.maturityAmountPaise;
    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: newCaseCash,
        paidOnlinePaise: newCaseOnline,
        status: complete ? 'COMPLETED' : newCasePaid > 0n ? 'IN_PROGRESS' : 'APPROVED',
        completedAt: complete ? now : null,
        updatedAt: now,
      })
      .where(eq(maturityCases.id, c.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: newTotal > 0n ? 'PAYMENT_RECORDED' : 'PAYMENT_REVERSED',
      actorId: actor.id,
      note: `Day ${inst.seq} (${valueDate}) corrected from ${formatPaise(oldTotal)} to ${formatPaise(newTotal)} (${formatPaise(input.cashPaise)} cash / ${formatPaise(input.onlinePaise)} online)`,
    });

    await writeAudit(tx, actor, {
      action: 'payout.corrected',
      entity: 'PayoutInstalment',
      entityId: inst.id,
      branchId: c.branchId,
      summary: `${c.caseNumber} day ${inst.seq}: payment corrected from ${formatPaise(oldTotal)} to ${formatPaise(newTotal)}`,
      before: { cashPaise: oldCash, onlinePaise: oldOnline, totalPaise: oldTotal },
      after: {
        cashPaise: input.cashPaise,
        onlinePaise: input.onlinePaise,
        totalPaise: newTotal,
        replacementTransactionId: replacementId,
        reason: input.reason?.trim() || null,
      },
      ...meta,
    });

    return { totalPaise: newTotal, replacementTransactionId: replacementId };
  });
}

/** Unpaid instalments due on or before `date` — today's desk plus catch-up of missed days. */
export async function getDueToday(branchId: string | null, date = todayISO()) {
  const scope = [
    lte(payoutInstalments.dueOn, date),
    sql`${payoutInstalments.status} NOT IN ('SUPERSEDED','CANCELLED','PAID')`,
    sql`${maturityCases.status} IN ('APPROVED','IN_PROGRESS')`,
    ...(branchId ? [eq(maturityCases.branchId, branchId)] : []),
  ];

  return db
    .select({
      instalmentId: payoutInstalments.id,
      seq: payoutInstalments.seq,
      dueOn: payoutInstalments.dueOn,
      amountPaise: payoutInstalments.amountPaise,
      cashLegPaise: payoutInstalments.cashLegPaise,
      onlineLegPaise: payoutInstalments.onlineLegPaise,
      paidCashPaise: payoutInstalments.paidCashPaise,
      paidOnlinePaise: payoutInstalments.paidOnlinePaise,
      status: payoutInstalments.status,
      isFinal: payoutInstalments.isFinal,
      caseId: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      caseStatus: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      casePaidCashPaise: maturityCases.paidCashPaise,
      casePaidOnlinePaise: maturityCases.paidOnlinePaise,
      deadlineOn: maturityCases.deadlineOn,
      branchId: maturityCases.branchId,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(and(...scope))
    .orderBy(payoutInstalments.dueOn, maturityCases.caseNumber);
}

/** Pay today's approved amount (or any amount up to remaining) against the case. */
export async function recordRegisterPayout(
  actor: SessionUser,
  input: {
    caseId: string;
    cashPaise: bigint;
    onlinePaise: bigint;
    reference?: string | null;
    remarks?: string | null;
    valueDate?: string;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Row not found', 'NOT_FOUND');
    if (!PAYABLE_STATUSES.has(c.status)) {
      throw new PayoutError('This row is not open for payment.', 'NOT_PAYABLE');
    }

    const total = input.cashPaise + input.onlinePaise;
    if (total <= 0n) throw new PayoutError('Enter an amount to pay.', 'ZERO');
    const remaining = c.maturityAmountPaise - c.paidCashPaise - c.paidOnlinePaise;
    if (total > remaining) {
      throw new PayoutError(
        `Cannot pay ${formatPaise(total)} — only ${formatPaise(remaining)} is left.`,
        'EXCEEDS_REMAINING',
      );
    }
    if (input.onlinePaise > 0n && !input.reference?.trim()) {
      throw new PayoutError('Online payment needs a UTR / reference.', 'REF_REQUIRED');
    }

    const valueDate = input.valueDate ?? todayISO();
    await tx.insert(payoutTransactions).values({
      id: newId('txn'),
      caseId: c.id,
      instalmentId: null,
      branchId: c.branchId,
      cashPaise: input.cashPaise,
      onlinePaise: input.onlinePaise,
      totalPaise: total,
      reference: input.reference?.trim() || null,
      remarks: input.remarks?.trim() || null,
      valueDate,
      recordedById: actor.id,
    });

    const paidCash = c.paidCashPaise + input.cashPaise;
    const paidOnline = c.paidOnlinePaise + input.onlinePaise;
    const newRemaining = c.maturityAmountPaise - paidCash - paidOnline;
    const todayLeft = c.todayApprovedPaise > total ? c.todayApprovedPaise - total : 0n;

    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: paidCash,
        paidOnlinePaise: paidOnline,
        todayApprovedPaise: newRemaining <= 0n ? 0n : todayLeft,
        status: newRemaining <= 0n ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: newRemaining <= 0n ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, c.id));

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'PAYMENT_RECORDED',
      actorId: actor.id,
      note: `Paid ${formatPaise(total)} (${formatPaise(input.cashPaise)} cash / ${formatPaise(input.onlinePaise)} online)`,
    });
    await writeAudit(tx, actor, {
      action: 'payout.recorded',
      entity: 'MaturityCase',
      entityId: c.id,
      branchId: c.branchId,
      summary: `${c.caseNumber}: paid ${formatPaise(total)}`,
      ...meta,
    });

    return { remainingPaise: newRemaining, caseCompleted: newRemaining <= 0n };
  });
}

/**
 * Settle a register row — one figure at the counter, across every day it actually pays.
 *
 * The "Paid today" box used to post against a single instalment: today's. A customer who missed
 * yesterday and came in owing two days could not be served from it, because the server refused
 * anything above that one day's planned amount — and a case with nothing scheduled today had no
 * instalment to post against at all. The cashier's options were to under-record or to go hunting
 * on the case page.
 *
 * `planSettlement` decides which days the money clears: oldest first, cash before online, never
 * reaching past today unless a reason authorises it. This writes that decision down as one
 * `payout_transactions` row per day, all carrying today's value date — so the customer sees one
 * receipt while the day-by-day schedule still means exactly what it says.
 *
 * The box REPLACES today's figure rather than adding to it, which is what the cell has always
 * meant and what a spreadsheet user expects. So today's existing receipts for this case are
 * reversed first and the new figure is allocated against the rolled-back state. Reversal is a
 * new row's worth of history, never an erasure: INV-6 holds.
 *
 * Lock order matches `recordPayout` — CASE first, then its instalments — so the two paths queue
 * behind one another instead of deadlocking.
 */
export async function settleRegisterRow(
  actor: SessionUser,
  input: {
    caseId: string;
    cashPaise: bigint;
    onlinePaise: bigint;
    reference?: string | null;
    reason?: string | null;
    valueDate?: string;
  },
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  if (input.cashPaise < 0n || input.onlinePaise < 0n) {
    throw new PayoutError('Paid amounts cannot be negative.', 'NEGATIVE');
  }

  return db.transaction(async (tx) => {
    const [c] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, input.caseId))
      .for('update')
      .limit(1);
    if (!c) throw new PayoutError('Case not found', 'NOT_FOUND');

    const valueDate = input.valueDate ?? todayISO();

    // The live schedule only. A superseded row is history and must never take money.
    const live = await tx
      .select()
      .from(payoutInstalments)
      .where(
        and(
          eq(payoutInstalments.caseId, c.id),
          sql`${payoutInstalments.status} NOT IN ('SUPERSEDED','CANCELLED')`,
        ),
      )
      .for('update')
      .orderBy(payoutInstalments.dueOn, payoutInstalments.seq);
    if (live.length === 0) {
      throw new PayoutError('This case has no live schedule to pay against.', 'NO_SCHEDULE');
    }

    /**
     * Everything already taken from this customer today, whichever day each receipt settled.
     *
     * Read inside the lock: replacing a figure is only safe if a second cashier cannot slip a
     * payment in between the read and the write.
     */
    const todayTxns = await tx
      .select()
      .from(payoutTransactions)
      .where(
        and(
          eq(payoutTransactions.caseId, c.id),
          eq(payoutTransactions.valueDate, valueDate),
          isNull(payoutTransactions.reversedAt),
        ),
      )
      .for('update');

    if (todayTxns.length > 0 && !input.reason?.trim()) {
      throw new PayoutError('Enter a reason for changing a recorded payment.', 'REASON_REQUIRED');
    }

    const rolledBack = new Map<string, { cash: bigint; online: bigint }>();
    for (const t of todayTxns) {
      if (!t.instalmentId) continue;
      const prev = rolledBack.get(t.instalmentId) ?? { cash: 0n, online: 0n };
      rolledBack.set(t.instalmentId, {
        cash: prev.cash + t.cashPaise,
        online: prev.online + t.onlinePaise,
      });
    }
    const undoCash = todayTxns.reduce((sum, t) => sum + t.cashPaise, 0n);
    const undoOnline = todayTxns.reduce((sum, t) => sum + t.onlinePaise, 0n);

    /** The state as it stood before anyone paid anything today. */
    const baseline = live.map((i) => {
      const undo = rolledBack.get(i.id) ?? { cash: 0n, online: 0n };
      return {
        row: i,
        paidCashPaise: i.paidCashPaise - undo.cash,
        paidOnlinePaise: i.paidOnlinePaise - undo.online,
        changed: undo.cash > 0n || undo.online > 0n,
      };
    });
    const baseCaseCash = c.paidCashPaise - undoCash;
    const baseCaseOnline = c.paidOnlinePaise - undoOnline;

    if (
      baseCaseCash < 0n ||
      baseCaseOnline < 0n ||
      baseline.some((b) => b.paidCashPaise < 0n || b.paidOnlinePaise < 0n)
    ) {
      throw new PayoutError(
        'The payout ledger is inconsistent; nothing was recorded.',
        'LEDGER_MISMATCH',
      );
    }

    const plan = planSettlement(
      {
        cashPaise: input.cashPaise,
        onlinePaise: input.onlinePaise,
        reference: input.reference,
        reason: input.reason,
      },
      {
        instalments: baseline.map((b) => ({
          id: b.row.id,
          seq: b.row.seq,
          dueOn: b.row.dueOn,
          amountPaise: b.row.amountPaise,
          paidCashPaise: b.paidCashPaise,
          paidOnlinePaise: b.paidOnlinePaise,
        })),
        today: valueDate,
        caseTotalPaise: c.maturityAmountPaise,
        casePaidTotalPaise: baseCaseCash + baseCaseOnline,
        caseIsPayable: PAYABLE_STATUSES.has(c.status) || c.status === 'COMPLETED',
        // Today's cash was just rolled back, so the cap is measured against the new figure alone.
        cashAlreadyPaidTodayPaise: 0n,
        cashCapPerDayPaise: c.cashPolicy === 'CASH_CAP' ? (c.cashCapPerDayPaise ?? 0n) : null,
      },
    );
    if (!plan.ok) throw new PayoutError(plan.message, plan.code);

    const now = new Date();

    if (todayTxns.length > 0) {
      await tx
        .update(payoutTransactions)
        .set({
          reversedAt: now,
          reversedById: actor.id,
          reversalReason: input.reason?.trim() || 'Register correction',
        })
        .where(inArray(payoutTransactions.id, todayTxns.map((t) => t.id)));
    }

    const allocation = new Map(plan.lines.map((l) => [l.instalmentId, l]));
    const txnIds: string[] = [];

    for (const b of baseline) {
      const line = allocation.get(b.row.id);
      if (!line && !b.changed) continue; // untouched by today, before or after

      const newCash = b.paidCashPaise + (line?.cashPaise ?? 0n);
      const newOnline = b.paidOnlinePaise + (line?.onlinePaise ?? 0n);
      const paid = newCash + newOnline;

      await tx
        .update(payoutInstalments)
        .set({
          paidCashPaise: newCash,
          paidOnlinePaise: newOnline,
          status: paid >= b.row.amountPaise ? 'PAID' : paid > 0n ? 'PARTIAL' : 'PENDING',
          updatedAt: now,
        })
        .where(eq(payoutInstalments.id, b.row.id));

      if (!line) continue;
      const txnId = newId('txn');
      txnIds.push(txnId);
      await tx.insert(payoutTransactions).values({
        id: txnId,
        caseId: c.id,
        instalmentId: b.row.id,
        branchId: c.branchId,
        cashPaise: line.cashPaise,
        onlinePaise: line.onlinePaise,
        totalPaise: line.totalPaise,
        reference: input.reference?.trim() || null,
        remarks:
          plan.lines.length > 1
            ? `One counter payment of ${formatPaise(plan.totalPaise)} settling ${plan.lines.length} days`
            : null,
        valueDate,
        recordedById: actor.id,
      });
    }

    const newCaseCash = baseCaseCash + input.cashPaise;
    const newCaseOnline = baseCaseOnline + input.onlinePaise;
    const casePaid = newCaseCash + newCaseOnline;
    const complete = casePaid >= c.maturityAmountPaise;

    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: newCaseCash,
        paidOnlinePaise: newCaseOnline,
        status: complete ? 'COMPLETED' : c.status === 'APPROVED' ? 'IN_PROGRESS' : c.status,
        completedAt: complete ? (c.completedAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(maturityCases.id, c.id));

    const dayList = plan.lines
      .map((l) => `day ${l.seq} (${l.dueOn}) ${formatPaise(l.totalPaise)}`)
      .join(', ');

    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId: c.id,
      type: 'PAYMENT_RECORDED',
      actorId: actor.id,
      note:
        `${formatPaise(plan.totalPaise)} taken at the counter — ${dayList}` +
        (plan.arrearsClearedPaise > 0n
          ? ` · ${formatPaise(plan.arrearsClearedPaise)} cleared missed days`
          : '') +
        (plan.paidAheadPaise > 0n
          ? ` · ${formatPaise(plan.paidAheadPaise)} paid ahead — ${input.reason?.trim()}`
          : ''),
    });

    if (complete) {
      await tx.insert(caseEvents).values({
        id: newId('evt'),
        caseId: c.id,
        type: 'COMPLETED',
        actorId: actor.id,
        toStatus: 'COMPLETED',
        note: `Fully paid — ${formatPaise(c.maturityAmountPaise)}`,
      });
    }

    await writeAudit(tx, actor, {
      action: 'payout.recorded',
      entity: 'MaturityCase',
      entityId: c.id,
      branchId: c.branchId,
      summary:
        `${c.caseNumber}: ${formatPaise(plan.totalPaise)} taken at the counter across ` +
        `${plan.lines.length} day(s) — ${dayList}` +
        (todayTxns.length > 0 ? ` (replaced ${formatPaise(undoCash + undoOnline)})` : '') +
        (plan.paidAheadPaise > 0n ? ` (paid ahead: ${input.reason?.trim()})` : ''),
      before: {
        casePaidPaise: c.paidCashPaise + c.paidOnlinePaise,
        reversedTodayPaise: undoCash + undoOnline,
      },
      after: {
        casePaidPaise: casePaid,
        caseRemainingPaise: c.maturityAmountPaise - casePaid,
        arrearsClearedPaise: plan.arrearsClearedPaise,
        paidAheadPaise: plan.paidAheadPaise,
        transactionIds: txnIds,
        complete,
      },
      ...meta,
    });

    return {
      ok: true as const,
      totalPaise: plan.totalPaise,
      daysSettled: plan.lines.length,
      arrearsClearedPaise: plan.arrearsClearedPaise,
      paidAheadPaise: plan.paidAheadPaise,
      remainingPaise: c.maturityAmountPaise - casePaid,
      caseCompleted: complete,
    };
  });
}
