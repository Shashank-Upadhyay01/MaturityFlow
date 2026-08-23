/**
 * Connection doctor. Reads DATABASE_URL from .env, tries to connect, and explains in plain
 * words what is wrong if it cannot — instead of leaving you with a raw driver error.
 *
 *   node scripts/check-db.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;

function die(title, ...lines) {
  console.error(`\n  ✗ ${title}\n`);
  for (const l of lines) console.error(`    ${l}`);
  console.error('');
  process.exit(1);
}

if (!url) {
  die(
    'No DATABASE_URL found.',
    'There is no .env file, or it has no DATABASE_URL line.',
    'Run:  copy env-ready.txt .env',
  );
}

if (/\[YOUR-PASSWORD\]|YOURPASSWORD|\[.*\]/i.test(url)) {
  die(
    'The password placeholder is still in DATABASE_URL.',
    'Open .env and replace [YOUR-PASSWORD] with your real database password.',
  );
}

let host = '(unparseable)';
try {
  host = new URL(url).host;
} catch {
  die('DATABASE_URL is not a valid URL.', 'It must start with postgresql:// and be in quotes.');
}

if (/db\.[a-z0-9]+\.supabase\.co/.test(url)) {
  console.warn(
    '\n  ! You are using the Supabase DIRECT connection (db.xxx.supabase.co).\n' +
      '    That address is IPv6-only and fails on most Windows networks.\n' +
      '    In the Supabase dashboard press Connect and pick the "Session pooler" tab instead\n' +
      '    (host looks like aws-0-ap-south-1.pooler.supabase.com).\n',
  );
}

console.log(`\n  Connecting to ${host} …`);

const client = new pg.Client({
  connectionString: url,
  connectionTimeoutMillis: 15000,
  ssl: /sslmode=require|supabase|neon\.tech|rds\.amazonaws/.test(url)
    ? { rejectUnauthorized: false }
    : undefined,
});

const started = Date.now();
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT current_database() AS db,
           current_user       AS role,
           (SELECT count(*) FROM information_schema.tables
             WHERE table_schema='public' AND table_type='BASE TABLE') AS tables
  `);
  const r = rows[0];
  console.log(`  ✓ Connected in ${Date.now() - started} ms`);
  console.log(`    database : ${r.db}`);
  console.log(`    role     : ${r.role}`);
  console.log(`    tables   : ${r.tables}`);

  if (Number(r.tables) === 0) {
    console.log('\n  Schema is not created yet. Run:  npm run db:migrate\n');
  } else if (Number(r.tables) < 16) {
    console.log(`\n  Only ${r.tables} of 16 tables exist. Run:  npm run db:migrate\n`);
  } else {
    const { rows: c } = await client.query('SELECT count(*)::int AS n FROM users');
    console.log(
      c[0].n === 0
        ? '\n  ✓ Schema complete, no data yet. Run:  npm run db:seed\n'
        : `\n  ✓ Schema complete, ${c[0].n} users loaded. Run:  npm run dev\n`,
    );
  }
  await client.end();
  process.exit(0);
} catch (e) {
  const m = String(e && e.message ? e.message : e);
  if (/password authentication failed|SASL|SCRAM/i.test(m)) {
    die(
      'The password is wrong.',
      'Supabase dashboard -> Connect -> Session pooler, or reset the database password',
      'under Project Settings -> Database, then paste it into .env.',
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) {
    die('That host does not resolve.', `Host: ${host}`, 'Check the address, and check internet access.');
  }
  if (/ENETUNREACH|EHOSTUNREACH/i.test(m)) {
    die(
      'The host is unreachable — almost always the IPv6 problem.',
      'Use the Supabase "Session pooler" connection string, not "Direct connection".',
    );
  }
  if (/ETIMEDOUT|timeout/i.test(m)) {
    die('Timed out.', 'A firewall or proxy is likely blocking outbound port 5432.');
  }
  if (/ECONNREFUSED/i.test(m)) {
    die('Connection refused.', 'Nothing is listening there. If you meant local Postgres, start it first.');
  }
  die('Could not connect.', m);
}
