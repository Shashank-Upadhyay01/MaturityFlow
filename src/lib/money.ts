/**
 * money.ts — exact monetary arithmetic for MaturityFlow.
 *
 * INV-1: every rupee value in this system is an integer number of PAISE held in a `bigint`.
 * Floating point is never used for money. Not in the DB, not in the engine, not in the UI.
 *
 * ₹1 = 100 paise.  ₹5,00,000 => 50_000_000n
 */

export type Paise = bigint;

export class MoneyError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMPTY'
      | 'MALFORMED'
      | 'NOT_FINITE'
      | 'TOO_LARGE'
      | 'NEGATIVE_NOT_ALLOWED',
  ) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** ₹1,00,00,00,00,000 (₹1000 crore) — a hard sanity ceiling for a single record. */
export const MAX_PAISE: Paise = 100_000_000_000_000n;

const STRICT_DECIMAL = /^-?\d{1,15}(?:\.\d{1,2})?$/;

/**
 * Parse a human-entered rupee value into exact paise.
 *
 * Accepts: "500000", "5,00,000", "₹5,00,000.50", " 500000.5 ", 500000.5
 * Rejects: "", "abc", "1e5", "1.234", "--5", "1,00,000.999"
 *
 * String parsing is done digit-by-digit — the value never passes through a float.
 */
export function parseRupeesToPaise(
  input: string | number,
  opts: { allowNegative?: boolean } = {},
): Paise {
  let raw: string;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new MoneyError('Amount is not a finite number', 'NOT_FINITE');
    }
    if (Math.abs(input) > Number.MAX_SAFE_INTEGER / 100) {
      throw new MoneyError('Amount exceeds safe numeric range', 'TOO_LARGE');
    }
    // toFixed(2) is exact for |value| < 2^53/100, which the guard above assures.
    raw = input.toFixed(2);
  } else {
    raw = input;
  }

  let s = raw.trim().replace(/[₹\s,_]/g, '');
  if (s === '') throw new MoneyError('Amount is empty', 'EMPTY');
  if (s.startsWith('.')) s = `0${s}`;
  if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (s === '' || s === '-') throw new MoneyError('Amount is empty', 'EMPTY');

  if (!STRICT_DECIMAL.test(s)) {
    throw new MoneyError(
      `"${raw}" is not a valid rupee amount (max 2 decimal places, digits only)`,
      'MALFORMED',
    );
  }

  const negative = s.startsWith('-');
  if (negative && !opts.allowNegative) {
    throw new MoneyError('Amount cannot be negative', 'NEGATIVE_NOT_ALLOWED');
  }
  if (negative) s = s.slice(1);

  const [whole, frac = ''] = s.split('.');
  const paiseFrac = (frac + '00').slice(0, 2);
  const value = BigInt(whole) * 100n + BigInt(paiseFrac);

  if (value > MAX_PAISE) {
    throw new MoneyError('Amount exceeds the ₹1000 crore per-record ceiling', 'TOO_LARGE');
  }
  return negative ? -value : value;
}

/** Safe variant — returns null instead of throwing. Use for live-typing inputs. */
export function tryParseRupeesToPaise(
  input: string | number,
  opts?: { allowNegative?: boolean },
): Paise | null {
  try {
    return parseRupeesToPaise(input, opts);
  } catch {
    return null;
  }
}

/** Rupees as a plain decimal string, no symbol, no grouping. "50000050" -> "500000.50" */
export function paiseToDecimalString(p: Paise): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}${whole}.${frac.toString().padStart(2, '0')}`;
}

const IN_GROUPER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Indian-format a paise value.
 * formatPaise(50000000n)                     -> "₹5,00,000.00"
 * formatPaise(50000000n, { decimals: false })-> "₹5,00,000"
 * formatPaise(50000000n, { symbol: false })  -> "5,00,000.00"
 */
export function formatPaise(
  p: Paise,
  opts: { decimals?: boolean; symbol?: boolean } = {},
): string {
  const { decimals = true, symbol = true } = opts;
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const whole = abs / 100n;
  const frac = abs % 100n;

  // Round to whole rupees for display when decimals are suppressed.
  const displayWhole = decimals ? whole : whole + (frac >= 50n ? 1n : 0n);
  let out = IN_GROUPER.format(displayWhole);
  if (decimals) out += `.${frac.toString().padStart(2, '0')}`;

  return `${neg ? '-' : ''}${symbol ? '₹' : ''}${out}`;
}

/** "₹5.00 L", "₹1.25 Cr", "₹45,000" — for dashboard tiles where space is tight. */
export function formatCompactPaise(p: Paise, opts: { symbol?: boolean } = {}): string {
  const { symbol = true } = opts;
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = abs / 100n;
  const sign = neg ? '-' : '';
  const sym = symbol ? '₹' : '';

  const scaled = (divisor: bigint, suffix: string) => {
    // two decimal places without floats: value * 100 / divisor
    const hundredths = (rupees * 100n) / divisor;
    const w = hundredths / 100n;
    const f = hundredths % 100n;
    return `${sign}${sym}${IN_GROUPER.format(w)}.${f.toString().padStart(2, '0')} ${suffix}`;
  };

  if (rupees >= 10_000_000n) return scaled(10_000_000n, 'Cr');
  if (rupees >= 100_000n) return scaled(100_000n, 'L');
  if (rupees >= 1_000n) return `${sign}${sym}${IN_GROUPER.format(rupees)}`;
  return `${sign}${sym}${IN_GROUPER.format(rupees)}`;
}

/** For charts only — never feed this back into a calculation. */
export function paiseToRupeeNumber(p: Paise): number {
  return Number(p) / 100;
}

export function rupees(n: number | string): Paise {
  return parseRupeesToPaise(n);
}

export function sumPaise(values: readonly Paise[]): Paise {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export function maxPaise(a: Paise, b: Paise): Paise {
  return a > b ? a : b;
}
export function minPaise(a: Paise, b: Paise): Paise {
  return a < b ? a : b;
}
export function absPaise(a: Paise): Paise {
  return a < 0n ? -a : a;
}
export function clampPaise(v: Paise, lo: Paise, hi: Paise): Paise {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Integer percentage (0–10000 basis points) of `part` within `whole`, floor-rounded. */
export function percentBps(part: Paise, whole: Paise): number {
  if (whole === 0n) return 0;
  return Number((part * 10_000n) / whole);
}

/** 0–100 with one decimal, for progress bars. */
export function percentOf(part: Paise, whole: Paise): number {
  return percentBps(part, whole) / 100;
}

/** Common rounding steps offered in the UI, in paise. */
export const ROUNDING_STEPS = [
  { label: '₹100', paise: 10_000n },
  { label: '₹500', paise: 50_000n },
  { label: '₹1,000', paise: 100_000n },
  { label: '₹5,000', paise: 500_000n },
  { label: '₹10,000', paise: 1_000_000n },
  { label: '₹50,000', paise: 5_000_000n },
] as const;

export const DEFAULT_ROUNDING_PAISE: Paise = 100_000n; // ₹1,000
