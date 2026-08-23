/**
 * Wipe operational data (the Excel test register and everything it created).
 * Keeps: users, branches, holidays, organisation settings, live sessions.
 *
 *   node scripts/wipe-register.mjs
 */
import 'dotenv/config';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`
  TRUNCATE TABLE
    payout_transactions,
    payout_instalments,
    case_documents,
    case_events,
    maturity_cases,
    customers,
    agents,
    branch_cash_positions,
    register_days,
    notifications,
    audit_log,
    case_counters
  RESTART IDENTITY CASCADE
`);

const counts = await pool.query(`
  SELECT
    (SELECT count(*)::int FROM maturity_cases) AS cases,
    (SELECT count(*)::int FROM customers) AS customers,
    (SELECT count(*)::int FROM agents) AS agents,
    (SELECT count(*)::int FROM payout_transactions) AS payouts,
    (SELECT count(*)::int FROM audit_log) AS audit,
    (SELECT count(*)::int FROM users) AS users,
    (SELECT count(*)::int FROM branches) AS branches
`);
console.log('Wiped Excel/test register. Staff, branch and holidays kept.');
console.table(counts.rows);

const storageRoot = process.env.STORAGE_ROOT || './storage';
await rm(path.resolve(storageRoot, 'cases'), { recursive: true, force: true });

await pool.end();
