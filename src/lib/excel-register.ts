/**
 * Parse / emit the branch maturity register (the Excel they use today).
 * Dates are India (day/month/year). Money is rupees as number, converted to paise by the caller.
 */
import { recommendedPayoutDaysFor, recommendedWindowDaysFor } from './payout-policy';
import { DEFAULT_REGISTER_LAYOUT, excelHeadersForLayout } from './register-layout';
import { parseISODate, type ISODate } from './working-days';
import { parseRupeesToPaise } from './money';

export const REGISTER_COLUMNS = excelHeadersForLayout(DEFAULT_REGISTER_LAYOUT);

/**
 * The branch template, left to right, exactly as the office asked for it.
 *
 * Only the first four are typed by the branch. The rest are the register's own answer: the dates
 * the case moves through and the five money columns the system computes. They are still in the
 * file, because the template doubles as the shape of the sheet the branch reads back — but a
 * branch filling them in by hand is a branch disagreeing with the ledger.
 */
export const REGISTER_TEMPLATE_HEADERS = [
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
] as const;

/** The only four cells a branch is asked to type. Everything else the system derives. */
export const REGISTER_TEMPLATE_INPUT_HEADERS = [
  'Account Number',
  'Customer Name',
  'Agent Name',
  'Maturity Amount',
] as const;

const INPUT_SET = new Set<string>(REGISTER_TEMPLATE_INPUT_HEADERS);

/** True where the branch types the value; false where the register fills it in. */
export function isTemplateInputHeader(header: string): boolean {
  return INPUT_SET.has(header);
}

/** Headers the branch import file always has. Hidden Register columns must not strip these. */
export const REGISTER_IMPORT_HEADERS = REGISTER_TEMPLATE_HEADERS;

/**
 * Payout days a maturity gets when the sheet does not say.
 *
 * Small maturities use fewer visits; above ₹1 lakh uses twelve working-day payments. The
 * template carries no Window Days column at all —
 * the amount already decides it, and a column the branch has to fill in is one they can fill in
 * wrongly.
 */
export function defaultPayoutDaysFor(maturityPaise: bigint): number {
  return recommendedPayoutDaysFor(maturityPaise);
}

/** The working-day window that yields those payouts, from a rupee figure off the sheet. */
export function defaultWindowDaysFor(maturityRupees: number): number {
  const paise = BigInt(Math.round((Number.isFinite(maturityRupees) ? maturityRupees : 0) * 100));
  return recommendedWindowDaysFor(paise);
}

export interface RegisterRow {
  /** Branch code/name from a compiled HQ workbook. Empty on a single-branch legacy sheet. */
  branchReference: string;
  accountNumber: string;
  customerName: string;
  instrumentMaturityOn: ISODate | null;
  formSubmittedOn: ISODate | null;
  /** Only where the branch typed one; otherwise the register fills it from the form date. */
  approvedOn: ISODate | null;
  paymentOn: ISODate | null;
  maturityRupees: number;
  /** Exact values from the spreadsheet boundary; services must use these when present. */
  maturityPaise?: string;
  paidPaise?: string;
  todayPayablePaise?: string;
  paidRupees: number;
  remainingRupees: number;
  agentName: string;
  todayPayableRupees: number;
  windowDays: number;
  rowNumber: number;
  warnings: string[];
}

const DMY = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/;
const DMY2 = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_STAMP = /^(\d{4})-(\d{2})-(\d{2})T/;

export function toISO(y: number, m: number, d: number): ISODate | null {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  try {
    parseISODate(s);
    return s as ISODate;
  } catch {
    return null;
  }
}

/** Excel serial (days since 1899-12-30) → ISO. */
export function excelSerialToISO(n: number): ISODate | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000;
  const dt = new Date(utc);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Flatten ExcelJS cell values so server actions receive strings, not Date objects. */
export function excelCellRaw(value: unknown): unknown {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toISO(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()) ?? '';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value;
  }
  if (typeof value === 'object') {
    const o = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if ('result' in o) return excelCellRaw(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join('');
    if (typeof o.text === 'string') return o.text;
    if (typeof o.hyperlink === 'string') return o.hyperlink;
  }
  return value;
}

/**
 * Read a date off a register sheet.
 *
 * Nothing here guesses at day-vs-month order, and that is the whole point.
 *
 * There used to be an `indianiseAmbiguous` step that swapped the two parts whenever both were 12
 * or under, on the theory that the file had been written by a US-locale Excel. It destroyed
 * correct data: a branch typing 05-09-2026 into a template got a workbook holding the real serial
 * for 5 September, and the swap turned it into 9 May. Every payment date in a 25-row import
 * landed in the wrong month, the schedules were generated against those dates, and the sheet had
 * to be corrected by hand — which is the opposite of what an import is for.
 *
 * Every input this function accepts is already unambiguous:
 *   - a Date, and an Excel serial, are a specific day. Excel stores the serial, never the
 *     display format, so the number in the file is the day the branch picked.
 *   - an ISO string is YYYY-MM-DD by definition.
 *   - dd-mm-yyyy text is read day-first, which is what the branch writes.
 * A file genuinely exported month-first is a problem at the point of export, and quietly
 * rewriting good dates to compensate costs far more than it ever saved.
 */
export function parseRegisterDate(raw: unknown): ISODate | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return (
      toISO(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()) ??
      toISO(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
    );
  }
  if (typeof raw === 'number') return excelSerialToISO(raw);
  if (typeof raw === 'object' && raw && 'result' in (raw as object)) {
    return parseRegisterDate((raw as { result: unknown }).result);
  }
  const s = String(raw).trim();
  if (/^\d{5}(?:\.\d+)?$/.test(s)) return excelSerialToISO(Number(s));
  const dmy = s.match(DMY);
  if (dmy) return toISO(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const dmy2 = s.match(DMY2);
  if (dmy2) {
    const yy = Number(dmy2[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return toISO(year, Number(dmy2[2]), Number(dmy2[1]));
  }
  const stamp = s.match(ISO_STAMP);
  if (stamp) return parseRegisterDate(s.slice(0, 10));
  const iso = s.match(ISO);
  if (iso) return toISO(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

export function parseRupeesNumber(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = Number(String(raw).replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function parseRegisterGrid(grid: unknown[][]): { rows: RegisterRow[]; errors: string[] } {
  const errors: string[] = [];
  if (grid.length < 2) return { rows: [], errors: ['The sheet is empty.'] };

  const key = (value: unknown) => String(excelCellRaw(value) ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const headerIndex = grid.findIndex((line) => Array.isArray(line) && line.some((h) => key(h) === 'customername') && line.some((h) => key(h) === 'maturityamount'));
  const header = (grid[headerIndex] ?? []).map(key);
  const idx = (label: string) => header.indexOf(key(label));
  const firstIdx = (...labels: string[]) => {
    for (const label of labels) {
      const i = idx(label);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iAcct = firstIdx('account number', 'savings account number', 'account no', 'account');
  const iName = firstIdx('customer name', 'customer');
  const iMat = firstIdx('date of maturity', 'maturity date', 'maturity');
  // Match the complete header first.  The workbook uses "Form Submission Date"; the shorter
  // aliases remain for older branch sheets, but must not be treated as prefixes because e.g.
  // "Maturity" could otherwise match the Maturity Amount column.
  const iSub = firstIdx('form submission date', 'form submission', 'submission date', 'submission', 'form in date', 'form in', 'form date');
  const iPay = firstIdx('payment date', 'payment');
  const iAmt = idx('maturity amount');
  const iPaid = firstIdx('paid', 'paid maturity', 'paid amount');
  const iRem = firstIdx('remaining', 'remaining amount');
  const iAgent = firstIdx('agent name', "customer's agent name", 'agent');
  const iToday = firstIdx('due payment', "today's amount", "today's approved withdrawalable amount", 'today');
  const iApproval = firstIdx('approval date', 'approval');
  const iWin = firstIdx('window days', 'window', 'days');
  const iBranchCode = idx('branch code');
  const iBranchName = idx('branch name');
  const iBranch = iBranchCode >= 0 ? iBranchCode : iBranchName >= 0 ? iBranchName : header.indexOf('branch');

  if (iName < 0 || iAmt < 0) {
    return {
      rows: [],
      errors: ['Header row must include Customer Name and Maturity Amount. Download the Register template.'],
    };
  }

  const rows: RegisterRow[] = [];
  for (let r = headerIndex + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const customerName = String(excelCellRaw(line[iName]) ?? '').trim();
    if (!customerName) {
      if (iAcct >= 0 && String(excelCellRaw(line[iAcct]) ?? '').trim()) errors.push(`Row ${r + 1}: Customer Name is required.`);
      continue;
    }
    if (/^(?:grand\s+)?total(?:s)?$/i.test(customerName) || key(customerName) === 'customername') continue;
    const warnings: string[] = [];
    const formSubmittedOn = iSub >= 0 ? parseRegisterDate(excelCellRaw(line[iSub])) : null;
    let paymentOn = iPay >= 0 ? parseRegisterDate(excelCellRaw(line[iPay])) : null;
    const instrumentMaturityOn = iMat >= 0 ? parseRegisterDate(excelCellRaw(line[iMat])) : null;
    const approvedOn = iApproval >= 0 ? parseRegisterDate(excelCellRaw(line[iApproval])) : null;
    const invalidDate = [[iSub, formSubmittedOn, 'Form Submission Date'], [iPay, paymentOn, 'Payment Date'], [iMat, instrumentMaturityOn, 'Maturity Date'], [iApproval, approvedOn, 'Approval Date']]
      .find(([column, date]) => Number(column) >= 0 && String(excelCellRaw(line[Number(column)]) ?? '').trim() !== '' && !date);
    if (invalidDate) {
      errors.push(`Row ${r + 1} (${customerName}): invalid ${invalidDate[2]}; use dd-mm-yyyy or a valid Excel date.`);
      continue;
    }
    let maturityPaise: bigint;
    let paidPaise: bigint;
    let todayPaise: bigint;
    try {
      const moneyAt = (column: number) => parseRupeesToPaise((column < 0 ? '' : excelCellRaw(line[column])) as string | number || '0');
      maturityPaise = moneyAt(iAmt);
      paidPaise = moneyAt(iPaid);
      todayPaise = moneyAt(iToday);
      if (maturityPaise <= 0n) throw new Error('Maturity Amount must be greater than zero.');
      if (paidPaise > maturityPaise) throw new Error('Paid exceeds Maturity Amount.');
    } catch (error) {
      errors.push(`Row ${r + 1} (${customerName}): ${error instanceof Error ? error.message : 'Invalid money value.'}`);
      continue;
    }
    const maturityRupees = Number(maturityPaise) / 100;
    const paidRupees = Number(paidPaise) / 100;
    const remainingRupees = Number(maturityPaise - paidPaise) / 100;
    if (iRem >= 0 && String(excelCellRaw(line[iRem]) ?? '').trim() !== '' && parseRupeesNumber(excelCellRaw(line[iRem])) !== remainingRupees) {
      warnings.push('Remaining did not match amount − paid; remaining was recomputed.');
    }
    if (!formSubmittedOn) {
      warnings.push('Form-in date is blank; it will be filled from the maturity date or today.');
    }
    if (!instrumentMaturityOn) {
      warnings.push('Maturity date is blank.');
    }
    if (paymentOn && formSubmittedOn && paymentOn < formSubmittedOn) {
      // A legacy workbook may contain a payment cell that Excel parsed month-first while the
      // form date is typed day-first (for example ISO 2026-03-08 for an intended 03-08-2026).
      // Only accept the swap when it repairs the impossible chronology; ordinary ISO/Date input
      // remains untouched everywhere else.
      const rawPayment = String(excelCellRaw(line[iPay]) ?? '').trim();
      const iso = rawPayment.match(ISO);
      const swapped = iso ? toISO(Number(iso[1]), Number(iso[3]), Number(iso[2])) : null;
      if (swapped && swapped >= formSubmittedOn) paymentOn = swapped;
      else warnings.push('Payment date is before form submission; the supplied date is preserved.');
    }
    const windowDays =
      iWin >= 0
        ? Number(excelCellRaw(line[iWin]) || defaultWindowDaysFor(maturityRupees))
        : defaultWindowDaysFor(maturityRupees);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
      errors.push(`Row ${r + 1} (${customerName}): Window Days must be a whole number from 1 to 366.`);
      continue;
    }
    const account = iAcct >= 0 ? excelCellRaw(line[iAcct]) : '';
    if (typeof account === 'number' && (!Number.isSafeInteger(account) || account < 0) || typeof account === 'string' && /^\d+(?:\.\d+)?e[+-]?\d+$/i.test(account)) {
      errors.push(`Row ${r + 1} (${customerName}): account number lost precision in Excel; format the account column as Text and enter it again.`);
      continue;
    }
    const agentName = iAgent >= 0 ? String(excelCellRaw(line[iAgent]) ?? '').trim() || 'Unassigned' : 'Unassigned';
    rows.push({
      branchReference: iBranch >= 0 ? String(excelCellRaw(line[iBranch]) || (iBranchName >= 0 ? excelCellRaw(line[iBranchName]) : '') || '').trim() : '',
      accountNumber: iAcct >= 0 ? accountString(excelCellRaw(line[iAcct])) : '',
      customerName,
      instrumentMaturityOn,
      formSubmittedOn,
      paymentOn,
      maturityRupees,
      maturityPaise: maturityPaise.toString(),
      paidPaise: paidPaise.toString(),
      todayPayablePaise: todayPaise.toString(),
      paidRupees,
      remainingRupees,
      agentName,
      approvedOn,
      todayPayableRupees: Number(todayPaise) / 100,
      windowDays,
      rowNumber: r + 1,
      warnings,
    });
  }
  return { rows, errors };
}

function accountString(raw: unknown): string {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.round(raw));
  return String(raw).trim();
}
