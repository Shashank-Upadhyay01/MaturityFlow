'use server';

import { revalidatePath } from 'next/cache';

import { requestMeta, requireActor } from '@/lib/auth/session';
import { assertCan } from '@/lib/rbac';
import { parseRegisterGrid } from '@/lib/excel-register';
import { importRegisterRows } from '@/services/import-service';
import { fail, ok, toActionError, type ActionResult } from './_result';

export async function importRegisterAction(
  branchId: string,
  grid: unknown[][],
): Promise<ActionResult<{ created: number; skipped: number; warnings: string[]; errors: string[] }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'data.import', { branchId });
    if (!branchId) return fail('Choose a branch', 'VALIDATION');

    const parsed = parseRegisterGrid(grid);
    if (parsed.rows.length === 0) {
      return fail(parsed.errors[0] ?? 'No data rows found', 'VALIDATION');
    }

    const result = await importRegisterRows(session, branchId, parsed.rows, await requestMeta());
    result.errors.push(...parsed.errors);

    revalidatePath('/dashboard');
    revalidatePath('/maturities');
    revalidatePath('/cash-planner');
    revalidatePath('/agents');
    revalidatePath('/payouts');
    revalidatePath('/reports');
    return ok(result);
  } catch (e) {
    return toActionError(e);
  }
}
