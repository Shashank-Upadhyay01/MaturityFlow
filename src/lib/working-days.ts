/**
 * working-days.ts — the bank's payout calendar.
 *
 * "Give within 15 days" means 15 days on which the branch counter can actually pay.
 * INV-8: no installment is ever dated on a non-working day.
 *
 * All date arithmetic is done in UTC on 'YYYY-MM-DD' strings so that a server in one
 * timezone and a browser in another can never disagree about which day it is.
 */

export type ISODate = string; // strictly 'YYYY-MM-DD'

export type SaturdayRule =
  /** Every Saturday is a working day. */
  | 'NONE'
  /** Every Saturday is off. */
  | 'ALL'
  /** Indian banking norm: 2nd and 4th Saturday of each month are off. */
  | 'SECOND_FOURTH';

export interface WeekendPolicy {
  sundaysOff: boolean;
  saturdayRule: SaturdayRule;
  /**
   * Days at the START of every month that carry no withdrawals.
   *
   * The counter is closed for the month-open reconciliation, so payouts resume on the 4th.
   * 0 switches the rule off. An admin can re-open a single month — see `monthsOpenAtStart`.
   */
  monthStartBlockedDays: number;
}

export interface WorkingDayCalendar {
  weekend: WeekendPolicy;
  /** Set of 'YYYY-MM-DD' declared holidays. */
  holidays: ReadonlySet<ISODate>;
  /**
   * 'YYYY-MM' months where the admin has opened the blocked first days.
   *
   * An exception only lifts the month-start rule — a Sunday or a declared holiday inside those
   * days stays closed, because opening the counter cannot conjure staff onto a weekend.
   */
  monthsOpenAtStart: ReadonlySet<string>;
}

export const DEFAULT_MONTH_START_BLOCKED_DAYS = 3;

export const DEFAULT_WEEKEND_POLICY: WeekendPolicy = {
  sundaysOff: true,
  saturdayRule: 'SECOND_FOURTH',
  monthStartBlockedDays: DEFAULT_MONTH_START_BLOCKED_DAYS,
};

export function makeCalendar(
  holidays: Iterable<ISODate> = [],
  weekend: Partial<WeekendPolicy> = DEFAULT_WEEKEND_POLICY,
  monthsOpenAtStart: Iterable<string> = [],
): WorkingDayCalendar {
  return {
    // Partial so a caller that predates the month-start rule still gets the default of 3 rather
    // than silently getting 0 and re-opening every month.
    weekend: { ...DEFAULT_WEEKEND_POLICY, ...weekend },
    holidays: new Set(holidays),
    monthsOpenAtStart: new Set(monthsOpenAtStart),
  };
}

/** The 'YYYY-MM' a date belongs to. */
export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

/** Inside the month-open cooldown, and not opened by an admin exception. */
export function isMonthStartBlocked(d: ISODate, cal: WorkingDayCalendar): boolean {
  const n = cal.weekend.monthStartBlockedDays;
  if (!Number.isFinite(n) || n <= 0) return false;
  if (cal.monthsOpenAtStart.has(monthKey(d))) return false;
  return Number(d.slice(8, 10)) <= n;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

/** 'YYYY-MM-DD' -> epoch-day-based UTC Date. Throws on anything else. */
export function parseISODate(d: ISODate): Date {
  if (!ISO_RE.test(d)) throw new CalendarError(`Invalid ISO date: "${d}" (expected YYYY-MM-DD)`);
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== day
  ) {
    throw new CalendarError(`Invalid calendar date: "${d}"`);
  }
  return dt;
}

export function toISODate(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = parseISODate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const MS = 86_400_000;
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / MS);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1 = first Saturday of the month, 2 = second, ... */
export function saturdayOrdinal(d: ISODate): number {
  const dt = parseISODate(d);
  if (dt.getUTCDay() !== 6) return 0;
  return Math.floor((dt.getUTCDate() - 1) / 7) + 1;
}

export function isWeekendOff(d: ISODate, weekend: WeekendPolicy): boolean {
  const dow = parseISODate(d).getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow === 0) return weekend.sundaysOff;
  if (dow === 6) {
    switch (weekend.saturdayRule) {
      case 'ALL':
        return true;
      case 'NONE':
        return false;
      case 'SECOND_FOURTH': {
        const ord = saturdayOrdinal(d);
        return ord === 2 || ord === 4;
      }
    }
  }
  return false;
}

export function isWorkingDay(d: ISODate, cal: WorkingDayCalendar): boolean {
  if (cal.holidays.has(d)) return false;
  if (isMonthStartBlocked(d, cal)) return false;
  return !isWeekendOff(d, cal.weekend);
}

export function whyNotWorking(
  d: ISODate,
  cal: WorkingDayCalendar,
): 'HOLIDAY' | 'SUNDAY' | 'SATURDAY' | 'MONTH_START' | null {
  if (cal.holidays.has(d)) return 'HOLIDAY';
  // Weekend before month-start: a Sunday is closed for the older, more obvious reason, and
  // telling a clerk "month start" about a Sunday would just be confusing.
  const dow = parseISODate(d).getUTCDay();
  if (dow === 0 && cal.weekend.sundaysOff) return 'SUNDAY';
  if (dow === 6 && isWeekendOff(d, cal.weekend)) return 'SATURDAY';
  if (isMonthStartBlocked(d, cal)) return 'MONTH_START';
  return null;
}

/** Guard so a pathological holiday set can never hang the server. */
const MAX_SCAN_DAYS = 3650;

/** The given date if it is a working day, else the next one that is. */
export function nextWorkingDay(from: ISODate, cal: WorkingDayCalendar): ISODate {
  let d = from;
  for (let i = 0; i <= MAX_SCAN_DAYS; i++) {
    if (isWorkingDay(d, cal)) return d;
    d = addDays(d, 1);
  }
  throw new CalendarError(
    `No working day found within ${MAX_SCAN_DAYS} days of ${from} — check the holiday calendar.`,
  );
}

/** Strictly after `from`. */
export function nextWorkingDayAfter(from: ISODate, cal: WorkingDayCalendar): ISODate {
  return nextWorkingDay(addDays(from, 1), cal);
}

/**
 * Collect exactly `count` working days starting at (or after) `start`.
 * This is what turns "15 days" into 15 real, payable dates.
 */
/**
 * Collect `count` working days starting at `start`.
 *
 * `stride` is how many working days apart the collected days sit: 1 takes every working day,
 * 2 takes every other one (used by sub-₹1-lakh maturities, which pay on alternate days).
 * Non-working days are skipped before the stride is applied, so "alternate" means alternate
 * *working* days — a Friday payout is followed by a Tuesday one, not a Sunday.
 */
export function collectWorkingDays(
  start: ISODate,
  count: number,
  cal: WorkingDayCalendar,
  stride = 1,
): ISODate[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new CalendarError(`count must be a non-negative integer, got ${count}`);
  }
  if (!Number.isInteger(stride) || stride < 1) {
    throw new CalendarError(`stride must be a positive integer, got ${stride}`);
  }
  const out: ISODate[] = [];
  let d = start;
  let scanned = 0;
  let workingIndex = 0;
  while (out.length < count) {
    if (scanned++ > MAX_SCAN_DAYS) {
      throw new CalendarError(
        `Could not collect ${count} working days from ${start} — check the holiday calendar.`,
      );
    }
    if (isWorkingDay(d, cal)) {
      if (workingIndex % stride === 0) out.push(d);
      workingIndex++;
    }
    d = addDays(d, 1);
  }
  return out;
}

/** Inclusive of both ends. */
export function countWorkingDaysBetween(
  from: ISODate,
  to: ISODate,
  cal: WorkingDayCalendar,
): number {
  if (compareISO(from, to) > 0) return 0;
  let n = 0;
  let d = from;
  let scanned = 0;
  while (compareISO(d, to) <= 0) {
    if (scanned++ > MAX_SCAN_DAYS) throw new CalendarError('Range too large');
    if (isWorkingDay(d, cal)) n++;
    d = addDays(d, 1);
  }
  return n;
}

/** Today in the bank's local timezone, as an ISO date. */
export function todayISO(timeZone = 'Asia/Kolkata'): ISODate {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date()) as ISODate;
}

/** A Date (from the DB) rendered as the bank's local calendar date. */
export function dateToISO(d: Date, timeZone = 'Asia/Kolkata'): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d) as ISODate;
}

/** ISO date -> a UTC-midnight Date suitable for a Postgres `date`/`timestamp` column. */
export function isoToDate(d: ISODate): Date {
  return parseISODate(d);
}

const DISPLAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const DISPLAY_SHORT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
});
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short' });

/** '18 Aug 2026' */
export function formatISODate(d: ISODate): string {
  return DISPLAY.format(parseISODate(d));
}

/**
 * Coerce a pg Date, an ISO datetime, or 'YYYY-MM-DD' into a calendar 'YYYY-MM-DD'
 * in Asia/Kolkata. DATE values must never travel as JS Date objects — IST midnight
 * is the previous UTC day, so toISOString() would show 28/06 instead of 29/06.
 */
export function toISODateString(value: unknown): ISODate | null {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return istCalendarISO(value);
  }
  const s = String(value).trim();
  if (ISO_RE.test(s)) return s as ISODate;
  const stamped = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (stamped) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return istCalendarISO(d);
    return `${stamped[1]}-${stamped[2]}-${stamped[3]}` as ISODate;
  }
  return null;
}

function istCalendarISO(d: Date): ISODate {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}` as ISODate;
}

/** '19/08/2026' — always dd/mm/yyyy with leading zeros. */
export function formatDMY(d: ISODate | string): string {
  const iso = toISODateString(d) ?? String(d).slice(0, 10);
  const [y, m, day] = iso.split('-');
  if (!y || !m || !day) return '';
  return `${day.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}
/** '18 Aug' */
export function formatISODateShort(d: ISODate): string {
  return DISPLAY_SHORT.format(parseISODate(d));
}
/** 'Tue' */
export function weekdayShort(d: ISODate): string {
  return WEEKDAY.format(parseISODate(d));
}

/**
 * Fixed national bank holidays that recur on the same date every year (MM-DD).
 * Everything else (Diwali, Holi, Eid, state holidays…) is entered by an admin
 * in Settings → Holidays, because those dates move every year.
 */
export const FIXED_NATIONAL_HOLIDAYS_MMDD = ['01-26', '05-01', '08-15', '10-02', '12-25'] as const;

export function fixedHolidaysForYear(year: number): ISODate[] {
  return FIXED_NATIONAL_HOLIDAYS_MMDD.map((mmdd) => `${year}-${mmdd}` as ISODate);
}
