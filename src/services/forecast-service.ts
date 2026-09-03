import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, notInArray, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db';
import { agents, branches, maturityForecasts } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import type { ForecastImportRow } from '@/lib/maturity-forecast';
import {
  aggregateForecastPayments,
  projectForecastPayments,
  type DailyForecastPayment,
} from '@/lib/maturity-payment-plan';
import { newId } from '@/lib/id';
import { activeRole, ROLE_SCOPE, type Actor } from '@/lib/rbac';
import { getBranchPolicy } from '@/services/calendar-service';
import { loadOrgSettings } from '@/services/org-settings';

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
      branchId: maturityForecasts.branchId,
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

function forecastScope(actor: Actor): SQL[] {
  const conds: SQL[] = [];
  const scope = ROLE_SCOPE[activeRole(actor.role)];
  if (scope === 'BRANCH') conds.push(eq(maturityForecasts.branchId, actor.branchId ?? '__none__'));
  if (scope === 'OWN') {
    conds.push(sql`false`);
  }
  return conds;
}

/**
 * Deposits already sitting on the upcoming-maturity forecast. HQ uses them as a starting
 * book on the deposit-interest page; they are not payout cases.
 */
export async function listForecastDeposits(actor: Actor) {
  const conds: SQL[] = [
    sql`${maturityForecasts.totalDepositPaise} > 0`,
    ...forecastScope(actor),
  ];
  return db
    .select({
      id: maturityForecasts.id,
      name: maturityForecasts.customerName,
      depositedPaise: maturityForecasts.totalDepositPaise,
      maturityOn: maturityForecasts.maturityOn,
      agentName: maturityForecasts.agentName,
    })
    .from(maturityForecasts)
    .where(and(...conds))
    .orderBy(desc(maturityForecasts.totalDepositPaise), asc(maturityForecasts.customerName));
}

export interface ForecastPaymentProjection {
  days: DailyForecastPayment[];
  totalPaise: bigint;
  cashPaise: bigint;
  onlinePaise: bigint;
  firstPaymentOn: string | null;
  lastPaymentOn: string | null;
}

/**
 * Project a forecast month through the same pure payout engine used by live cases.
 * This is read-only: no case, instalment or transaction row is created.
 */
export async function projectMaturityForecastPayments(
  month: string,
  rows: Awaited<ReturnType<typeof listMaturityForecasts>>,
): Promise<ForecastPaymentProjection> {
  if (rows.length === 0) {
    return {
      days: [], totalPaise: 0n, cashPaise: 0n, onlinePaise: 0n,
      firstPaymentOn: null, lastPaymentOn: null,
    };
  }

  const org = await loadOrgSettings();
  const byBranch = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byBranch.get(row.branchId) ?? [];
    group.push(row);
    byBranch.set(row.branchId, group);
  }

  const projected = await Promise.all([...byBranch].map(async ([branchId, branchRows]) => {
    const policy = await getBranchPolicy(branchId);
    return projectForecastPayments(
      month,
      branchRows.map((row) => ({
        id: row.id,
        maturityOn: row.maturityOn,
        amountPaise: row.currentMaturityPaise,
      })),
      {
        calendar: policy.calendar,
        windowDays: policy.defaultWindowDays,
        roundingPaise: policy.defaultRoundingPaise,
        cashPolicy: { kind: 'CASH_CAP', cashCapPerDayPaise: org.cashCapPaise },
        dailyCashComfortPaise: policy.dailyCashComfortPaise,
      },
    );
  }));

  const days = aggregateForecastPayments(projected.flat());
  return {
    days,
    totalPaise: days.reduce((sum, day) => sum + day.totalPaise, 0n),
    cashPaise: days.reduce((sum, day) => sum + day.cashPaise, 0n),
    onlinePaise: days.reduce((sum, day) => sum + day.onlinePaise, 0n),
    firstPaymentOn: days[0]?.dueOn ?? null,
    lastPaymentOn: days.at(-1)?.dueOn ?? null,
  };
}
