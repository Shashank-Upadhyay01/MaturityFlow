/**
 * Parse / emit the branch maturity register (the Excel they use today).
 * Dates are India (day/month/year). Money is rupees as number, converted to paise by the caller.
 */
import { DEFAULT_REGISTER_LAYOUT, excelHeadersForLayout } from './register-layout';
import { parseISODate, type ISODate } from './working-days';

export const REGISTER_COLUMNS = excelHeadersForLayout(DEFAULT_REGISTER_LAYOUT);

export interface RegisterRow {
  accountNumber: string;
  customerName: string;
  instrumentMaturityOn: ISODate | null;
  formSubmittedOn: ISODate;
  paymentOn: ISODate | null;
  maturityRupees: number;
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
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000;
  const dt = new Date(utc);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** 3 Aug stored as 2026-03-08 (US mm-dd) → 2026-08-03. Unambiguous days (>12) stay as y-m-d. */
export function indianiseAmbiguous(iso: ISODate): ISODate {
  const y = Number(iso.slice(0, 4));
  const a = Number(iso.slice(5, 7));
  const b = Number(iso.slice(8, 10));
  if (a <= 12 && b <= 12 && a !== b) {
    return toISO(y, b, a) ?? iso;
  }
  return iso;
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

export function parseRegisterDate(raw: unknown, opts: { indianAmbiguous?: boolean } = {}): ISODate | null {
  const indian = opts.indianAmbiguous !== false;
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const utc = toISO(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
    const local = toISO(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
    const picked = utc ?? local;
    return picked && indian ? indianiseAmbiguous(picked) : picked;
  }
  if (typeof raw === 'number') {
    const iso = excelSerialToISO(raw);
    return iso && indian ? indianiseAmbiguous(iso) : iso;
  }
  if (typeof raw === 'object' && raw && 'result' in (raw as object)) {
    return parseRegisterDate((raw as { result: unknown }).result, opts);
  }
  const s = String(raw).trim();
  const dmy = s.match(DMY);
  if (dmy) return toISO(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const dmy2 = s.match(DMY2);
  if (dmy2) {
    const yy = Number(dmy2[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return toISO(year, Number(dmy2[2]), Number(dmy2[1]));
  }
  const stamp = s.match(ISO_STAMP);
  if (stamp) return parseRegisterDate(s.slice(0, 10), opts);
  const iso = s.match(ISO);
  if (iso) {
    const y = Number(iso[1]);
    const a = Number(iso[2]);
    const b = Number(iso[3]);
    const picked = toISO(y, a, b) ?? toISO(y, b, a);
    return picked && indian ? indianiseAmbiguous(picked) : picked;
  }
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

  const header = grid[0].map((h) => String(h ?? '').trim().toLowerCase());
  const idx = (label: string) => header.findIndex((h) => h.includes(label));
  const iAcct = idx('account');
  const iName = idx('customer');
  const iMat = idx('date of maturity') >= 0 ? idx('date of maturity') : idx('maturity');
  const iSub = idx('submission');
  const iPay = idx('payment');
  const iAmt = header.findIndex((h) => h === 'maturity amount' || h.includes('maturity amount'));
  const iPaid = idx('paid');
  const iRem = idx('remaining');
  const iAgent = idx('agent');
  const iToday = idx('today');
  const iWin = idx('window');

  if (iName < 0 || iAmt < 0 || iSub < 0) {
    return {
      rows: [],
      errors: [
        'Header row must include Customer Name, Maturity Amount and Form Submission Date. Download the template.',
      ],
    };
  }

  const rows: RegisterRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const customerName = String(excelCellRaw(line[iName]) ?? '').trim();
    if (!customerName) continue;
    const warnings: string[] = [];
    const formSubmittedOn = parseRegisterDate(excelCellRaw(line[iSub]));
    let paymentOn = iPay >= 0 ? parseRegisterDate(excelCellRaw(line[iPay])) : null;
    const instrumentMaturityOn = iMat >= 0 ? parseRegisterDate(excelCellRaw(line[iMat])) : null;
    const maturityRupees = parseRupeesNumber(excelCellRaw(line[iAmt]));
    const paidRupees = iPaid >= 0 ? parseRupeesNumber(excelCellRaw(line[iPaid])) : 0;
    let remainingRupees = iRem >= 0 ? parseRupeesNumber(excelCellRaw(line[iRem])) : maturityRupees - paidRupees;
    if (Math.abs(maturityRupees - paidRupees - remainingRupees) > 1) {
      remainingRupees = Math.max(0, maturityRupees - paidRupees);
      warnings.push('Remaining did not match amount − paid; remaining was recomputed.');
    }
    if (!formSubmittedOn) {
      errors.push(`Row ${r + 1} (${customerName}): missing form submission date.`);
      continue;
    }
    if (paymentOn && paymentOn < formSubmittedOn) {
      const iso = String(excelCellRaw(line[iPay]) ?? '').match(ISO);
      const swapped = iso ? toISO(Number(iso[1]), Number(iso[3]), Number(iso[2])) : null;
      if (swapped && swapped >= formSubmittedOn) paymentOn = swapped;
      else {
        warnings.push('Payment date was before submission; using submission date as approval.');
        paymentOn = formSubmittedOn;
      }
    }
    const windowDays = iWin >= 0 ? Math.max(1, Math.round(parseRupeesNumber(excelCellRaw(line[iWin])) || 15)) : 15;
    const agentName = iAgent >= 0 ? String(excelCellRaw(line[iAgent]) ?? '').trim() || 'Unassigned' : 'Unassigned';
    rows.push({
      accountNumber: iAcct >= 0 ? accountString(excelCellRaw(line[iAcct])) : '',
      customerName,
      instrumentMaturityOn,
      formSubmittedOn,
      paymentOn,
      maturityRupees,
      paidRupees,
      remainingRupees,
      agentName,
      todayPayableRupees: iToday >= 0 ? parseRupeesNumber(excelCellRaw(line[iToday])) : 0,
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
