import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, eq, gte, lt, notInArray, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { agents, branches, maturityForecasts } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import type { ForecastImportRow } from '@/lib/maturity-forecast';
import { newId } from '@/lib/id';
import { activeRole, ROLE_SCOPE, type Actor } from '@/lib/rbac';

const paise = (value: number): bigint => {
  if (value <= 0 || !Number.isFinite(value)) return 0n;
  // Excel formula caches arrive as binary floats (for example 170882.07499999998 for
  // 170882.075). Nudge only the sub-paise representation before standard half-up rounding.
  return BigInt(Math.round(value * 100 + 1e-7));
};

function sourceKey(branchId: string, row: ForecastImportRow): string {
  return createHash('sha256')
    .update([
      branchId,
      row.accountNumber.trim(),
      row.customerName.trim().toLowerCase(),
      row.maturityOn,
    ].join('|'))
    .digest('hex');
}

export async function importMaturityForecast(
  actor: Pick<SessionUser, 'id' | 'name' | 'role'>,
  branchId: string,
  workbookName: string,
  rows: ForecastImportRow[],
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ created: number; updated: number; removed: number }> {
  return db.transaction(async (tx) => {
    const [branch] = await tx
      .select({ id: branches.id, code: branches.code })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.isActive, true)))
      .limit(1);
    if (!branch) throw new Error('Branch not found');

    const keys = rows.map((row) => sourceKey(branchId, row));
    const existing = new Set<string>();
    // Avoid a giant IN expression and keep the import predictable on the local database.
    for (const key of keys) {
      const [hit] = await tx
        .select({ sourceKey: maturityForecasts.sourceKey })
        .from(maturityForecasts)
        .where(eq(maturityForecasts.sourceKey, key))
        .limit(1);
      if (hit) existing.add(key);
    }

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const key = keys[index];
      const values = {
        sourceKey: key,
        branchId,
        accountNumber: row.accountNumber || null,
        customerName: row.customerName.trim(),
        agentName: row.agentName.trim() || null,
        planAmountPaise: paise(row.planRupees),
        totalDepositPaise: paise(row.totalDepositRupees),
        joinedOn: row.joinedOn,
        maturityOn: row.maturityOn,
        productName: row.productName || null,
        planName: row.planName || null,
        actualMaturityPaise: paise(row.actualMaturityRupees),
        currentMaturityPaise: paise(row.currentMaturityRupees),
        tenureMonths: row.tenureMonths,
        interestRateBps: row.interestRateBps,
        sourceWorkbook: workbookName,
        sourceSheet: row.sourceSheet,
        sourceRow: row.sourceRow,
        importedById: actor.id,
        updatedAt: new Date(),
      };
      await tx
        .insert(maturityForecasts)
        .values({ id: newId('mfc'), ...values })
        .onConflictDoUpdate({
          target: maturityForecasts.sourceKey,
          set: values,
        });
    }

    const removedRows = await tx
      .delete(maturityForecasts)
      .where(
        and(
          eq(maturityForecasts.branchId, branchId),
          eq(maturityForecasts.sourceWorkbook, workbookName),
          notInArray(maturityForecasts.sourceKey, keys),
        ),
      )
      .returning({ id: maturityForecasts.id });

    const created = keys.length - existing.size;
    const updated = existing.size;
    await writeAudit(tx, actor, {
      action: 'data.imported',
      entity: 'MaturityForecast',
      entityId: branchId,
      branchId,
      summary: `Imported ${rows.length} upcoming maturities from ${workbookName} into ${branch.code} (${created} new, ${updated} refreshed, ${removedRows.length} stale replaced)`,
      ...meta,
    });
    return { created, updated, removed: removedRows.length };
  });
}

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function listMaturityForecasts(actor: Actor, month: string) {
  const conds: SQL[] = [
    gte(maturityForecasts.maturityOn, `${month}-01`),
    lt(maturityForecasts.maturityOn, `${nextMonth(month)}-01`),
  ];
  const scope = ROLE_SCOPE[activeRole(actor.role)];
  if (scope === 'BRANCH') conds.push(eq(maturityForecasts.branchId, actor.branchId ?? '__none__'));
  if (scope === 'OWN') {
    const [agent] = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.id, actor.agentId ?? '__none__'))
      .limit(1);
    conds.push(agent ? sql`LOWER(${maturityForecasts.agentName}) = LOWER(${agent.name})` : sql`false`);
  }

  return db
    .select({
      id: maturityForecasts.id,
      accountNumber: maturityForecasts.accountNumber,
      customerName: maturityForecasts.customerName,
      agentName: maturityForecasts.agentName,
      totalDepositPaise: maturityForecasts.totalDepositPaise,
      maturityOn: maturityForecasts.maturityOn,
      currentMaturityPaise: maturityForecasts.currentMaturityPaise,
      planName: maturityForecasts.planName,
      tenureMonths: maturityForecasts.tenureMonths,
      interestRateBps: maturityForecasts.interestRateBps,
      branchCode: branches.code,
      branchName: branches.name,
    })
    .from(maturityForecasts)
    .innerJoin(branches, eq(branches.id, maturityForecasts.branchId))
    .where(and(...conds))
    .orderBy(asc(maturityForecasts.maturityOn), asc(maturityForecasts.customerName));
}
