import 'server-only';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '@/db';
import { maturityCases, payoutInstalments, payoutTransactions, type MaturityCase, type PayoutInstalment } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { reconcileInstalmentLegs } from '@/lib/payment-rules';

export class LedgerConsistencyError extends Error {
  readonly code = 'LEDGER_MISMATCH';
}

const mismatch = () => new LedgerConsistencyError(
  'The schedule, paid totals and receipts disagree. Review this case in Operations Health before changing its payments.',
);

/**
 * Called only after the parent CASE lock. Receipts are the source of truth.
 * Legacy register imports recorded a receipt without an instalment; allocate those receipts
 * once, retaining their original amount, tender and value date and an audited reversal chain.
 * Never infer missing receipts from a cached paid total.
 */
export async function ensureAllocatedLedgerInTx(
  tx: Tx,
  actor: Pick<SessionUser, 'id' | 'name' | 'role'>,
  c: MaturityCase,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<Map<string, string[]>> {
  const rows = await tx.select().from(payoutInstalments)
    .where(eq(payoutInstalments.caseId, c.id)).for('update');
  const receipts = await tx.select().from(payoutTransactions)
    .where(and(eq(payoutTransactions.caseId, c.id), isNull(payoutTransactions.reversedAt)))
    .for('update');
  const paidCash = receipts.reduce((sum, r) => sum + r.cashPaise, 0n);
  const paidOnline = receipts.reduce((sum, r) => sum + r.onlinePaise, 0n);
  if (paidCash !== c.paidCashPaise || paidOnline !== c.paidOnlinePaise) throw mismatch();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const totals = new Map(rows.map((row) => [row.id, { cash: 0n, online: 0n }]));
  for (const r of receipts) {
    if (r.branchId !== c.branchId || r.cashPaise < 0n || r.onlinePaise < 0n || r.totalPaise <= 0n ||
      r.totalPaise !== r.cashPaise + r.onlinePaise) throw mismatch();
    if (r.instalmentId) {
      const inst = byId.get(r.instalmentId);
      const amount = totals.get(r.instalmentId);
      if (!inst || !amount || inst.status === 'SUPERSEDED' || inst.status === 'CANCELLED') throw mismatch();
      amount.cash += r.cashPaise;
      amount.online += r.onlinePaise;
    }
  }
  for (const row of rows) {
    const total = totals.get(row.id)!;
    if (row.paidCashPaise !== total.cash || row.paidOnlinePaise !== total.online) throw mismatch();
  }
  // MISSED rows from earlier versions are historical promises whose money has already been
  // included in the current replacement schedule. Counting them again makes a valid rollover
  // look over-allocated the next time any payment is edited.
  const live = rows.filter((row) => row.scheduleVersion === c.scheduleVersion &&
      row.status !== 'SUPERSEDED' && row.status !== 'CANCELLED')
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.seq - b.seq);
  const scheduled = live.reduce((sum, row) => sum + row.amountPaise, 0n);
  const legacy = receipts.filter((r) => !r.instalmentId);
  const unallocated = legacy.reduce((sum, row) => sum + row.totalPaise, 0n);
  const historicalPaid = receipts.reduce((sum, receipt) => {
    if (!receipt.instalmentId) return sum;
    const row = byId.get(receipt.instalmentId);
    return row && row.scheduleVersion !== c.scheduleVersion && row.status === 'MISSED'
      ? sum + receipt.totalPaise
      : sum;
  }, 0n);
  const missingHistory = c.maturityAmountPaise - scheduled;
  // A rollover carries only the unpaid balance into the new version. Money already paid against
  // an older row remains attached to that historical MISSED promise, so it is intentionally absent
  // from the current version's planned total. Treat it exactly like an unallocated legacy receipt
  // when proving that the current schedule plus payment history still covers the maturity amount.
  if (missingHistory !== 0n && missingHistory !== unallocated + historicalPaid) throw mismatch();
  const allocatedIds = new Map<string, string[]>();
  if (!legacy.length) return allocatedIds;

  const now = new Date();
  const replacementIds: string[] = [];
  const version = c.scheduleVersion || 1;
  let seq = rows.reduce((max, row) => Math.max(max, row.seq), 0);
  for (const receipt of legacy) {
    const receiptReplacementIds: string[] = [];
    allocatedIds.set(receipt.id, receiptReplacementIds);
    const allocations: { row: PayoutInstalment; cash: bigint; online: bigint }[] = [];
    if (missingHistory > 0n) {
      // The import scheduled only the outstanding balance. Its existing receipt supplies the
      // exact historical date and tender; adding its paid row completes the full case plan.
      const [historical] = await tx.insert(payoutInstalments).values({
        id: newId('inst'), caseId: c.id, scheduleVersion: version, seq: ++seq,
        dueOn: receipt.valueDate, amountPaise: receipt.totalPaise,
        cashLegPaise: receipt.cashPaise, onlineLegPaise: receipt.onlinePaise,
        paidCashPaise: receipt.cashPaise, paidOnlinePaise: receipt.onlinePaise,
        status: 'PAID', isFinal: false,
      }).returning();
      live.push(historical);
      allocations.push({ row: historical, cash: receipt.cashPaise, online: receipt.onlinePaise });
    } else {
      let cash = receipt.cashPaise;
      let online = receipt.onlinePaise;
      for (const row of live) {
        const capacity = row.amountPaise - row.paidCashPaise - row.paidOnlinePaise;
        if (capacity <= 0n || cash + online <= 0n) continue;
        const take = capacity < cash + online ? capacity : cash + online;
        const takeCash = cash < take ? cash : take;
        const takeOnline = take - takeCash;
        row.paidCashPaise += takeCash;
        row.paidOnlinePaise += takeOnline;
        const legs = reconcileInstalmentLegs(row.amountPaise, row.cashLegPaise, row.paidCashPaise, row.paidOnlinePaise);
        await tx.update(payoutInstalments).set({
          paidCashPaise: row.paidCashPaise, paidOnlinePaise: row.paidOnlinePaise,
          cashLegPaise: legs.cashPaise, onlineLegPaise: legs.onlinePaise,
          status: row.paidCashPaise + row.paidOnlinePaise === row.amountPaise ? 'PAID' : 'PARTIAL',
          updatedAt: now,
        }).where(eq(payoutInstalments.id, row.id));
        allocations.push({ row, cash: takeCash, online: takeOnline });
        cash -= takeCash;
        online -= takeOnline;
      }
      if (cash !== 0n || online !== 0n) throw mismatch();
    }
    for (const allocation of allocations) {
      const id = newId('txn');
      replacementIds.push(id);
      receiptReplacementIds.push(id);
      await tx.insert(payoutTransactions).values({
        id, caseId: c.id, instalmentId: allocation.row.id, branchId: c.branchId,
        cashPaise: allocation.cash, onlinePaise: allocation.online,
        totalPaise: allocation.cash + allocation.online,
        reference: receipt.reference, valueDate: receipt.valueDate, recordedById: receipt.recordedById,
        remarks: `${receipt.remarks ?? 'Historical register payment'} · allocated from receipt ${receipt.id}`,
      });
    }
  }
  await tx.update(payoutTransactions).set({
    reversedAt: now, reversedById: actor.id, reversalReason: 'Historical receipt allocated to the case schedule; amount and value date unchanged.',
  }).where(inArray(payoutTransactions.id, legacy.map((row) => row.id)));
  live.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.seq - b.seq);
  const finalId = live[live.length - 1].id;
  await tx.update(payoutInstalments).set({ isFinal: false, updatedAt: now })
    .where(inArray(payoutInstalments.id, live.map((row) => row.id)));
  await tx.update(payoutInstalments).set({ isFinal: true }).where(eq(payoutInstalments.id, finalId));
  await tx.update(maturityCases).set({
    scheduleVersion: version, firstPayoutOn: live[0].dueOn,
    deadlineOn: live[live.length - 1].dueOn, updatedAt: now,
  }).where(eq(maturityCases.id, c.id));
  c.scheduleVersion = version;
  await writeAudit(tx, actor, {
    action: 'payout.corrected', entity: 'MaturityCase', entityId: c.id, branchId: c.branchId,
    summary: `${c.caseNumber}: allocated ${legacy.length} historical receipt(s) to the schedule without changing the paid total.`,
    before: { receiptIds: legacy.map((row) => row.id), scheduledPaise: scheduled, paidCashPaise: paidCash, paidOnlinePaise: paidOnline },
    after: { replacementReceiptIds: replacementIds, scheduledPaise: c.maturityAmountPaise, paidCashPaise: paidCash, paidOnlinePaise: paidOnline },
    ...meta,
  });
  return allocatedIds;
}
