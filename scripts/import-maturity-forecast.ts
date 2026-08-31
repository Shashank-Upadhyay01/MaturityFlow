import 'dotenv/config';

import { resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { and, eq, isNull } from 'drizzle-orm';

import { db, pool } from '@/db';
import { branches, users } from '@/db/schema';
import { parseForecastWorkbook } from '@/lib/maturity-forecast';
import { importMaturityForecast } from '@/services/forecast-service';

const workbookPath = resolve(process.argv[2] ?? 'Maturity.xlsx');
const branchCode = (process.argv[3] ?? 'AZM').trim().toUpperCase();

async function main() {
const [branch] = await db
  .select({ id: branches.id, code: branches.code, name: branches.name })
  .from(branches)
  .where(and(eq(branches.code, branchCode), eq(branches.isActive, true)))
  .limit(1);
if (!branch) throw new Error(`Active branch ${branchCode} was not found.`);

const [admin] = await db
  .select({ id: users.id, name: users.name, role: users.role })
  .from(users)
  .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt)))
  .limit(1);
if (!admin) throw new Error('No active Admin account was found for the import audit.');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const sheets = workbook.worksheets.map((sheet) => {
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const line: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => { line[column - 1] = cell.value; });
    rows.push(line);
  });
  return { name: sheet.name, rows };
});

const parsed = parseForecastWorkbook(sheets);
if (parsed.rows.length === 0) throw new Error(parsed.errors[0] ?? 'No maturity rows found.');
const imported = await importMaturityForecast(
  admin,
  branch.id,
  workbookPath.split(/[\\/]/).pop() ?? 'Maturity.xlsx',
  parsed.rows,
  { userAgent: 'operator-script/import-maturity-forecast' },
);

const byMonth = new Map<string, { count: number; paise: bigint }>();
for (const row of parsed.rows) {
  const month = row.maturityOn.slice(0, 7);
  const current = byMonth.get(month) ?? { count: 0, paise: 0n };
  current.count += 1;
  current.paise += BigInt(Math.round(row.currentMaturityRupees * 100 + 1e-7));
  byMonth.set(month, current);
}

console.info(`Imported upcoming maturities into ${branch.code} — ${branch.name}`);
console.table(
  Object.fromEntries(
    [...byMonth.entries()].map(([month, value]) => [month, { records: value.count, paise: value.paise.toString() }]),
  ),
);
console.info({ parsed: parsed.rows.length, ...imported, errors: parsed.errors, warnings: parsed.warnings });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
