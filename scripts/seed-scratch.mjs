/** Reset only the isolated local audit database used by browser verification. */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) {
  throw new Error('Scratch seeding may only use a local PostgreSQL instance.');
}
databaseUrl.pathname = '/maturityflow_audit';

const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/seed.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
