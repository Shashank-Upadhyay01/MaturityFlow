/** Blocks until Postgres accepts connections. Used by `npm run setup`. */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const DEADLINE = Date.now() + 60_000;
process.stdout.write('Waiting for Postgres');

while (Date.now() < DEADLINE) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    console.log(' — ready.');
    process.exit(0);
  } catch {
    await client.end().catch(() => {});
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1500));
  }
}

console.error('\nPostgres did not become ready within 60s. Is `docker compose up -d db` running?');
process.exit(1);
