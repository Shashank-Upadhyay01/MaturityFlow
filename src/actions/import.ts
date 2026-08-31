'use server';

import { revalidatePath } from 'next/cache';

import { requestMeta, requireActor } from '@/lib/auth/session';
import { ALL_BRANCHES } from '@/lib/branch-routing';
import { activeRole, assertCan } from '@/lib/rbac';
import { parseRegisterGrid } from '@/lib/excel-register';
import { parseForecastWorkbook, type ForecastSheetGrid } from '@/lib/maturity-forecast';
import { importCompiledRegisterRows, importRegisterRows } from '@/services/import-service';
import type { ImportBranchResult } from '@/services/import-service';
import { importMaturityForecast } from '@/services/forecast-service';
import { fail, ok, toActionError, type ActionResult } from './_result';

export async function importRegisterAction(
  branchId: string,
  grid: unknown[][],
): Promise<ActionResult<{
  created: number;
  skipped: number;
  warnings: string[];
  errors: string[];
  branches: ImportBranchResult[];
}>> {
  try {
    const { session, actor } = await requireActor();
    const compiled = branchId === ALL_BRANCHES;
    if (compiled) {
      if (!['ADMIN', 'CEO', 'CMD'].includes(activeRole(actor.role))) {
        return fail('Only Admin, CEO or CMD can import a compiled all-branch workbook', 'FORBIDDEN');
      }
      assertCan(actor, 'data.import');
    } else {
      if (!branchId) return fail('Choose a branch', 'VALIDATION');
      assertCan(actor, 'data.import', { branchId });
    }

    const parsed = parseRegisterGrid(grid);
    if (parsed.rows.length === 0) {
      return fail(parsed.errors[0] ?? 'No data rows found', 'VALIDATION');
    }

    const result = compiled
      ? await importCompiledRegisterRows(session, parsed.rows, await requestMeta())
      : await importRegisterRows(session, branchId, parsed.rows, await requestMeta());
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

export async function importMaturityForecastAction(
  branchId: string,
  workbookName: string,
  sheets: ForecastSheetGrid[],
): Promise<ActionResult<{
  created: number;
  updated: number;
  removed: number;
  parsed: number;
  errors: string[];
  warnings: string[];
}>> {
  try {
    const { session, actor } = await requireActor();
    if (!branchId) return fail('Choose a branch', 'VALIDATION');
    assertCan(actor, 'data.import', { branchId });
    const parsed = parseForecastWorkbook(sheets);
    if (parsed.rows.length === 0) {
      return fail(parsed.errors[0] ?? 'No upcoming maturity rows were found', 'VALIDATION');
    }
    const imported = await importMaturityForecast(
      session,
      branchId,
      workbookName || 'Maturity.xlsx',
      parsed.rows,
      await requestMeta(),
    );
    revalidatePath('/maturity-calendar');
    revalidatePath('/dashboard');
    return ok({ ...imported, parsed: parsed.rows.length, errors: parsed.errors, warnings: parsed.warnings });
  } catch (error) {
    return toActionError(error);
  }
}
