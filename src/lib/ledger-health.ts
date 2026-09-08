import type { MaturityCase, PayoutInstalment, PayoutTransaction } from '@/db/schema';

type CaseLedger = Pick<MaturityCase, 'id' | 'branchId' | 'maturityAmountPaise' | 'paidCashPaise' | 'paidOnlinePaise' | 'status' | 'scheduleVersion'>;
type InstalmentLedger = Pick<PayoutInstalment, 'id' | 'caseId' | 'scheduleVersion' | 'amountPaise' | 'cashLegPaise' | 'onlineLegPaise' | 'paidCashPaise' | 'paidOnlinePaise' | 'status'>;
type ReceiptLedger = Pick<PayoutTransaction, 'id' | 'caseId' | 'branchId' | 'instalmentId' | 'cashPaise' | 'onlinePaise' | 'totalPaise' | 'reversedAt'>;

export interface LedgerIssue {
  code: string;
  message: string;
  /** A receipt or plan needs human investigation before any cached total can be repaired. */
  blocking: boolean;
}

/** Compare cached totals against recorded, unreversed receipts without modifying the ledger. */
export function inspectCaseLedger(c: CaseLedger, instalments: readonly InstalmentLedger[], receipts: readonly ReceiptLedger[]) {
  const issues: LedgerIssue[] = [];
  const issue = (code: string, message: string, blocking = true) => issues.push({ code, message, blocking });
  const totals = new Map(instalments.map((i) => [i.id, { cashPaise: 0n, onlinePaise: 0n }]));
  let cashPaise = 0n;
  let onlinePaise = 0n;
  let unallocatedPaise = 0n;
  for (const r of receipts) {
    if (r.reversedAt) continue;
    if (r.caseId !== c.id || r.branchId !== c.branchId) {
      issue('RECEIPT_SCOPE', `Receipt ${r.id} belongs to a different case or branch.`);
    }
    if (r.cashPaise < 0n || r.onlinePaise < 0n || r.totalPaise <= 0n || r.cashPaise + r.onlinePaise !== r.totalPaise) {
      issue('RECEIPT_AMOUNT', `Receipt ${r.id} has an invalid cash/online split.`);
    }
    cashPaise += r.cashPaise;
    onlinePaise += r.onlinePaise;
    if (r.instalmentId === null) {
      unallocatedPaise += r.totalPaise;
    } else {
      const total = totals.get(r.instalmentId);
      if (!total) issue('RECEIPT_LINK', `Receipt ${r.id} points to an instalment outside this case.`);
      else {
        total.cashPaise += r.cashPaise;
        total.onlinePaise += r.onlinePaise;
      }
    }
  }
  if (unallocatedPaise > 0n) {
    issue('UNALLOCATED_RECEIPTS', 'Older payments have no instalment allocation. Review their receipts before repairing the schedule.');
  }
  const paidPaise = cashPaise + onlinePaise;
  if (paidPaise > c.maturityAmountPaise) issue('OVERPAYMENT', 'Recorded receipts exceed the maturity amount. Review or reverse an incorrect receipt.');
  const caseTotalsDiffer = c.paidCashPaise !== cashPaise || c.paidOnlinePaise !== onlinePaise;
  if (caseTotalsDiffer) issue('CASE_TOTAL', 'The case paid totals differ from its recorded receipts.', false);

  const instalmentRepairs: { id: string; paidCashPaise: bigint; paidOnlinePaise: bigint; status: PayoutInstalment['status'] }[] = [];
  let scheduledPaise = 0n;
  let activeCount = 0;
  for (const i of instalments) {
    if (i.caseId !== c.id) issue('INSTALMENT_SCOPE', `Instalment ${i.id} belongs to another case.`);
    const total = totals.get(i.id)!;
    const paid = total.cashPaise + total.onlinePaise;
    // MISSED rows from an older version are retained as promise history; only the case's current
    // version is the live financial plan.
    const inactive = i.scheduleVersion !== c.scheduleVersion || i.status === 'SUPERSEDED' || i.status === 'CANCELLED';
    if (!inactive) {
      activeCount++;
      scheduledPaise += i.amountPaise;
      if (i.scheduleVersion !== c.scheduleVersion) issue('OLD_ACTIVE_SCHEDULE', 'An older schedule still has active instalments. Review the schedule versions.');
    } else if (paid > 0n && i.status !== 'MISSED') {
      issue('INACTIVE_RECEIPT', 'A recorded payment is attached to a cancelled or superseded instalment.');
    }
    if (i.amountPaise <= 0n || i.cashLegPaise < 0n || i.onlineLegPaise < 0n || i.cashLegPaise + i.onlineLegPaise !== i.amountPaise) {
      issue('INSTALMENT_AMOUNT', `Instalment ${i.id} has an invalid planned amount.`);
    }
    if (paid > i.amountPaise) issue('INSTALMENT_OVERPAID', 'A receipt exceeds its instalment amount. Review and rebalance the remaining schedule.');
    // A no-payment mark is an observation: preserve MISSED when the receipt total is zero.
    const status = inactive ? i.status : paid >= i.amountPaise ? 'PAID' : paid > 0n ? 'PARTIAL' : i.status === 'MISSED' ? 'MISSED' : 'PENDING';
    if (i.paidCashPaise !== total.cashPaise || i.paidOnlinePaise !== total.onlinePaise || i.status !== status) {
      instalmentRepairs.push({ id: i.id, paidCashPaise: total.cashPaise, paidOnlinePaise: total.onlinePaise, status });
    }
  }
  if (instalmentRepairs.length) issue('INSTALMENT_TOTAL', `${instalmentRepairs.length} instalment paid totals or payment statuses differ from their receipts.`, false);
  const expectsSchedule = ['APPROVED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'].includes(c.status);
  if ((expectsSchedule || activeCount > 0) && c.status !== 'CANCELLED' && scheduledPaise !== c.maturityAmountPaise) {
    issue('SCHEDULE_TOTAL', 'The active schedule does not add up to the maturity amount. Review the remaining schedule.');
  }

  let expectedStatus = c.status;
  if (c.status === 'APPROVED' || c.status === 'IN_PROGRESS') {
    expectedStatus = paidPaise === c.maturityAmountPaise ? 'COMPLETED' : paidPaise > 0n ? 'IN_PROGRESS' : c.status;
  }
  if (expectedStatus !== c.status) issue('CASE_PROGRESS', 'Case progress has not caught up with its recorded receipts.', false);
  if (c.status === 'COMPLETED' && paidPaise !== c.maturityAmountPaise) issue('COMPLETED_BALANCE', 'This completed case still has an outstanding balance. Review its receipts and status.');
  if (['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'REJECTED', 'CANCELLED'].includes(c.status) && paidPaise > 0n) {
    issue('PAYMENT_STATUS', 'Recorded payments exist on a case that is not open for payment.');
  }
  // Repeated corrupt rows must not produce an unreadable list of identical warnings.
  const uniqueIssues = issues.filter((item, index) => issues.findIndex((other) => other.code === item.code) === index);
  return {
    cashPaise, onlinePaise, paidPaise, scheduledPaise, unallocatedPaise,
    remainingPaise: c.maturityAmountPaise - paidPaise,
    caseTotalsDiffer, instalmentRepairs, expectedStatus,
    issues: uniqueIssues,
    repairable: uniqueIssues.length > 0 && !uniqueIssues.some((i) => i.blocking),
  };
}
