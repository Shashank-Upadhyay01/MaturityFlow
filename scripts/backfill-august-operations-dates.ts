import 'dotenv/config';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../src/db';
import { branches, maturityCases, users } from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth/session';
import { writeAudit } from '../src/lib/audit';
import { DEFAULT_REGISTER_LAYOUT } from '../src/lib/register-layout';
import { updateRegisterRow } from '../src/services/register-service';

async function main() {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1);
  if (!admin) throw new Error('No active Admin account was found for the audited backfill.');

  const actor = {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    branchId: admin.branchId,
    agentId: null,
  } as SessionUser;

  const branchRows = await db.select().from(branches);
  for (const branch of branchRows) {
    if (JSON.stringify(branch.registerColumnOrder) === JSON.stringify(DEFAULT_REGISTER_LAYOUT)) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(branches)
        .set({ registerColumnOrder: DEFAULT_REGISTER_LAYOUT, updatedAt: new Date() })
        .where(eq(branches.id, branch.id));
      await writeAudit(tx, actor, {
        action: 'settings.updated',
        entity: 'Branch',
        entityId: branch.id,
        branchId: branch.id,
        summary: 'Register columns aligned to the approved Operations layout',
        before: branch.registerColumnOrder,
        after: DEFAULT_REGISTER_LAYOUT,
      });
    });
  }

  const rows = await db
    .select({
      id: maturityCases.id,
      formSubmittedOn: maturityCases.formSubmittedOn,
      opsReviewedOn: maturityCases.opsReviewedOn,
      paymentOn: maturityCases.paymentOn,
      windowDays: maturityCases.windowDays,
    })
    .from(maturityCases)
    .where(eq(maturityCases.instrumentMaturityOn, '2026-08-29'));

  let updated = 0;
  for (const row of rows) {
    if (
      row.formSubmittedOn === '2026-08-30' &&
      row.opsReviewedOn === '2026-08-31' &&
      row.paymentOn === '2026-09-01' &&
      row.windowDays === 15
    ) continue;
    await updateRegisterRow(actor, row.id, {
      instrumentMaturityOn: '2026-08-29',
      formSubmittedOn: '2026-08-30',
      opsReviewedOn: '2026-08-31',
      paymentOn: '2026-09-01',
      windowDays: 15,
    });
    updated += 1;
  }

  console.log(`Updated ${updated} of ${rows.length} August maturity rows through the audited Register service.`);
}

void main();
