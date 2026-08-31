/**
 * Wipe operational records while preserving application setup and history.
 *
 * Keeps: users, branches, sessions, holidays, system settings and the append-only audit log.
 * Removes: cashbook/register data, cases and payouts, customers/agents, notifications,
 * counters and stored case documents.
 *
 * This deliberately refuses to run against a non-local database.
 *
 *   node scripts/wipe-register.mjs
 */
import 'dotenv/config';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not configured.');

const databaseHost = new URL(databaseUrl).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(databaseHost)) {
  throw new Error(`Refusing to wipe a non-local database host: ${databaseHost}`);
}

const operationalTables = [
  'cashbook_entries',
  'cashbook_commitments',
  'cashbook_days',
  'maturity_forecasts',
  'payout_transactions',
  'payout_instalments',
  'case_documents',
  'case_events',
  'maturity_cases',
  'customers',
  'agents',
  'branch_cash_positions',
  'register_days',
  'notifications',
  'case_counters',
];

const preservedTables = [
  'users',
  'branches',
  'sessions',
  'holidays',
  'system_settings',
  'audit_log',
];

const client = new pg.Client({ connectionString: databaseUrl });

async function tableCounts(tables) {
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

await client.connect();

try {
  const beforeOperational = await tableCounts(operationalTables);
  const beforePreserved = await tableCounts(preservedTables);

  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('maturityflow-operational-wipe'))");

  for (const table of operationalTables) {
    await client.query(`DELETE FROM "${table}"`);
  }

  const afterOperational = await tableCounts(operationalTables);
  const afterPreserved = await tableCounts(preservedTables);

  for (const table of operationalTables) {
    if (afterOperational[table] !== 0) throw new Error(`${table} was not fully cleared.`);
  }
  for (const table of preservedTables) {
    if (afterPreserved[table] !== beforePreserved[table]) {
      throw new Error(`${table} changed during the operational wipe.`);
    }
  }

  await client.query('COMMIT');

  console.log('Operational database records removed:');
  console.table(
    Object.fromEntries(
      operationalTables.map((table) => [
        table,
        { before: beforeOperational[table], removed: beforeOperational[table], after: 0 },
      ]),
    ),
  );
  console.log('Preserved records (verified unchanged):');
  console.table(
    Object.fromEntries(
      preservedTables.map((table) => [
        table,
        { before: beforePreserved[table], after: afterPreserved[table] },
      ]),
    ),
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

const storageRoot = path.resolve(process.env.STORAGE_ROOT || './storage');
const casesRoot = path.resolve(storageRoot, 'cases');
if (path.dirname(casesRoot) !== storageRoot || path.basename(casesRoot) !== 'cases') {
  throw new Error(`Unsafe case-document path: ${casesRoot}`);
}
await rm(casesRoot, { recursive: true, force: true });
console.log(`Stored case documents removed from ${casesRoot}`);
