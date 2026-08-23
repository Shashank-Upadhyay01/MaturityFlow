import 'dotenv/config';
import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';

/**
 * Live import of the branch register. Run with:
 *   RUN_IMPORT=1 npx vitest run tests/import-live.test.ts
 */
const run = process.env.RUN_IMPORT === '1';

describe.skipIf(!run)('import MATURITY.xlsx into Bhawarnath', () => {
  afterAll(async () => {
    const { pool } = await import('../src/db');
    await pool.end();
  });

  it(
    'creates live cases from the current register',
    async () => {
      const path = 'tests/fixtures/MATURITY.xlsx';
      expect(existsSync(path)).toBe(true);

      const { db } = await import('../src/db');
      const { branches, users, maturityCases } = await import('../src/db/schema');
      const ExcelJS = (await import('exceljs')).default;
      const { parseRegisterGrid } = await import('../src/lib/excel-register');
      const { importRegisterRows } = await import('../src/services/import-service');

      const [branch] = await db.select().from(branches).where(eq(branches.code, 'BHAW')).limit(1);
      const [admin] = await db.select().from(users).where(eq(users.email, 'admin@bank.test')).limit(1);
      expect(branch).toBeTruthy();
      expect(admin).toBeTruthy();

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(path);
      const ws = wb.worksheets[0];
      const grid: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const line: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          line[col - 1] = cell.value;
        });
        grid.push(line);
      });
      const parsed = parseRegisterGrid(grid);
      expect(parsed.rows.length).toBeGreaterThan(80);

      const result = await importRegisterRows(
        { id: admin!.id, name: admin!.name, role: admin!.role },
        branch!.id,
        parsed.rows,
      );
      expect(result.created).toBeGreaterThan(80);

      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(maturityCases);
      expect(n).toBeGreaterThan(80);
    },
    180_000,
  );
});
