import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { REGISTER_TEMPLATE_HEADERS } from '../src/lib/excel-register';
import { buildRegisterTemplate, templateHeaders } from '../src/lib/register-template';

async function open(compiled: boolean) {
  const buf = await buildRegisterTemplate({ compiled, branchCode: 'AZM' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const values = (ws: ExcelJS.Worksheet, row: number) =>
  (ws.getRow(row).values as unknown[]).slice(1);

describe('branch template workbook', () => {
  it('puts the fourteen headings on the sheet the branch types into', async () => {
    const wb = await open(false);
    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Register');
    expect(values(ws, 1)).toEqual([...REGISTER_TEMPLATE_HEADERS]);
  });

  it('ships no data row, so nothing can be imported by accident', async () => {
    const wb = await open(false);
    // The old template carried a sample in row 2 and it got imported as a real customer.
    expect(wb.worksheets[0].rowCount).toBe(1);
  });

  it('keeps the worked example on a second sheet the importer never reads', async () => {
    const wb = await open(false);
    // register-import.tsx reads worksheets[0] and only worksheets[0].
    expect(wb.worksheets[1].name).toBe('Example');
    expect(values(wb.worksheets[1], 2)[1]).toBe('Rajesh');
    expect(values(wb.worksheets[1], 2)[3]).toBe(135000);
  });

  it('marks the four typed columns differently from the ten derived ones', async () => {
    const wb = await open(false);
    const head = wb.worksheets[0].getRow(1);
    const fill = (col: number) =>
      ((head.getCell(col).fill as ExcelJS.FillPattern).fgColor ?? {}).argb;
    // Account, Customer, Agent, Maturity Amount.
    for (const col of [1, 2, 3, 4]) expect(fill(col)).toBe('FFDDEBF7');
    // Remaining, Paid, Missed, Today's, Total, Actual paid.
    for (const col of [9, 10, 11, 12, 13, 14]) expect(fill(col)).toBe('FFF2F2F2');
  });

  it('explains every derived column on its heading', async () => {
    const wb = await open(false);
    const head = wb.worksheets[0].getRow(1);
    for (let col = 1; col <= REGISTER_TEMPLATE_HEADERS.length; col += 1) {
      expect(head.getCell(col).note).toBeTruthy();
    }
  });

  it('adds a branch column only for the compiled workbook', async () => {
    expect(templateHeaders(false)[0]).toBe('Account Number');
    expect(templateHeaders(true)[0]).toBe('Branch Code');
    const wb = await open(true);
    expect(values(wb.worksheets[0], 1)[0]).toBe('Branch Code');
    expect(values(wb.worksheets[1], 2)[0]).toBe('AZM');
  });
});
