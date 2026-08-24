/**
 * payout-engine.ts — MaturityFlow's schedule algorithm.
 *
 * PURE. DETERMINISTIC. BIGINT-ONLY. NO I/O, NO Date.now(), NO RANDOMNESS.
 *
 * The same module runs in the browser (live preview while the user types) and on the server
 * (authoritative schedule persisted at approval). Because it is pure, those two can never
 * disagree — which is the property that lets us show a number to a customer and mean it.
 *
 * Invariants asserted at runtime (not just in tests):
 *   INV-2  Σ(installment.amountPaise) === totalPaise, exactly.
 *   INV-3  installment.amountPaise === cashLegPaise + onlineLegPaise, for every row.
 *   INV-8  every dueDate is a working day.
 *
 * Read docs/03-PAYOUT-ENGINE.md for the derivation and worked examples.
 */

import type { Paise } from './money';
import {
  type ISODate,
  type WorkingDayCalendar,
  collectWorkingDays,
  compareISO,
  daysBetween,
  isWorkingDay,
  nextWorkingDay,
} from './working-days';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Where the marginally-larger days sit within the window. */
export type Distribution = 'FRONT_LOADED' | 'BACK_LOADED' | 'EVEN';

export type CashPolicyKind = 'CASH_ONLY' | 'ONLINE_ONLY' | 'CASH_CAP';

export interface CashPolicy {
  kind: CashPolicyKind;
  /** Required when kind === 'CASH_CAP'. Max cash handed over the counter per day. */
  cashCapPerDayPaise?: Paise;
}

export const DEFAULT_CASH_POLICY: CashPolicy = { kind: 'CASH_ONLY' };

export interface ScheduleInput {
  /** Maturity amount in paise. Must be > 0. */
  totalPaise: Paise;
  /** "Give within N days", counted in working days. Must be >= 1. */
  days: number;
  /** Installments are whole multiples of this. Must be >= 1n. */
  roundingPaise: Paise;
  /** Anchor date — the APPROVAL date. Never the submission date. */
  startDate: ISODate;
  calendar: WorkingDayCalendar;
  distribution?: Distribution;
  cashPolicy?: CashPolicy;
  /** true => first payout is the working day AFTER startDate. Default false (pay from day 0). */
  startOnNextWorkingDay?: boolean;
  /**
   * Working days between consecutive payouts. 1 (default) = every working day.
   * 2 = every other working day, for maturities below the priority threshold.
   */
  stride?: number;
  /**
   * Working days to skip after the anchor before the first payout — the processing days.
   * Default 0, which is the historical behaviour.
   */
  startOffsetWorkingDays?: number;
  /** Bank policy ceiling for the window (default 15) — used only to raise a warning. */
  policyMaxDays?: number;
  /** Branch's per-day cash-in-hand comfort level — used only to raise a warning. */
  branchDailyCashComfortPaise?: Paise;
}

export interface PlannedInstallment {
  /** 1-based. */
  seq: number;
  dueDate: ISODate;
  amountPaise: Paise;
  cashLegPaise: Paise;
  onlineLegPaise: Paise;
  isFinal: boolean;
}

export type ScheduleWarningCode =
  | 'ROUNDING_STEP_EXCEEDS_AMOUNT'
  | 'AMOUNT_TOO_SMALL_FOR_DAYS'
  | 'RESIDUE_ON_FINAL_DAY'
  | 'CASH_CAP_SPLITS_TO_ONLINE'
  | 'CASH_CAP_UNUSED'
  | 'HIGH_DAILY_CASH'
  | 'WINDOW_EXCEEDS_POLICY'
  | 'HOLIDAYS_EXTEND_CALENDAR_SPAN'
  | 'SLA_BREACH_UNAVOIDABLE';

export type WarningSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  severity: WarningSeverity;
  message: string;
}

export interface ScheduleResult {
  installments: PlannedInstallment[];
  totalPaise: Paise;
  /** Days actually used — may be < requested when the amount cannot fill the window. */
  effectiveDays: number;
  requestedDays: number;
  /** The amount most days carry (the modal installment). */
  typicalDailyPaise: Paise;
  smallestDailyPaise: Paise;
  largestDailyPaise: Paise;
  finalInstallmentPaise: Paise;
  totalCashPaise: Paise;
  totalOnlinePaise: Paise;
  firstPayoutDate: ISODate;
  lastPayoutDate: ISODate;
  /** Calendar days from first to last payout inclusive — bigger than effectiveDays when holidays intervene. */
  calendarSpanDays: number;
  roundingPaise: Paise;
  distribution: Distribution;
  warnings: ScheduleWarning[];
}

export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

/** Thrown if the arithmetic ever fails its own invariant. Should be unreachable. */
export class ScheduleIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleIntegrityError';
  }
}

/** Hard ceiling on the payout window, defensive against absurd input. */
export const MAX_SCHEDULE_DAYS = 366;

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Distribute `totalPaise` across `days` working days in whole multiples of `roundingPaise`,
 * with any sub-step residue landing on the final installment.
 */
export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const {
    totalPaise,
    days: requestedDays,
    roundingPaise,
    startDate,
    calendar,
    distribution = 'FRONT_LOADED',
    cashPolicy = DEFAULT_CASH_POLICY,
    startOnNextWorkingDay = false,
    stride = 1,
    startOffsetWorkingDays = 0,
    policyMaxDays = 15,
    branchDailyCashComfortPaise,
  } = input;

  // ── Step 0: preconditions. Throw loudly; never guess with money. ──────────
  if (typeof totalPaise !== 'bigint') {
    throw new ScheduleInputError('totalPaise must be a bigint (paise)');
  }
  if (totalPaise <= 0n) {
    throw new ScheduleInputError('Maturity amount must be greater than zero');
  }
  if (!Number.isInteger(requestedDays) || requestedDays < 1) {
    throw new ScheduleInputError('Number of days must be a whole number of at least 1');
  }
  if (requestedDays > MAX_SCHEDULE_DAYS) {
    throw new ScheduleInputError(`Number of days cannot exceed ${MAX_SCHEDULE_DAYS}`);
  }
  if (typeof roundingPaise !== 'bigint' || roundingPaise < 1n) {
    throw new ScheduleInputError('Rounding step must be a bigint of at least 1 paisa');
  }
  if (!Number.isInteger(stride) || stride < 1) {
    throw new ScheduleInputError('stride must be a whole number of at least 1');
  }
  if (!Number.isInteger(startOffsetWorkingDays) || startOffsetWorkingDays < 0) {
    throw new ScheduleInputError('startOffsetWorkingDays must be a whole number of at least 0');
  }
  if (cashPolicy.kind === 'CASH_CAP') {
    const cap = cashPolicy.cashCapPerDayPaise;
    if (typeof cap !== 'bigint' || cap < 0n) {
      throw new ScheduleInputError('CASH_CAP policy requires a non-negative cashCapPerDayPaise');
    }
  }

  const warnings: ScheduleWarning[] = [];

  // ── Step 1: convert money into rounding units ────────────────────────────
  const units = totalPaise / roundingPaise;
  const residue = totalPaise % roundingPaise;

  // ── Step 2: degrade gracefully if the amount cannot fill the window ───────
  let effectiveDays: number;
  if (units === 0n) {
    effectiveDays = 1;
    warnings.push({
      code: 'ROUNDING_STEP_EXCEEDS_AMOUNT',
      severity: 'WARN',
      message:
        'The maturity amount is smaller than one rounding step, so it will be paid in a single ' +
        'instalment. Lower the rounding step to spread it across days.',
    });
  } else if (units < BigInt(requestedDays)) {
    effectiveDays = Number(units);
    warnings.push({
      code: 'AMOUNT_TOO_SMALL_FOR_DAYS',
      severity: 'WARN',
      message:
        `At this rounding step the amount only fills ${effectiveDays} day` +
        `${effectiveDays === 1 ? '' : 's'}, not ${requestedDays}. ` +
        'Lower the rounding step to spread it across the full window.',
    });
  } else {
    effectiveDays = requestedDays;
  }

  // ── Step 3: split the units ──────────────────────────────────────────────
  const n = BigInt(effectiveDays);
  const q = units / n; // base units for every day
  const r = Number(units % n); // exactly r days get one extra unit

  const base = q * roundingPaise;
  const bumped = base + roundingPaise;

  // ── Step 4: choose which days carry the extra unit ───────────────────────
  const amounts: Paise[] = new Array(effectiveDays);
  for (let i = 0; i < effectiveDays; i++) {
    amounts[i] = getsExtraUnit(i, r, effectiveDays, distribution) ? bumped : base;
  }

  // ── Step 5: re-attach the sub-step residue to the final instalment ───────
  if (residue > 0n) {
    amounts[effectiveDays - 1] += residue;
    warnings.push({
      code: 'RESIDUE_ON_FINAL_DAY',
      severity: 'INFO',
      message:
        'The amount is not an exact multiple of the rounding step; the remaining balance is ' +
        'added to the final instalment.',
    });
  }

  // ── Step 6: assert INV-2 before anything else can consume this ───────────
  let sum = 0n;
  for (const a of amounts) sum += a;
  if (sum !== totalPaise) {
    throw new ScheduleIntegrityError(
      `Schedule does not sum to the maturity amount: expected ${totalPaise}, got ${sum}. ` +
        `(total=${totalPaise} days=${effectiveDays} step=${roundingPaise})`,
    );
  }
  for (let i = 0; i < amounts.length; i++) {
    if (amounts[i] <= 0n) {
      throw new ScheduleIntegrityError(`Instalment ${i + 1} is not positive (${amounts[i]})`);
    }
  }

  // ── Step 7: assign working-day dates ─────────────────────────────────────
  // The anchor is the approval day. The processing days sit between it and the first payout, so
  // the payout window opens `startOffsetWorkingDays` working days later. `stride` then decides
  // whether payouts land on every working day or every other one. Neither affects a single rupee
  // computed above — this step only decides which dates the amounts are stamped onto.
  const anchor = startOnNextWorkingDay
    ? nextWorkingDay(addOneDay(startDate), calendar)
    : nextWorkingDay(startDate, calendar);
  const payoutAnchor =
    startOffsetWorkingDays > 0
      ? collectWorkingDays(anchor, startOffsetWorkingDays + 1, calendar)[startOffsetWorkingDays]
      : anchor;
  const dates = collectWorkingDays(payoutAnchor, effectiveDays, calendar, stride);

  // ── Step 8: split each instalment into cash and online legs ──────────────
  const installments: PlannedInstallment[] = [];
  let totalCash = 0n;
  let totalOnline = 0n;
  let anySplit = false;
  let capNeverBinds = cashPolicy.kind === 'CASH_CAP';

  for (let i = 0; i < effectiveDays; i++) {
    const amount = amounts[i];
    const { cash, online } = splitLegs(amount, cashPolicy);

    if (cash + online !== amount) {
      throw new ScheduleIntegrityError(
        `Leg split broken on instalment ${i + 1}: ${cash} + ${online} !== ${amount}`,
      );
    }
    if (!isWorkingDay(dates[i], calendar)) {
      throw new ScheduleIntegrityError(`Instalment ${i + 1} landed on a non-working day (${dates[i]})`);
    }

    if (online > 0n && cash > 0n) anySplit = true;
    if (cashPolicy.kind === 'CASH_CAP' && online > 0n) capNeverBinds = false;

    totalCash += cash;
    totalOnline += online;
    installments.push({
      seq: i + 1,
      dueDate: dates[i],
      amountPaise: amount,
      cashLegPaise: cash,
      onlineLegPaise: online,
      isFinal: i === effectiveDays - 1,
    });
  }

  if (totalCash + totalOnline !== totalPaise) {
    throw new ScheduleIntegrityError(
      `Leg totals do not reconcile: ${totalCash} + ${totalOnline} !== ${totalPaise}`,
    );
  }

  // ── Advisory warnings ────────────────────────────────────────────────────
  if (anySplit) {
    warnings.push({
      code: 'CASH_CAP_SPLITS_TO_ONLINE',
      severity: 'INFO',
      message:
        'Daily amounts exceed the cash cap, so the balance of each day is scheduled as an ' +
        'online transfer.',
    });
  }
  if (capNeverBinds && cashPolicy.kind === 'CASH_CAP') {
    warnings.push({
      code: 'CASH_CAP_UNUSED',
      severity: 'INFO',
      message: 'Every daily amount is below the cash cap, so the whole maturity is payable in cash.',
    });
  }
  if (requestedDays > policyMaxDays) {
    warnings.push({
      code: 'WINDOW_EXCEEDS_POLICY',
      severity: 'WARN',
      message: `The window of ${requestedDays} days exceeds the bank's ${policyMaxDays}-day commitment.`,
    });
  }

  const largest = maxOf(amounts);
  const smallest = minOf(amounts);

  if (branchDailyCashComfortPaise !== undefined && branchDailyCashComfortPaise > 0n) {
    const maxCashDay = installments.reduce((m, i) => (i.cashLegPaise > m ? i.cashLegPaise : m), 0n);
    if (maxCashDay > branchDailyCashComfortPaise) {
      warnings.push({
        code: 'HIGH_DAILY_CASH',
        severity: 'WARN',
        message:
          'The daily cash requirement is above what this branch normally holds. Either raise the ' +
          'cash opening, widen the window, or move part of the payout online.',
      });
    }
  }

  const firstPayoutDate = installments[0].dueDate;
  const lastPayoutDate = installments[installments.length - 1].dueDate;
  const calendarSpanDays = daysBetween(firstPayoutDate, lastPayoutDate) + 1;

  if (calendarSpanDays > effectiveDays) {
    warnings.push({
      code: 'HOLIDAYS_EXTEND_CALENDAR_SPAN',
      severity: 'INFO',
      message:
        `${effectiveDays} working days span ${calendarSpanDays} calendar days because of ` +
        'weekly-offs and holidays. The final payout lands on ' +
        `${lastPayoutDate}.`,
    });
  }

  return {
    installments,
    totalPaise,
    effectiveDays,
    requestedDays,
    typicalDailyPaise: r >= effectiveDays - r ? bumped : base,
    smallestDailyPaise: smallest,
    largestDailyPaise: largest,
    finalInstallmentPaise: amounts[effectiveDays - 1],
    totalCashPaise: totalCash,
    totalOnlinePaise: totalOnline,
    firstPayoutDate,
    lastPayoutDate,
    calendarSpanDays,
    roundingPaise,
    distribution,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rescheduling — reality vs plan
// ─────────────────────────────────────────────────────────────────────────────

export interface RescheduleInput {
  /** What is still owed to the customer. */
  remainingPaise: Paise;
  /** First date the remainder can be paid on (usually today or tomorrow). */
  fromDate: ISODate;
  /** The date the bank originally promised completion by. */
  deadlineDate: ISODate;
  roundingPaise: Paise;
  calendar: WorkingDayCalendar;
  distribution?: Distribution;
  cashPolicy?: CashPolicy;
  branchDailyCashComfortPaise?: Paise;
}

export interface RescheduleResult extends ScheduleResult {
  /** Working days still available before the promised deadline. */
  availableDays: number;
  /** true when the remainder cannot be completed by the deadline at this cash policy. */
  slaBreachUnavoidable: boolean;
}

/**
 * Re-plan only what is left, over only the working days that are left.
 * History is never rewritten — already-paid instalments stay exactly as they were.
 */
export function rescheduleRemaining(input: RescheduleInput): RescheduleResult {
  const {
    remainingPaise,
    fromDate,
    deadlineDate,
    roundingPaise,
    calendar,
    distribution = 'FRONT_LOADED',
    cashPolicy = DEFAULT_CASH_POLICY,
    branchDailyCashComfortPaise,
  } = input;

  if (remainingPaise <= 0n) {
    throw new ScheduleInputError('Nothing remaining to reschedule');
  }

  const start = nextWorkingDay(fromDate, calendar);
  let availableDays = 0;
  if (compareISO(start, deadlineDate) <= 0) {
    let d = start;
    while (compareISO(d, deadlineDate) <= 0 && availableDays < MAX_SCHEDULE_DAYS) {
      if (isWorkingDay(d, calendar)) availableDays++;
      d = addOneDay(d);
    }
  }

  const slaBreachUnavoidable = availableDays < 1;
  const days = Math.max(1, availableDays);

  const result = generateSchedule({
    totalPaise: remainingPaise,
    days,
    roundingPaise,
    startDate: start,
    calendar,
    distribution,
    cashPolicy,
    policyMaxDays: days,
    branchDailyCashComfortPaise,
  });

  if (slaBreachUnavoidable) {
    result.warnings.unshift({
      code: 'SLA_BREACH_UNAVOIDABLE',
      severity: 'CRITICAL',
      message:
        'The promised completion date has passed or has no working days left. This case will ' +
        'breach its commitment — escalate now rather than at the counter.',
    });
  } else if (compareISO(result.lastPayoutDate, deadlineDate) > 0) {
    result.warnings.unshift({
      code: 'SLA_BREACH_UNAVOIDABLE',
      severity: 'CRITICAL',
      message: `The remaining amount cannot be cleared by ${deadlineDate} on this plan.`,
    });
  }

  return { ...result, availableDays, slaBreachUnavoidable };
}

/** The date by which the whole maturity was promised, given the approval date and window. */
export function deriveDeadline(
  approvalDate: ISODate,
  days: number,
  calendar: WorkingDayCalendar,
  startOnNextWorkingDay = false,
): ISODate {
  const anchor = startOnNextWorkingDay
    ? nextWorkingDay(addOneDay(approvalDate), calendar)
    : nextWorkingDay(approvalDate, calendar);
  const dates = collectWorkingDays(anchor, Math.max(1, days), calendar);
  return dates[dates.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/** Bresenham-style even spread — used so `EVEN` puts the heavy days as far apart as possible. */
function getsExtraUnit(index: number, r: number, n: number, mode: Distribution): boolean {
  if (r <= 0) return false;
  switch (mode) {
    case 'FRONT_LOADED':
      return index < r;
    case 'BACK_LOADED':
      return index >= n - r;
    case 'EVEN':
      return Math.floor(((index + 1) * r) / n) > Math.floor((index * r) / n);
  }
}

function splitLegs(amount: Paise, policy: CashPolicy): { cash: Paise; online: Paise } {
  switch (policy.kind) {
    case 'CASH_ONLY':
      return { cash: amount, online: 0n };
    case 'ONLINE_ONLY':
      return { cash: 0n, online: amount };
    case 'CASH_CAP': {
      const cap = policy.cashCapPerDayPaise ?? 0n;
      const cash = amount < cap ? amount : cap;
      return { cash, online: amount - cash };
    }
  }
}

function maxOf(xs: readonly Paise[]): Paise {
  let m = xs[0];
  for (const x of xs) if (x > m) m = x;
  return m;
}
function minOf(xs: readonly Paise[]): Paise {
  let m = xs[0];
  for (const x of xs) if (x < m) m = x;
  return m;
}

function addOneDay(d: ISODate): ISODate {
  const dt = new Date(`${d}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10) as ISODate;
}
