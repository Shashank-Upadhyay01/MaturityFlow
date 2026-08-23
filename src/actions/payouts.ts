'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { maturityCases, payoutInstalments, payoutTransactions } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { parseRupeesToPaise } from '@/lib/money';
import { assertCan, roleCan } from '@/lib/rbac';
import { recordPayout, recordRegisterPayout, reversePayout } from '@/services/payout-service';
import { fail, ok, toActionError, type ActionResult } from './_result';

const schema = z.object({
  instalmentId: z.string().min(1),
  cash: z.string().default('0'),
  online: z.string().default('0'),
  reference: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function payRegisterRowAction(
  caseId: string,
  cashRupees: string,
  onlineRupees = '0',
): Promise<ActionResult<{ remainingPaise: string; caseCompleted: boolean }>> {
  try {
    const { session, actor } = await requireActor();
    const [row] = await db
      .select({ branchId: maturityCases.branchId, agentId: maturityCases.agentId })
      .from(maturityCases)
      .where(eq(maturityCases.id, caseId))
      .limit(1);
    if (!row) return fail('Row not found', 'NOT_FOUND');
    assertCan(actor, 'payout.record', { branchId: row.branchId, agentId: row.agentId });

    let cash: bigint;
    let online: bigint;
    try {
      cash = cashRupees.trim() ? parseRupeesToPaise(cashRupees) : 0n;
      online = onlineRupees.trim() ? parseRupeesToPaise(onlineRupees) : 0n;
    } catch {
      return fail('Enter a valid amount', 'VALIDATION');
    }

    const res = await recordRegisterPayout(
      session,
      { caseId, cashPaise: cash, onlinePaise: online },
      await requestMeta(),
    );
    revalidateAll(caseId);
    return ok({ remainingPaise: res.remainingPaise.toString(), caseCompleted: res.caseCompleted });
  } catch (e) {
    return toActionError(e);
  }
}

function revalidateAll(caseId?: string) {
  revalidatePath('/payouts');
  revalidatePath('/dashboard');
  revalidatePath('/maturities');
  revalidatePath('/cash-planner');
  if (caseId) revalidatePath(`/maturities/${caseId}`);
}

export async function recordPayoutAction(
  _prev: ActionResult<{ remainingPaise: string; caseCompleted: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ remainingPaise: string; caseCompleted: boolean }>> {
  try {
    const { session, actor } = await requireActor();
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return fail('Check the amounts entered', 'VALIDATION');
    const d = parsed.data;

    const [row] = await db
      .select({ branchId: maturityCases.branchId, agentId: maturityCases.agentId, caseId: maturityCases.id })
      .from(payoutInstalments)
      .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
      .where(eq(payoutInstalments.id, d.instalmentId))
      .limit(1);
    if (!row) return fail('Instalment not found', 'NOT_FOUND');

    assertCan(actor, 'payout.record', { branchId: row.branchId });

    let cash: bigint;
    let online: bigint;
    try {
      cash = d.cash?.trim() ? parseRupeesToPaise(d.cash) : 0n;
      online = d.online?.trim() ? parseRupeesToPaise(d.online) : 0n;
    } catch {
      return fail('Enter valid amounts — digits only, up to 2 decimal places', 'VALIDATION');
    }

    const res = await recordPayout(
      session,
      {
        instalmentId: d.instalmentId,
        cashPaise: cash,
        onlinePaise: online,
        reference: d.reference || null,
        remarks: d.remarks || null,
        valueDate: d.valueDate,
        // Only an approving authority may exceed a planned daily amount.
        allowExceedInstalment: roleCan(actor.role, 'schedule.override'),
      },
      await requestMeta(),
    );

    revalidateAll(row.caseId);
    return ok({ remainingPaise: res.remainingPaise.toString(), caseCompleted: res.caseCompleted });
  } catch (e) {
    return toActionError(e);
  }
}

export async function reversePayoutAction(txnId: string, reason: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!reason?.trim()) return fail('A reason is required to reverse a payment.', 'VALIDATION');

    const [txn] = await db
      .select({ branchId: payoutTransactions.branchId, caseId: payoutTransactions.caseId })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.id, txnId))
      .limit(1);
    if (!txn) return fail('Transaction not found', 'NOT_FOUND');

    assertCan(actor, 'payout.reverse', { branchId: txn.branchId });
    await reversePayout(session, txnId, reason.trim(), await requestMeta());
    revalidateAll(txn.caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
