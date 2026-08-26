/**
 * One-shot cutover: schedule every case still waiting on a human.
 *
 *   npm run backfill:schedule -- --dry-run     # list what would happen, write nothing
 *   npm run backfill:schedule                  # do it
 *
 * The `--conditions=react-server` flag is not optional: `case-service.ts` imports `server-only`,
 * whose package exports throw on any other condition. This is the escape hatch that package
 * ships for exactly this — running server modules outside a React Server Component graph.
 *
 * Approval is gone (docs/adr/0005). The cases sitting in SUBMITTED / UNDER_REVIEW were waiting
 * for an Operations Head who no longer exists, so nothing would ever pick them up. This walks
 * them through the ordinary submit path so each one gets its schedule, its events and its own
 * audit line — exactly as if it had been submitted today.
 *
 * A loop over the audited single-row path, never one bulk UPDATE. Each row takes its own case
 * lock and writes its own trail; one `UPDATE ... WHERE id IN (...)` would be the first place in
 * this codebase where money moved without either. Failures are collected rather than thrown:
 * "78 rows, two of which have no maturity date" is the normal case, not the exception.
 *
 * Idempotent — status is re-read per row inside the transaction, so a case already scheduled is
 * skipped and a second run is safe.
 */
import 'dotenv/config';
import { asc, inArray } from 'drizzle-orm';

import { db, pool } from '../src/db';
import { maturityCases, users } from '../src/db/schema';
import type { SessionUser } from '../src/lib/auth/session';
import { newId } from '../src/lib/id';
import { permissionsOf } from '../src/lib/rbac';
import { submitCase } from '../src/services/case-service';

const DRY_RUN = process.argv.includes('--dry-run');

/** The Admin whose name goes on every audit row this cutover writes. */
async function cutoverActor(): Promise<SessionUser> {
  const [u] = await db
    .select()
    .from(users)
    .where(inArray(users.role, ['ADMIN']))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!u) throw new Error('No ADMIN user to attribute the cutover to. Create one first.');
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: u.username,
    phone: u.phone,
    role: u.role,
    branchId: u.branchId,
    branchName: null,
    branchCode: null,
    agentId: null,
    mustChangePassword: false,
    hasAvatar: false,
    avatarAt: 0,
    orgName: '',
    orgShortName: '',
    permissions: permissionsOf('ADMIN'),
    tokenId: newId('tok'),
  };
}

async function main() {
  const actor = await cutoverActor();
  console.log(`Cutover attributed to ${actor.name} (${actor.email})`);
  if (DRY_RUN) console.log('DRY RUN — listing only, nothing is written.\n');

  const pending = await db
    .select({
      id: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      status: maturityCases.status,
      maturityOn: maturityCases.instrumentMaturityOn,
      amountPaise: maturityCases.maturityAmountPaise,
    })
    .from(maturityCases)
    .where(inArray(maturityCases.status, ['SUBMITTED', 'UNDER_REVIEW']))
    .orderBy(asc(maturityCases.caseNumber));

  console.log(`${pending.length} case(s) waiting for a schedule.\n`);

  if (DRY_RUN) {
    const noMaturity = pending.filter((r) => !r.maturityOn);
    for (const r of pending.slice(0, 5)) {
      console.log(`  ${r.caseNumber}  ${r.status}  matured ${r.maturityOn ?? '(none)'}`);
    }
    if (pending.length > 5) console.log(`  … and ${pending.length - 5} more`);
    console.log(`\nWould schedule: ${pending.length - noMaturity.length}`);
    console.log(`Would fail (no maturity date): ${noMaturity.length}`);
    for (const r of noMaturity) console.log(`  ${r.caseNumber}`);
    return 0;
  }

  const failed: { caseNumber: string; reason: string }[] = [];
  let scheduled = 0;

  for (const row of pending) {
    try {
      const res = await submitCase(actor, row.id, { ip: null, userAgent: 'backfill-auto-schedule' });
      scheduled++;
      console.log(
        `  ${row.caseNumber}: ${res.instalments} instalments, ${res.firstPayoutOn} → ${res.lastPayoutOn}`,
      );
    } catch (e) {
      failed.push({ caseNumber: row.caseNumber, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`\nScheduled ${scheduled} of ${pending.length}.`);
  for (const f of failed) console.log(`  FAILED ${f.caseNumber}: ${f.reason}`);
  return failed.length ? 1 : 0;
}

main()
  .then(async (code) => {
    await pool.end();
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
