/**
 * Seed — one real testing branch. No dummy Lucknow branches, no dummy cases.
 *
 *   npm run db:seed
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/db';
import {
  agents,
  auditLog,
  branchCashPositions,
  branches,
  caseCounters,
  caseDocuments,
  caseEvents,
  customers,
  holidays,
  maturityCases,
  notifications,
  payoutInstalments,
  payoutTransactions,
  sessions,
  systemSettings,
  users,
} from '../src/db/schema';
import { hashPassword } from '../src/lib/auth/password';
import { newId } from '../src/lib/id';
import { rupees } from '../src/lib/money';
import { addDays, todayISO } from '../src/lib/working-days';

const TODAY = todayISO();
const YEAR = Number(TODAY.slice(0, 4));

const HOLIDAYS = [
  { date: `${YEAR}-08-15`, name: 'Independence Day' },
  { date: `${YEAR}-09-05`, name: 'Janmashtami' },
  { date: `${YEAR}-10-02`, name: 'Gandhi Jayanti' },
  { date: `${YEAR}-10-20`, name: 'Diwali' },
  { date: `${YEAR}-10-21`, name: 'Govardhan Puja' },
  { date: `${YEAR}-12-25`, name: 'Christmas' },
  { date: `${YEAR + 1}-01-26`, name: 'Republic Day' },
];

async function wipe() {
  console.log('  clearing previous data…');
  await db.execute(sql`TRUNCATE TABLE
    ${auditLog}, ${notifications}, ${caseEvents}, ${caseDocuments}, ${payoutTransactions},
    ${payoutInstalments}, ${maturityCases}, ${customers}, ${agents}, ${sessions}, ${users},
    ${branchCashPositions}, ${holidays}, ${branches}, ${caseCounters}, ${systemSettings}
    RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log('\n▸ Seeding MaturityFlow — Bhawarnath, Azamgarh\n');
  await wipe();

  const branchId = newId('br');
  await db.insert(branches).values({
    id: branchId,
    code: 'BHAW',
    name: 'Bhawarnath Branch',
    city: 'Azamgarh',
    state: 'Uttar Pradesh',
    ifsc: 'MFBK0BHAW01',
    dailyCashComfortPaise: rupees('500000'),
    defaultRoundingPaise: rupees('1000'),
    defaultWindowDays: 15,
  });
  console.log('  1 branch — Bhawarnath, Azamgarh (BHAW)');

  await db.insert(holidays).values(
    HOLIDAYS.map((h) => ({
      id: newId('hol'),
      key: `${h.date}|ALL`,
      date: h.date,
      name: h.name,
      branchId: null,
    })),
  );

  // Never hard-code this. A seed password committed to the repository is a published
  // password, and this repository is public. Set MF_SEED_PASSWORD in .env before seeding.
  const seedPassword = process.env.MF_SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error('Set MF_SEED_PASSWORD in .env before seeding — the seed password is not stored in the repo.');
  }
  const pw = await hashPassword(seedPassword);
  const staff = [
    { email: 'cmd@bank.test', username: 'cmd', name: 'Ravi Prakash Tiwari', role: 'CMD' as const, branchId: null, code: 'EMP0001' },
    { email: 'ceo@bank.test', username: 'ceo', name: 'Hareram Yadav', role: 'CEO' as const, branchId: null, code: 'EMP0002' },
    { email: 'admin@bank.test', username: 'admin', name: 'Shashank Upadhyay', role: 'ADMIN' as const, branchId: null, code: 'EMP0003' },
    // The Operations Head role was retired with the approval step (docs/adr/0005). The account
    // stays so nobody loses a login; it is an Admin now, which is the authority it had.
    { email: 'ops@bank.test', username: 'ops', name: 'Operations Head (retired role — now Admin)', role: 'ADMIN' as const, branchId: null, code: 'EMP0004' },
    { email: 'manager@bank.test', username: 'manager', name: 'Branch Manager — Bhawarnath', role: 'BRANCH_MANAGER' as const, branchId, code: 'EMP0005' },
    { email: 'cashier@bank.test', username: 'cashier', name: 'Cashier — Bhawarnath', role: 'CASHIER' as const, branchId, code: 'EMP0006' },
    { email: 'auditor@bank.test', username: 'auditor', name: 'Auditor', role: 'AUDITOR' as const, branchId: null, code: 'EMP0007' },
  ];

  await db.insert(users).values(
    staff.map((s) => ({
      id: newId('usr'),
      email: s.email,
      username: s.username,
      employeeCode: s.code,
      name: s.name,
      passwordHash: pw,
      role: s.role,
      branchId: s.branchId,
      mustChangePassword: false,
    })),
  );

  const agentUserId = newId('usr');
  await db.insert(users).values({
    id: agentUserId,
    email: 'agent1@bank.test',
    username: 'agent1',
    employeeCode: 'AGT0001',
    name: 'Bhawarnath Agent',
    passwordHash: pw,
    role: 'AGENT',
    branchId,
    mustChangePassword: false,
  });
  await db.insert(agents).values({
    id: newId('agt'),
    code: 'AG001',
    name: 'Bhawarnath Agent',
    email: 'agent1@bank.test',
    branchId,
    userId: agentUserId,
    joinedOn: addDays(TODAY, -365),
  });

  await db.insert(systemSettings).values([
    { key: 'policy.maxWindowDays', value: { value: 15 } },
    { key: 'policy.defaultRoundingPaise', value: { value: '100000' } },
    { key: 'policy.cashCapPaise', value: { value: '2500000' } },
    { key: 'org.name', value: { value: 'Bhawarnath Branch, Azamgarh' } },
    { key: 'org.shortName', value: { value: 'Bhawarnath' } },
  ]);

  console.log('  7 staff + 1 placeholder agent (Excel import will add real agents)');
  console.log('\n✓ Seed complete. Password: the MF_SEED_PASSWORD you set.\n');
  console.table(staff.map((s) => ({ Role: s.role, Name: s.name, Email: s.email })));
  console.log('  Next: Admin → Import register, or download the Excel template.\n');
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('\n✗ Seed failed:', e);
    await pool.end();
    process.exit(1);
  });
