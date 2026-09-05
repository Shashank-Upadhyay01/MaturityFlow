/**
 * register-template.ts — the branch template workbook.
 *
 * Kept out of the route for the same reason the register's rules are kept out of its component:
 * building the file needs no request, no session and no database, so it should be callable — and
 * testable — without one.
 */

import { REGISTER_TEMPLATE_HEADERS, isTemplateInputHeader } from './excel-register';

/**
 * One filled line, shown on a second worksheet.
 *
 * Deliberately NOT on the sheet the branch types into. The importer reads worksheet one and only
 * worksheet one, so an example living here can never be imported as a real customer — which is
 * exactly what happened while the sample sat in row 2 and somebody forgot to delete it.
 */
export const TEMPLATE_EXAMPLE: Record<string, string | number> = {
  'Account Number': '1001601234',
  'Customer Name': 'Rajesh',
  'Agent Name': 'Santosh',
  'Maturity Amount': 135000,
  'Maturity Date': '21-08-2026',
  'Form Submission Date': '25-08-2026',
  'Approval Date': '28-08-2026',
  'Payment Date': '29-08-2026',
  Remaining: 72500,
  Paid: 22500,
  'Missed Amount': 33750,
  "Today's Amount": 11250,
  'Total Amount': 45000,
  'Actual Paid': 40000,
};

/** What each system-filled column is, for the note on its heading. */
export const TEMPLATE_DERIVED_NOTE: Record<string, string> = {
  'Maturity Date': 'Optional. Leave blank and the register dates the case from the day it is imported.',
  'Form Submission Date': 'Optional. Blank falls back to the maturity date, or the import date.',
  'Approval Date': 'Filled in as three days after the form date. Only Ops Head, Admin, CEO or CMD can change it later.',
  'Payment Date': 'Optional. Blank means three days after maturity, rolled onto the next open day. Payouts start here.',
  Remaining: 'Maturity amount minus what has actually been paid. Missed days never reduce it.',
  Paid: 'Everything handed over on this case so far.',
  'Missed Amount': 'Earlier due days the customer did not collect.',
  "Today's Amount": 'The fixed daily instalment: amount \u00f7 12 at \u20b91 lakh and over, \u00f7 6 below it.',
  'Total Amount': "Missed amount plus today's \u2014 what the customer can collect now.",
  'Actual Paid': 'What was handed over today. Typed at the counter, not here.',
};

export function templateHeaders(compiled: boolean): string[] {
  return [...(compiled ? ['Branch Code'] : []), ...REGISTER_TEMPLATE_HEADERS];
}

/** Build the .xlsx. Returns the buffer the route streams back. */
export async function buildRegisterTemplate({
  compiled,
  branchCode,
}: {
  compiled: boolean;
  branchCode: string;
}): Promise<ArrayBuffer> {
  const headers = templateHeaders(compiled);

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);

  /*
    The typed columns are marked, the rest are greyed.

    A branch opening this file has to see, without reading anything, which cells are theirs.
    Everything past Maturity Amount is the register's own answer — greying it is the whole
    instruction, and the note on each heading says what that answer will be.
  */
  const head = ws.getRow(1);
  head.font = { bold: true };
  headers.forEach((label, i) => {
    const cell = head.getCell(i + 1);
    const typed = label === 'Branch Code' || isTemplateInputHeader(label);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: typed ? 'FFDDEBF7' : 'FFF2F2F2' },
    };
    cell.font = { bold: true, color: { argb: typed ? 'FF1F3864' : 'FF7F7F7F' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
    const note = typed ? 'Type this one.' : TEMPLATE_DERIVED_NOTE[label];
    if (note) cell.note = note;
  });
  ws.columns.forEach((c, i) => {
    c.width = Math.max(14, String(headers[i] ?? '').length + 4);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  // Worksheet two: what a completed line looks like. Never read by the importer.
  const ex = wb.addWorksheet('Example');
  ex.addRow(headers);
  ex.getRow(1).font = { bold: true };
  ex.addRow([
    ...(compiled ? [branchCode] : []),
    ...REGISTER_TEMPLATE_HEADERS.map((h) => TEMPLATE_EXAMPLE[h] ?? ''),
  ]);
  ex.addRow([]);
  ex.addRow([
    'Type only the blue columns. On \u20b91,35,000 the register splits 12 daily payouts of ' +
      '\u20b911,250; below \u20b91 lakh it is 6 payouts on alternate days.',
  ]);
  ex.getRow(4).font = { italic: true, color: { argb: 'FF7F7F7F' } };
  ex.columns.forEach((c, i) => {
    c.width = Math.max(14, String(headers[i] ?? '').length + 4);
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
