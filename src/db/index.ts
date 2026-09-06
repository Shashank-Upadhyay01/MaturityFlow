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
  /*
    How many connections one instance of this app may hold.

    Twenty was sized for the shape this started as: one long-lived server on the branch network,
    where a generous pool costs nothing and saves a handshake. On Vercel it is the wrong number by
    an order of magnitude. Every serverless instance evaluates this module and gets a pool of its
    own, this database allows sixty connections in total, and each one opened has to be
    authenticated through the pooler before it can run a query - so a handful of instances warming
    up together can spend the whole budget and leave real requests queueing behind handshakes.

    A serverless instance serves one request at a time, so it needs about one connection, and a
    small ceiling for the few paths that fan out. Anything long-lived - the branch LAN server,
    local development - keeps the original number, because there the pool really is shared.
  */
  const serverless = Boolean(process.env.VERCEL);
  return new Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? (serverless ? 3 : 20)),
    // A serverless instance is frozen between requests; holding a connection open across that
    // gap keeps a backend reserved for nobody. Long-lived servers keep theirs the full ten
    // seconds, where the next request really is moments away.
    idleTimeoutMillis: serverless ? 2_000 : 10_000,
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
