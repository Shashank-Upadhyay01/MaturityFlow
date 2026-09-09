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
  'Maturity Date': 'Optional import value. Type DD-MM-YYYY. Blank dates the case from the day it is imported.',
  'Form Submission Date': 'Optional import value. Type DD-MM-YYYY. Blank falls back to the maturity date, or the import date.',
  'Approval Date': 'Optional import value. Type DD-MM-YYYY. Blank is filled from the workflow and remains editable by authorised roles.',
  'Payment Date': 'Optional import value. Type DD-MM-YYYY. Blank means three days after maturity, rolled onto the next open day.',
  Remaining: 'Maturity amount minus what has actually been paid. Missed days never reduce it.',
  Paid: 'Everything handed over on this case so far.',
  'Missed Amount': 'Earlier due days the customer did not collect.',
  "Today's Amount": 'The scheduled instalment for this date, using the recommended amount band or an authorised custom plan.',
  'Total Amount': "Missed amount plus today's \u2014 what the customer can collect now.",
  'Actual Paid': 'What was handed over today. Typed at the counter, not here.',
};

/**
 * Keep day-first input as text while a branch fills the workbook.
 *
 * A `dd-mm-yyyy` display format alone cannot do this: Excel first interprets the typed value using
 * the computer locale. On a month-first installation, `03-09-2026` is already stored as 9 March
 * before the display format runs. Text cells preserve the exact value for the importer to parse.
 */
export const TEMPLATE_DATE_HEADERS = new Set([
  'Maturity Date',
  'Form Submission Date',
  'Approval Date',
  'Payment Date',
]);

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
    if (TEMPLATE_DATE_HEADERS.has(String(headers[i] ?? ''))) c.numFmt = '@';
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
    'Type only the blue columns. Recommended visits: up to \u20b910,000 = 1; up to \u20b925,000 = 2; ' +
      'up to \u20b950,000 = 3; below \u20b91 lakh = 4 alternate; \u20b91 lakh and above = 12 daily.',
  ]);
  ex.getRow(4).font = { italic: true, color: { argb: 'FF7F7F7F' } };
  ex.columns.forEach((c, i) => {
    c.width = Math.max(14, String(headers[i] ?? '').length + 4);
    if (TEMPLATE_DATE_HEADERS.has(String(headers[i] ?? ''))) c.numFmt = '@';
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
