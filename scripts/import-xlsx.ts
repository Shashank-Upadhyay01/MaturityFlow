/**
 * Import a branch register into Bhawarnath (or --branch=CODE).
 *
 *   npx tsx scripts/import-xlsx.ts "tests/fixtures/MATURITY.xlsx"
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';

import { db, pool } from '../src/db';
import { branches, users } from '../src/db/schema';
import { excelCellRaw, parseRegisterGrid } from '../src/lib/excel-register';
import { importRegisterRows } from '../src/services/import-service';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npx tsx scripts/import-xlsx.ts <file.xlsx> [--branch=BHAW]');
    process.exit(1);
  }
  const code = (process.argv.find((a) => a.startsWith('--branch=')) ?? '--branch=BHAW').slice(9);

  const [branch] = await db.select().from(branches).where(eq(branches.code, code)).limit(1);
  if (!branch) throw new Error(`Branch ${code} not found. Seed first.`);
  const [admin] = await db.select().from(users).where(eq(users.email, 'admin@bank.test')).limit(1);
  if (!admin) throw new Error('admin@bank.test not found. Seed first.');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('No worksheet');
  const grid: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const line: unknown[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      line[col - 1] = excelCellRaw(cell.value);
    });
    grid.push(line);
  });

  const parsed = parseRegisterGrid(grid);
  if (parsed.rows.length === 0) {
    throw new Error(parsed.errors[0] ?? 'No data rows');
  }
  console.log(`Importing ${parsed.rows.length} rows into ${branch.code} — ${branch.name}…`);

  const result = await importRegisterRows(
    { id: admin.id, name: admin.name, role: admin.role },
    branch.id,
    parsed.rows,
  );
  result.errors.push(...parsed.errors);
  console.log(`created=${result.created} skipped=${result.skipped} warnings=${result.warnings.length} errors=${result.errors.length}`);
  for (const e of result.errors.slice(0, 20)) console.error('  error:', e);
  for (const w of result.warnings.slice(0, 10)) console.log('  note:', w);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
