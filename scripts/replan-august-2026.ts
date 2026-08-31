import 'dotenv/config';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, pool } from '@/db';
import { branches, maturityCases, payoutInstalments, users } from '@/db/schema';
import type { SessionUser } from '@/lib/auth/session';
import { permissionsOf } from '@/lib/rbac';
import { replanActivatedAugust2026 } from '@/services/forecast-activation-service';
import { loadOrgSettings } from '@/services/org-settings';

const branchCode = (process.argv[2] ?? 'AZM').trim().toUpperCase();

async function main() {
  const [branch] = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(and(eq(branches.code, branchCode), eq(branches.isActive, true)))
    .limit(1);
  if (!branch) throw new Error(`Active branch ${branchCode} was not found.`);

  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);
  if (!admin) throw new Error('No active Admin account was found for the replanning audit.');

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
    tokenId: 'operator-replan-august-2026',
  };

  const result = await replanActivatedAugust2026(actor, branch.id);
  console.info(`Replanned activated August 2026 cases for ${branch.code} — ${branch.name}`);
  console.info(result);

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
    .where(and(
      eq(maturityCases.branchId, branch.id),
      sql`${maturityCases.instrumentMaturityOn} >= '2026-08-01'`,
      sql`${maturityCases.instrumentMaturityOn} < '2026-09-01'`,
      eq(payoutInstalments.scheduleVersion, maturityCases.scheduleVersion),
      sql`${maturityCases.notes} LIKE 'Activated from forecast %'`,
    ))
    .groupBy(payoutInstalments.dueOn)
    .orderBy(payoutInstalments.dueOn);
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
