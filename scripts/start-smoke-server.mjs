/**
 * Starts the already-built app against the isolated `maturityflow_audit` database on port 3100.
 * The production database name is replaced in memory; credentials are never copied to a file or
 * printed. Create/migrate/seed that database before using this helper.
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
const databaseUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) {
  throw new Error('The smoke server may only use a local PostgreSQL instance.');
}
databaseUrl.pathname = '/maturityflow_audit';

const storageRoot = resolve('backups/smoke-storage');
mkdirSync(storageRoot, { recursive: true });

const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3100'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    APP_URL: 'http://127.0.0.1:3100',
    STORAGE_ROOT: storageRoot,
  },
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
