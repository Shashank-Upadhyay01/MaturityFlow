'use server';

import { revalidatePath } from 'next/cache';
import { and, count, eq, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { maturityCases, payoutInstalments } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { payoutPlanFor, standardPayoutPartsFor } from '@/lib/payout-policy';
import { assertCan } from '@/lib/rbac';
import { rescheduleCase } from '@/services/case-service';
import { reconcileCaseLedger } from '@/services/operations-health';
import { ok, toActionError, type ActionResult } from './_result';

export async function reconcileCaseLedgerAction(caseId: string, reason: string): Promise<ActionResult<{ changed: boolean }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'settings.manage');
    const result = await reconcileCaseLedger(session, caseId, reason, await requestMeta());
    revalidatePath('/', 'layout');
    return ok(result);
  } catch (e) {
    return toActionError(e);
  }
}

/** Admin recovery: make carried paid rows consume slots in the configured 12/6-part plan. */
export async function normalizeSchedulePartsAction(): Promise<ActionResult<{ normalized: number; skipped: number; failed: number }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'settings.manage');
    const cases = await db.select({
      id: maturityCases.id,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      windowDays: maturityCases.windowDays,
      scheduleVersion: maturityCases.scheduleVersion,
      status: maturityCases.status,
    }).from(maturityCases).where(notInArray(maturityCases.status, ['CANCELLED', 'REJECTED', 'COMPLETED']));
    const counts = await db.select({
      caseId: payoutInstalments.caseId,
      scheduleVersion: payoutInstalments.scheduleVersion,
      parts: count(),
    }).from(payoutInstalments).where(notInArray(payoutInstalments.status, ['SUPERSEDED', 'CANCELLED']))
      .groupBy(payoutInstalments.caseId, payoutInstalments.scheduleVersion);
    const byVersion = new Map(counts.map((row) => [`${row.caseId}:${row.scheduleVersion}`, row.parts]));
    const affected = cases.filter((row) => {
      if (row.maturityAmountPaise - row.paidCashPaise - row.paidOnlinePaise <= 0n) return false;
      const actual = byVersion.get(`${row.id}:${row.scheduleVersion}`) ?? 0;
      const configured = payoutPlanFor(row.maturityAmountPaise, row.windowDays).payoutDays;
      return actual > Math.min(configured, standardPayoutPartsFor(row.maturityAmountPaise));
    });
    let normalized = 0;
    let failed = 0;
    const meta = await requestMeta();
    for (const row of affected) {
      try {
        await rescheduleCase(session, row.id, 'Admin normalized excess schedule parts to the configured total; receipts and paid amounts retained.', meta);
        normalized++;
      } catch {
        failed++;
      }
    }
    revalidatePath('/', 'layout');
    return ok({ normalized, skipped: cases.length - affected.length, failed });
  } catch (e) {
    return toActionError(e);
  }
}
