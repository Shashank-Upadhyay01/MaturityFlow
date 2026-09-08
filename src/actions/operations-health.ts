'use server';

import { revalidatePath } from 'next/cache';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { assertCan } from '@/lib/rbac';
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
