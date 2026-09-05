import { describe, expect, it } from 'vitest';
import {
  REGISTER_TEMPLATE_HEADERS,
  REGISTER_TEMPLATE_INPUT_HEADERS,
  defaultWindowDaysFor,
  isTemplateInputHeader,
  parseRegisterDate,
  parseRegisterGrid,
  parseRupeesNumber,
  excelSerialToISO,
} from '../src/lib/excel-register';
import { payoutPlanFor } from '../src/lib/payout-policy';

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
    expect(rows[0].branchReference).toBe('');
  });

  it('reads the Branch Code used by a compiled headquarters workbook', () => {
    const { rows, errors } = parseRegisterGrid([
      ['Branch Code', ...header],
      ['AZM', '1001', 'Asha', '29/6/2026', '24/7/2026', '', 50000, 0, 50000, 'Suresh', 0],
    ]);
    expect(errors).toEqual([]);
    expect(rows[0].branchReference).toBe('AZM');
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

  it('imports the Register template even when Form-in or maturity dates are blank', () => {
    const { rows, errors } = parseRegisterGrid([
      [
        'Savings Account Number',
        'Customer Name',
        'Date of Maturity',
        'Form Submission Date',
        'Payment Date',
        'Maturity Amount',
        "Customer's Agent Name",
      ],
      ['1001', 'Asha', '', '', '', 50000, 'Suresh'],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].customerName).toBe('Asha');
    expect(rows[0].formSubmittedOn).toBeNull();
    expect(rows[0].instrumentMaturityOn).toBeNull();
    expect(rows[0].warnings.some((w) => /form-in date is blank/i.test(w))).toBe(true);
  });

  it('accepts the on-screen Form in heading as the form date', () => {
    const { rows, errors } = parseRegisterGrid([
      ['Customer Name', 'Maturity Amount', 'Form in'],
      ['Asha', 50000, '24/07/2026'],
    ]);
    expect(errors).toEqual([]);
    expect(rows[0].formSubmittedOn).toBe('2026-07-24');
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

describe('branch template', () => {
  const HEADERS = [...REGISTER_TEMPLATE_HEADERS];

  it('carries the fourteen columns the office asked for, in order', () => {
    expect(HEADERS).toEqual([
      'Account Number',
      'Customer Name',
      'Agent Name',
      'Maturity Amount',
      'Maturity Date',
      'Form Submission Date',
      'Approval Date',
      'Payment Date',
      'Remaining',
      'Paid',
      'Missed Amount',
      "Today's Amount",
      'Total Amount',
      'Actual Paid',
    ]);
  });

  it('asks the branch for four cells and derives the rest', () => {
    expect([...REGISTER_TEMPLATE_INPUT_HEADERS]).toEqual([
      'Account Number',
      'Customer Name',
      'Agent Name',
      'Maturity Amount',
    ]);
    for (const h of REGISTER_TEMPLATE_INPUT_HEADERS) expect(isTemplateInputHeader(h)).toBe(true);
    for (const h of ['Remaining', 'Paid', 'Missed Amount', "Today's Amount", 'Total Amount']) {
      expect(isTemplateInputHeader(h)).toBe(false);
    }
  });

  it('reads a fully filled line off the new headers', () => {
    const { rows, errors } = parseRegisterGrid([
      HEADERS,
      ['1001601234', 'Rajesh', 'Santosh', 135000, '21-08-2026', '25-08-2026', '28-08-2026', '29-08-2026', 72500, 22500, 33750, 11250, 45000, 40000],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.accountNumber).toBe('1001601234');
    expect(r.customerName).toBe('Rajesh');
    expect(r.agentName).toBe('Santosh');
    expect(r.maturityRupees).toBe(135000);
    expect(r.instrumentMaturityOn).toBe('2026-08-21');
    expect(r.formSubmittedOn).toBe('2026-08-25');
    expect(r.approvedOn).toBe('2026-08-28');
    expect(r.paymentOn).toBe('2026-08-29');
    // "Paid" must not be read from "Actual Paid", which also contains the word.
    expect(r.paidRupees).toBe(22500);
  });

  it('takes a line with only the four typed cells', () => {
    const { rows } = parseRegisterGrid([
      HEADERS,
      ['1001601234', 'Rajesh', 'Santosh', 135000, '', '', '', '', '', '', '', '', '', ''],
    ]);
    const r = rows[0];
    expect(r.customerName).toBe('Rajesh');
    expect(r.maturityRupees).toBe(135000);
    expect(r.instrumentMaturityOn).toBeNull();
    expect(r.paymentOn).toBeNull();
    expect(r.approvedOn).toBeNull();
    // Nothing was typed, so nothing is claimed as paid.
    expect(r.paidRupees).toBe(0);
    expect(r.remainingRupees).toBe(135000);
  });
});

describe('the twelve / six split', () => {
  it('gives a lakh and over twelve daily payouts', () => {
    const window = defaultWindowDaysFor(135000);
    expect(window).toBe(15);
    const plan = payoutPlanFor(13_500_000n, window);
    expect(plan.cadence).toBe('DAILY');
    expect(plan.payoutDays).toBe(12);
    expect(plan.stride).toBe(1);
  });

  it('treats exactly one lakh as a large case', () => {
    const plan = payoutPlanFor(10_000_000n, defaultWindowDaysFor(100000));
    expect(plan.cadence).toBe('DAILY');
    expect(plan.payoutDays).toBe(12);
  });

  it('gives anything below a lakh six payouts on alternate days', () => {
    const window = defaultWindowDaysFor(50000);
    expect(window).toBe(14);
    const plan = payoutPlanFor(5_000_000n, window);
    expect(plan.cadence).toBe('ALTERNATE');
    expect(plan.payoutDays).toBe(6);
    expect(plan.stride).toBe(2);
  });

  it('derives the window from the sheet when no Window Days column exists', () => {
    const { rows } = parseRegisterGrid([
      [...REGISTER_TEMPLATE_HEADERS],
      ['1', 'Big', 'A', 135000, '', '', '', '', '', '', '', '', '', ''],
      ['2', 'Small', 'A', 50000, '', '', '', '', '', '', '', '', '', ''],
    ]);
    expect(rows[0].windowDays).toBe(15);
    expect(rows[1].windowDays).toBe(14);
  });
});
