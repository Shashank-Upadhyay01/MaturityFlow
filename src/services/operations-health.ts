import 'server-only';

import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';
import { db } from '@/db';
import { branches, caseEvents, customers, maturityCases, payoutInstalments, payoutTransactions } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { toActor, type SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { inspectCaseLedger } from '@/lib/ledger-health';
import { assertCan, type Actor } from '@/lib/rbac';
import { canTransition, WorkflowError } from './case-service';

const PAGE_SIZE = 100;

/** A bounded, consistent read: the case and receipt snapshots cannot straddle a live payout. */
export async function getOperationsHealth(actor: Actor, input: { page?: number; search?: string } = {}) {
  assertCan(actor, 'settings.manage');
  const requestedPage = Number.isSafeInteger(input.page) && input.page! > 0 ? Math.min(input.page!, 100_000) : 1;
  const search = (input.search ?? '').trim().slice(0, 120);
  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const filter = search ? or(ilike(maturityCases.caseNumber, pattern), ilike(customers.name, pattern), ilike(customers.accountNumber, pattern)) : undefined;
  return db.transaction(async (tx) => {
    const [n] = await tx.select({ count: count() }).from(maturityCases).innerJoin(customers, eq(customers.id, maturityCases.customerId)).where(filter);
    const totalCases = n?.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(totalCases / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const cases = await tx.select({ c: maturityCases, customerName: customers.name, accountNumber: customers.accountNumber, branchCode: branches.code })
      .from(maturityCases).innerJoin(customers, eq(customers.id, maturityCases.customerId)).innerJoin(branches, eq(branches.id, maturityCases.branchId))
      .where(filter).orderBy(asc(maturityCases.caseNumber), asc(maturityCases.id)).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const ids = cases.map((row) => row.c.id);
    const instalments = ids.length ? await tx.select().from(payoutInstalments).where(inArray(payoutInstalments.caseId, ids)) : [];
    const receipts = ids.length ? await tx.select().from(payoutTransactions).where(inArray(payoutTransactions.caseId, ids)) : [];
    const byCase = <T extends { caseId: string }>(rows: T[]) => {
      const groups = new Map<string, T[]>();
      for (const row of rows) {
        const existing = groups.get(row.caseId);
        if (existing) existing.push(row);
        else groups.set(row.caseId, [row]);
      }
      return groups;
    };
    const schedules = byCase(instalments);
    const transactions = byCase(receipts);
    const inspected = cases.map(({ c, ...identity }) => ({
      ...identity, id: c.id, caseNumber: c.caseNumber, status: c.status,
      storedPaidPaise: c.paidCashPaise + c.paidOnlinePaise,
      ...inspectCaseLedger(c, schedules.get(c.id) ?? [], transactions.get(c.id) ?? []),
    }));
    return { checkedAt: new Date(), page, pageCount, totalCases, search, checked: inspected.length, healthy: inspected.filter((row) => row.issues.length === 0).length, cases: inspected.filter((row) => row.issues.length > 0) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/** Restore derived totals only; money, receipts, schedule dates and planned amounts stay intact. */
export async function reconcileCaseLedger(session: SessionUser, caseId: string, reason: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const actor = toActor(session);
  assertCan(actor, 'settings.manage');
  if (reason.trim().length < 10 || reason.trim().length > 1000) throw new WorkflowError('Explain the reconciliation in 10–1000 characters.', 'VALIDATION');
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
    if (!c) throw new WorkflowError('Case not found.', 'NOT_FOUND');
    assertCan(actor, 'settings.manage', { branchId: c.branchId });
    const instalments = await tx.select().from(payoutInstalments).where(eq(payoutInstalments.caseId, c.id)).for('update');
    const receipts = await tx.select().from(payoutTransactions).where(eq(payoutTransactions.caseId, c.id)).for('update');
    const result = inspectCaseLedger(c, instalments, receipts);
    if (!result.issues.length) return { changed: false };
    if (!result.repairable) throw new WorkflowError(result.issues.filter((i) => i.blocking).map((i) => i.message).join(' '), 'LEDGER_REVIEW');
    if (result.expectedStatus !== c.status && !canTransition(c.status, result.expectedStatus)) {
      throw new WorkflowError('This case needs its workflow reviewed before reconciliation.', 'INVALID_TRANSITION');
    }
    const changedAt = new Date();
    for (const repair of result.instalmentRepairs) {
      const { id, ...values } = repair;
      await tx.update(payoutInstalments).set({ ...values, updatedAt: changedAt }).where(and(eq(payoutInstalments.id, id), eq(payoutInstalments.caseId, c.id)));
    }
    await tx.update(maturityCases).set({
      paidCashPaise: result.cashPaise, paidOnlinePaise: result.onlinePaise, status: result.expectedStatus,
      completedAt: result.expectedStatus === 'COMPLETED' ? c.completedAt ?? changedAt : c.completedAt,
      updatedAt: changedAt,
    }).where(eq(maturityCases.id, c.id));
    await tx.insert(caseEvents).values({ id: newId('evt'), caseId: c.id, type: 'EDITED', actorId: session.id, note: `Paid totals reconciled from recorded receipts: ${reason.trim()}` });
    await writeAudit(tx, session, {
      action: 'case.updated', entity: 'MaturityCase', entityId: c.id, branchId: c.branchId,
      summary: `${c.caseNumber}: reconciled paid totals from recorded receipts. ${reason.trim()}`,
      before: { paidCashPaise: c.paidCashPaise, paidOnlinePaise: c.paidOnlinePaise, status: c.status, instalments: instalments.filter((i) => result.instalmentRepairs.some((r) => r.id === i.id)).map((i) => ({ id: i.id, paidCashPaise: i.paidCashPaise, paidOnlinePaise: i.paidOnlinePaise, status: i.status })) },
      after: { paidCashPaise: result.cashPaise, paidOnlinePaise: result.onlinePaise, status: result.expectedStatus, instalments: result.instalmentRepairs, reason: reason.trim(), source: 'unreversed payout_transactions' },
      ...meta,
    });
    return { changed: true };
  });
}
