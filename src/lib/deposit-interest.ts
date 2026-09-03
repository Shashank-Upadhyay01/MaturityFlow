/**
 * deposit-interest.ts — HQ reading of deposits at a chosen interest rate.
 *
 * Pure, deterministic, bigint paise. This is not the payout engine and does not
 * write a schedule. CMD/CEO use it to see what a deposit book is worth at 8.50%
 * (or any other rate they type).
 */
import { excelCellRaw, parseRegisterDate } from './excel-register';
import {
  MAX_PAISE,
  percentBps,
  tryParseRupeesToPaise,
  type Paise,
} from './money';
import { isPriorityCase } from './payout-policy';
import type { ISODate } from './working-days';

/** The bank's published deposit rate — 8.50%. Stored as basis points. */
export const DEFAULT_INTEREST_BPS = 850;
export const MIN_INTEREST_BPS = 0;
/** 100.00% — a hard ceiling so a mistyped rate cannot explode the book. */
export const MAX_INTEREST_BPS = 10_000;

export const DEPOSIT_INTEREST_HEADERS = [
  'Customer Name',
  'Agent Name',
  'Maturity Date',
  'Total Deposited Amount',
] as const;

export const DEPOSIT_INTEREST_EXPORT_HEADERS = [
  'Customer Name',
  'Agent Name',
  'Maturity Date',
  'Total Deposited Amount',
  'Interest',
  'Amount with interest',
  'Rate %',
] as const;

export interface DepositRow {
  name: string;
  depositedPaise: Paise;
  maturityOn?: ISODate | null;
  agentName?: string | null;
}

export interface DepositInterestLine extends DepositRow {
  interestPaise: Paise;
  maturityPaise: Paise;
  largeCase: boolean;
  maturityOn: ISODate | null;
}

export type DepositBandId = 'under_50k' | 'from_50k_to_1l' | 'from_1l_to_5l' | 'from_5l';

export interface DepositBand {
  id: DepositBandId;
  label: string;
  count: number;
  depositedPaise: Paise;
  interestPaise: Paise;
  maturityPaise: Paise;
  shareBps: number;
}

export interface DepositInterestInsights {
  rateBps: number;
  lineCount: number;
  customerCount: number;
  depositedPaise: Paise;
  interestPaise: Paise;
  maturityPaise: Paise;
  averageDepositPaise: Paise;
  medianDepositPaise: Paise;
  largest: { name: string; depositedPaise: Paise; shareBps: number } | null;
  top5ShareBps: number;
  top10ShareBps: number;
  /** Counted on amount-with-interest, because the ₹1 lakh rule is a maturity rule. */
  dailyCadenceCount: number;
  alternateCadenceCount: number;
  dailyCadenceDepositedPaise: Paise;
  dailyCadenceMaturityPaise: Paise;
  alternateCadenceDepositedPaise: Paise;
  alternateCadenceMaturityPaise: Paise;
  bands: DepositBand[];
  plus25BpsInterestPaise: Paise;
  minus25BpsInterestPaise: Paise;
  datedCount: number;
  undatedCount: number;
  earliestOn: ISODate | null;
  latestOn: ISODate | null;
  nextOn: ISODate | null;
  pastCount: number;
  upcomingCount: number;
  months: DepositMonthBucket[];
}

export interface DepositMonthBucket {
  month: string;
  label: string;
  count: number;
  depositedPaise: Paise;
  interestPaise: Paise;
  maturityPaise: Paise;
}

const BANDS: { id: DepositBandId; label: string; min: Paise; max: Paise }[] = [
  { id: 'under_50k', label: 'Under ₹50,000', min: 0n, max: 4_999_999n },
  { id: 'from_50k_to_1l', label: '₹50,000 – ₹99,999', min: 5_000_000n, max: 9_999_999n },
  { id: 'from_1l_to_5l', label: '₹1,00,000 – ₹4,99,999', min: 10_000_000n, max: 49_999_999n },
  { id: 'from_5l', label: '₹5,00,000 and above', min: 50_000_000n, max: MAX_PAISE },
];

export class DepositInterestError extends Error {
  constructor(
    message: string,
    readonly code: 'BAD_RATE' | 'NEGATIVE_PRINCIPAL',
  ) {
    super(message);
    this.name = 'DepositInterestError';
  }
}

function assertRateBps(rateBps: number): void {
  if (!Number.isInteger(rateBps) || rateBps < MIN_INTEREST_BPS || rateBps > MAX_INTEREST_BPS) {
    throw new DepositInterestError(
      'Interest rate must be a whole number of basis points between 0% and 100%.',
      'BAD_RATE',
    );
  }
}

/**
 * Interest on a deposit at `rateBps` (850 = 8.50%), rounded half-up to the nearest paise.
 *
 * `principal * rateBps / 10_000`, with +5_000 before the divide so 0.5 paise goes up.
 */
export function interestOn(principalPaise: Paise, rateBps: number): Paise {
  assertRateBps(rateBps);
  if (principalPaise < 0n) {
    throw new DepositInterestError('Deposited amount cannot be negative.', 'NEGATIVE_PRINCIPAL');
  }
  if (principalPaise === 0n || rateBps === 0) return 0n;
  return (principalPaise * BigInt(rateBps) + 5_000n) / 10_000n;
}

export function maturityWithInterest(principalPaise: Paise, rateBps: number): Paise {
  return principalPaise + interestOn(principalPaise, rateBps);
}

export function applyInterest(rows: readonly DepositRow[], rateBps: number): DepositInterestLine[] {
  assertRateBps(rateBps);
  return rows.map((row) => {
    const interestPaise = interestOn(row.depositedPaise, rateBps);
    const maturityPaise = row.depositedPaise + interestPaise;
    return {
      name: row.name,
      agentName: row.agentName ?? null,
      depositedPaise: row.depositedPaise,
      maturityOn: row.maturityOn ?? null,
      interestPaise,
      maturityPaise,
      largeCase: isPriorityCase(maturityPaise),
    };
  });
}

/** "8.50", "8.5%", "8" → 850 / 850 / 800. Null while the field is empty or malformed. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim().replace(/%/g, '').replace(/,/g, '');
  if (s === '' || s === '.') return null;
  if (!/^\d{1,3}(?:\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const bps = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isInteger(bps) || bps < MIN_INTEREST_BPS || bps > MAX_INTEREST_BPS) return null;
  return bps;
}

/** 850 → "8.50". Always two decimals so the field matches the published rate. */
export function formatBpsAsPercent(bps: number): string {
  const safe = Number.isInteger(bps) ? bps : DEFAULT_INTEREST_BPS;
  const whole = Math.trunc(Math.abs(safe) / 100);
  const frac = Math.abs(safe) % 100;
  const sign = safe < 0 ? '-' : '';
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`;
}

function filledRows(rows: readonly DepositRow[]): DepositRow[] {
  return rows.filter((row) => row.name.trim() !== '' && row.depositedPaise > 0n);
}

function uniqueCustomerCount(rows: readonly DepositRow[]): number {
  const names = new Set<string>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key) names.add(key);
  }
  return names.size;
}

function medianPaise(values: Paise[]): Paise {
  if (values.length === 0) return 0n;
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2n;
}

function shareOfTop(sortedDesc: readonly DepositRow[], n: number, whole: Paise): number {
  if (whole === 0n || n <= 0) return 0;
  let part = 0n;
  for (let i = 0; i < n && i < sortedDesc.length; i += 1) part += sortedDesc[i].depositedPaise;
  return percentBps(part, whole);
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  if (!year || !value) return month;
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, value - 1, 1)));
}

export function summariseDepositInterest(
  rows: readonly DepositRow[],
  rateBps: number,
  opts: { asOf?: ISODate } = {},
): DepositInterestInsights {
  const live = filledRows(rows);
  const lines = applyInterest(live, rateBps);
  let depositedPaise = 0n;
  let interestPaise = 0n;
  let maturityPaise = 0n;
  let dailyCadenceCount = 0;
  let alternateCadenceCount = 0;
  let dailyCadenceDepositedPaise = 0n;
  let dailyCadenceMaturityPaise = 0n;
  let alternateCadenceDepositedPaise = 0n;
  let alternateCadenceMaturityPaise = 0n;

  const bandTotals = new Map<DepositBandId, { count: number; deposited: Paise; interest: Paise; maturity: Paise }>();
  for (const band of BANDS) {
    bandTotals.set(band.id, { count: 0, deposited: 0n, interest: 0n, maturity: 0n });
  }

  let largest: DepositInterestInsights['largest'] = null;

  for (const line of lines) {
    depositedPaise += line.depositedPaise;
    interestPaise += line.interestPaise;
    maturityPaise += line.maturityPaise;
    if (line.largeCase) {
      dailyCadenceCount += 1;
      dailyCadenceDepositedPaise += line.depositedPaise;
      dailyCadenceMaturityPaise += line.maturityPaise;
    } else {
      alternateCadenceCount += 1;
      alternateCadenceDepositedPaise += line.depositedPaise;
      alternateCadenceMaturityPaise += line.maturityPaise;
    }
    const band = BANDS.find((b) => line.depositedPaise >= b.min && line.depositedPaise <= b.max) ?? BANDS[BANDS.length - 1];
    const slot = bandTotals.get(band.id)!;
    slot.count += 1;
    slot.deposited += line.depositedPaise;
    slot.interest += line.interestPaise;
    slot.maturity += line.maturityPaise;
    if (!largest || line.depositedPaise > largest.depositedPaise) {
      largest = {
        name: line.name.trim(),
        depositedPaise: line.depositedPaise,
        shareBps: 0,
      };
    }
  }

  if (largest) largest = { ...largest, shareBps: percentBps(largest.depositedPaise, depositedPaise) };

  const asOf = opts.asOf ?? null;
  const monthTotals = new Map<string, { count: number; deposited: Paise; interest: Paise; maturity: Paise }>();
  let datedCount = 0;
  let undatedCount = 0;
  let earliestOn: ISODate | null = null;
  let latestOn: ISODate | null = null;
  let nextOn: ISODate | null = null;
  let pastCount = 0;
  let upcomingCount = 0;
  for (const line of lines) {
    const on = line.maturityOn;
    if (!on) {
      undatedCount += 1;
      continue;
    }
    datedCount += 1;
    if (!earliestOn || on < earliestOn) earliestOn = on;
    if (!latestOn || on > latestOn) latestOn = on;
    if (asOf) {
      if (on < asOf) pastCount += 1;
      else {
        upcomingCount += 1;
        if (!nextOn || on < nextOn) nextOn = on;
      }
    } else if (!nextOn || on < nextOn) {
      nextOn = on;
    }
    const month = on.slice(0, 7);
    const slot = monthTotals.get(month) ?? { count: 0, deposited: 0n, interest: 0n, maturity: 0n };
    slot.count += 1;
    slot.deposited += line.depositedPaise;
    slot.interest += line.interestPaise;
    slot.maturity += line.maturityPaise;
    monthTotals.set(month, slot);
  }

  const sortedDesc = [...live].sort((a, b) => (a.depositedPaise < b.depositedPaise ? 1 : a.depositedPaise > b.depositedPaise ? -1 : 0));
  const clampedPlus = Math.min(MAX_INTEREST_BPS, rateBps + 25);
  const clampedMinus = Math.max(MIN_INTEREST_BPS, rateBps - 25);

  return {
    rateBps,
    lineCount: live.length,
    customerCount: uniqueCustomerCount(live),
    depositedPaise,
    interestPaise,
    maturityPaise,
    averageDepositPaise: live.length === 0 ? 0n : depositedPaise / BigInt(live.length),
    medianDepositPaise: medianPaise(live.map((r) => r.depositedPaise)),
    largest,
    top5ShareBps: shareOfTop(sortedDesc, 5, depositedPaise),
    top10ShareBps: shareOfTop(sortedDesc, 10, depositedPaise),
    dailyCadenceCount,
    alternateCadenceCount,
    dailyCadenceDepositedPaise,
    dailyCadenceMaturityPaise,
    alternateCadenceDepositedPaise,
    alternateCadenceMaturityPaise,
    bands: BANDS.map((band) => {
      const slot = bandTotals.get(band.id)!;
      return {
        id: band.id,
        label: band.label,
        count: slot.count,
        depositedPaise: slot.deposited,
        interestPaise: slot.interest,
        maturityPaise: slot.maturity,
        shareBps: percentBps(slot.deposited, depositedPaise),
      };
    }),
    plus25BpsInterestPaise: applyInterest(live, clampedPlus).reduce((sum, line) => sum + line.interestPaise, 0n),
    minus25BpsInterestPaise: applyInterest(live, clampedMinus).reduce((sum, line) => sum + line.interestPaise, 0n),
    datedCount,
    undatedCount,
    earliestOn,
    latestOn,
    nextOn,
    pastCount,
    upcomingCount,
    months: [...monthTotals.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([month, slot]) => ({
        month,
        label: monthLabel(month),
        count: slot.count,
        depositedPaise: slot.deposited,
        interestPaise: slot.interest,
        maturityPaise: slot.maturity,
      })),
  };
}

const clean = (value: unknown): string => String(excelCellRaw(value) ?? '').trim();
const headerKey = (value: unknown): string => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

function columnIndex(header: string[], ...names: string[]): number {
  const keys = names.map(headerKey);
  return header.findIndex((value) => keys.includes(value));
}

function depositColumnIndex(header: string[]): number {
  const exact = columnIndex(
    header,
    'Total Deposited Amount',
    'Total Deposit Amount',
    'Deposited Amount',
    'Deposit Amount',
    'Total Deposit',
    'Total Deposited',
  );
  if (exact >= 0) return exact;
  return header.findIndex((key) => {
    if (!key) return false;
    if (key.includes('interest') || key.includes('maturity') || key.includes('rate')) return false;
    if (key.includes('with') || key.includes('date')) return false;
    return key === 'deposit' || key === 'amount' || key === 'deposited';
  });
}

function maturityDateColumnIndex(header: string[]): number {
  const exact = columnIndex(header, 'Maturity Date', 'MaturityDate', 'Date of Maturity', 'Maturity On');
  if (exact >= 0) return exact;
  return header.findIndex((key) => {
    if (!key) return false;
    if (key.includes('amount') || key.includes('interest') || key.includes('rate')) return false;
    return key.includes('maturity') && key.includes('date');
  });
}

function parseDepositCell(raw: unknown): Paise | null {
  const value = excelCellRaw(raw);
  if (value == null || value === '') return null;
  if (typeof value === 'number') return tryParseRupeesToPaise(value);
  return tryParseRupeesToPaise(String(value));
}

export interface DepositInterestParseResult {
  rows: DepositRow[];
  errors: string[];
  skipped: number;
}

/**
 * First worksheet of the HQ template (or a filled export of this page).
 * Required columns: customer name and deposited amount. Extra columns are ignored.
 */
export function parseDepositInterestGrid(grid: unknown[][]): DepositInterestParseResult {
  const result: DepositInterestParseResult = { rows: [], errors: [], skipped: 0 };
  if (grid.length < 2) {
    result.errors.push('The sheet is empty. Use the template: Customer Name, Maturity Date and Total Deposited Amount.');
    return result;
  }

  const header = (grid[0] ?? []).map(headerKey);
  const iName = columnIndex(header, 'Customer Name', 'Customer', 'Name');
  const iAgent = columnIndex(header, 'Agent Name', 'Agent');
  const iDeposit = depositColumnIndex(header);
  const iDate = maturityDateColumnIndex(header);
  if (iName < 0 || iDeposit < 0) {
    result.errors.push('Required columns were not found: Customer Name and Total Deposited Amount.');
    return result;
  }

  for (let index = 1; index < grid.length; index += 1) {
    const line = grid[index] ?? [];
    const name = clean(line[iName]);
    const depositedPaise = parseDepositCell(line[iDeposit]);
    const dateRaw = iDate >= 0 ? line[iDate] : '';
    const dateText = clean(dateRaw);
    const maturityOn = dateText ? parseRegisterDate(dateRaw) : null;
    if (!name && depositedPaise == null && !dateText) {
      result.skipped += 1;
      continue;
    }
    if (!name) {
      result.errors.push(`Row ${index + 1}: customer name is missing.`);
      continue;
    }
    if (depositedPaise == null || depositedPaise <= 0n) {
      result.errors.push(`Row ${index + 1} (${name}): deposited amount is missing or not a valid rupee figure.`);
      continue;
    }
    if (dateText && !maturityOn) {
      result.errors.push(`Row ${index + 1} (${name}): maturity date is not a valid date.`);
    }
    result.rows.push({
      name,
      depositedPaise,
      maturityOn,
      agentName: iAgent >= 0 ? clean(line[iAgent]) || null : null,
    });
  }

  return result;
}

export function formatShare(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  return `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}%`;
}
