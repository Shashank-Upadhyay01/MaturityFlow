import { drizzle } from 'drizzle-orm/node-postgres';
import pg, { Pool } from 'pg';
import * as schema from './schema';

/** Keep DATE as 'YYYY-MM-DD'. node-pg otherwise builds a JS Date at local midnight,
 *  which in IST becomes the previous UTC day and shows 28/6 instead of 29/06. */
pg.types.setTypeParser(1082, (val: string) => val);

/**
 * One pool per process. Next.js hot-reloads modules in dev, so the pool is stashed on
 * globalThis to avoid leaking a connection pool on every save.
 */
const globalForDb = globalThis as unknown as { __mfPool?: Pool };

function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }
  return new Pool({
    connectionString,
    // Sized for a branch network on one server. Postgres allows 100 connections by
    // default; 20 leaves ample room for psql, backups and a second app instance.
    max: Number(process.env.DB_POOL_MAX ?? 20),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    // Managed Postgres (Supabase / Neon / RDS) requires TLS; local docker does not.
    ssl: /sslmode=require|supabase|neon\.tech|rds\.amazonaws/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export const pool: Pool = globalForDb.__mfPool ?? makePool();
pool.on('error', (err) => {
  console.error('[pg pool]', err.message);
});
if (process.env.NODE_ENV !== 'production') globalForDb.__mfPool = pool;

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type Database = typeof db;
/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything you can run a query on — the pool or a transaction. */
export type Queryable = Database | Tx;

export * as tables from './schema';
