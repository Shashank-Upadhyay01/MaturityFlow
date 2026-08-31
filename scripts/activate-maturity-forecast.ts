import 'dotenv/config';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, pool } from '@/db';
import { branches, maturityCases, payoutInstalments, users } from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { permissionsOf } from '@/lib/rbac';
import { activateForecastMonthForTesting } from '@/services/forecast-activation-service';
import { loadOrgSettings } from '@/services/org-settings';

const branchCode = (process.argv[2] ?? 'AZM').trim().toUpperCase();
const month = process.argv[3] ?? '2026-08';

function monthAfter(value: string): string {
  const [year, monthNumber] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const [branch] = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(and(eq(branches.code, branchCode), eq(branches.isActive, true)))
    .limit(1);
  if (!branch) throw new Error(`Active branch ${branchCode} was not found.`);

  const [admin] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      phone: users.phone,
      role: users.role,
      branchId: users.branchId,
      mustChangePassword: users.mustChangePassword,
      avatarKey: users.avatarKey,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);
  if (!admin) throw new Error('No active Admin account was found for the activation audit.');

  const org = await loadOrgSettings();
  const actor: SessionUser = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    username: admin.username,
    phone: admin.phone,
    role: admin.role,
    branchId: admin.branchId,
    branchName: null,
    branchCode: null,
    agentId: null,
    mustChangePassword: admin.mustChangePassword,
    hasAvatar: Boolean(admin.avatarKey),
    avatarAt: admin.updatedAt.getTime(),
    orgName: org.orgName,
    orgShortName: org.orgShortName,
    permissions: permissionsOf(admin.role),
    tokenId: 'operator-activate-maturity-forecast',
  };

  const result = await activateForecastMonthForTesting(actor, branch.id, month);
  console.info(`Activated ${month} forecast for ${branch.code} — ${branch.name}`);
  console.info(result);

  const schedules = await db
    .select({
      cases: sql<number>`count(*)::int`,
      maturityPaise: sql<string>`sum(${maturityCases.maturityAmountPaise})::text`,
      firstPayoutOn: sql<string>`min(${maturityCases.firstPayoutOn})::text`,
      lastDeadlineOn: sql<string>`max(${maturityCases.deadlineOn})::text`,
    })
    .from(maturityCases)
    .where(
      and(
        eq(maturityCases.branchId, branch.id),
        sql`${maturityCases.instrumentMaturityOn} >= ${`${month}-01`}`,
        sql`${maturityCases.instrumentMaturityOn} < ${`${monthAfter(month)}-01`}`,
        sql`${maturityCases.notes} LIKE 'Activated from forecast %'`,
      ),
    );

  const daily = await db
    .select({
      dueOn: payoutInstalments.dueOn,
      cases: sql<number>`count(*)::int`,
      totalPaise: sql<string>`sum(${payoutInstalments.amountPaise})::text`,
      cashPaise: sql<string>`sum(${payoutInstalments.cashLegPaise})::text`,
      onlinePaise: sql<string>`sum(${payoutInstalments.onlineLegPaise})::text`,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and(
        eq(maturityCases.branchId, branch.id),
        sql`${maturityCases.instrumentMaturityOn} >= ${`${month}-01`}`,
        sql`${maturityCases.instrumentMaturityOn} < ${`${monthAfter(month)}-01`}`,
        eq(payoutInstalments.scheduleVersion, maturityCases.scheduleVersion),
        sql`${maturityCases.notes} LIKE 'Activated from forecast %'`,
      ),
    )
    .groupBy(payoutInstalments.dueOn)
    .orderBy(payoutInstalments.dueOn);

  console.table(schedules);
  console.table(daily);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
