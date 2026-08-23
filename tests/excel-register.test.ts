import { describe, expect, it } from 'vitest';
import {
  parseRegisterDate,
  parseRegisterGrid,
  parseRupeesNumber,
  excelSerialToISO,
} from '../src/lib/excel-register';

describe('parseRegisterDate', () => {
  it('reads Indian day/month/year', () => {
    expect(parseRegisterDate('29/6/2026')).toBe('2026-06-29');
    expect(parseRegisterDate('24-07-2026')).toBe('2026-07-24');
    expect(parseRegisterDate('8.3.2026')).toBe('2026-03-08');
  });

  it('reads ISO y-m-d and swaps impossible months', () => {
    expect(parseRegisterDate('2026-07-24')).toBe('2026-07-24');
    expect(parseRegisterDate('2026-24-07')).toBe('2026-07-24');
  });

  it('treats ISO dates from Excel Date cells as Indian d/m when both parts are ≤ 12', () => {
    expect(parseRegisterDate('2026-03-08')).toBe('2026-08-03');
    expect(parseRegisterDate('2026-03-08T00:00:00.000Z')).toBe('2026-08-03');
    expect(parseRegisterDate('3/8/26')).toBe('2026-08-03');
  });

  it('reads US-stored 3 Aug (2026-03-08 Date) as 3/8/2026', () => {
    expect(parseRegisterDate(new Date(Date.UTC(2026, 2, 8)))).toBe('2026-08-03');
    expect(parseRegisterDate(new Date(Date.UTC(2026, 0, 8)))).toBe('2026-08-01');
    expect(parseRegisterDate(new Date(Date.UTC(2026, 7, 8)))).toBe('2026-08-08');
  });

  it('reads Excel serials as UTC calendar days', () => {
    const utc = new Date(Date.UTC(1899, 11, 30) + 44927 * 86_400_000);
    expect(excelSerialToISO(44927)).toBe(
      `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, '0')}-${String(utc.getUTCDate()).padStart(2, '0')}`,
    );
  });
});

describe('parseRupeesNumber', () => {
  it('strips Indian grouping and the rupee sign', () => {
    expect(parseRupeesNumber('₹1,04,035')).toBe(104035);
    expect(parseRupeesNumber(25000.5)).toBe(25000.5);
    expect(parseRupeesNumber('')).toBe(0);
  });
});

describe('parseRegisterGrid', () => {
  const header = [
    'Savings Account Number',
    'Customer Name',
    'Date of Maturity',
    'Form Submission Date',
    'Payment Date',
    'Maturity Amount',
    'Paid Maturity',
    'Remaining Amount',
    "Customer's Agent Name",
    "Today's Approved Withdrawalable Amount",
  ];

  it('parses a typical MATURITY.xlsx row', () => {
    const { rows, errors } = parseRegisterGrid([
      header,
      ['1001602329', 'Ram Lal', '29/6/2026', '24/7/2026', '29/7/2026', 104035, 80000, 24035, 'Suresh', 0],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe('Ram Lal');
    expect(rows[0].formSubmittedOn).toBe('2026-07-24');
    expect(rows[0].paymentOn).toBe('2026-07-29');
    expect(rows[0].maturityRupees).toBe(104035);
    expect(rows[0].paidRupees).toBe(80000);
    expect(rows[0].remainingRupees).toBe(24035);
    expect(rows[0].agentName).toBe('Suresh');
    expect(rows[0].windowDays).toBe(15);
  });

  it('recomputes remaining when the sheet does not add up', () => {
    const { rows } = parseRegisterGrid([
      header,
      ['1', 'Asha', '2026-06-01', '2026-06-10', '2026-06-12', 10000, 3000, 9999, 'Agent', 0],
    ]);
    expect(rows[0].remainingRupees).toBe(7000);
    expect(rows[0].warnings.some((w) => w.includes('Remaining'))).toBe(true);
  });

  it('rejects a sheet without the required headers', () => {
    const { rows, errors } = parseRegisterGrid([['Foo', 'Bar'], ['x', 'y']]);
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Header row/);
  });

  it('parses the live MATURITY.xlsx register', async () => {
    const fs = await import('node:fs');
    const path = 'tests/fixtures/MATURITY.xlsx';
    if (!fs.existsSync(path)) return;
    const ExcelJS = (await import('exceljs')).default;
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
    const { rows, errors } = parseRegisterGrid(grid);
    expect(errors.length).toBeLessThan(5);
    expect(rows.length).toBeGreaterThan(80);
    expect(rows.every((r) => r.maturityRupees > 0)).toBe(true);
    expect(rows.every((r) => r.formSubmittedOn)).toBe(true);
    const kunti = rows.find((r) => r.customerName === 'KUNTI');
    expect(kunti?.instrumentMaturityOn).toBe('2026-06-09');
    expect(kunti?.formSubmittedOn).toBe('2026-07-29');
    expect(kunti?.paymentOn).toBe('2026-08-03');
    expect(rows.filter((r) => r.paymentOn).length).toBeGreaterThan(80);
  });
});
