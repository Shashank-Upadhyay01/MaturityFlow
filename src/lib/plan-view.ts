/**
 * plan-view.ts — the Register's planning board.
 *
 * Answers "what does this customer get, and on which day" for every open case, including the
 * ones nobody has approved yet. That last part is why this exists at all: most of the register
 * has no `payout_instalments` rows, so a board that only read the database would be empty
 * exactly when the branch most needs to plan.
 *
 * Where a real schedule exists it is shown as fact. Where it does not, the same pure engine the
 * server will run at approval is used to project one, and the row is marked `isProjection` so the
 * screen can say so rather than implying a promise that has not been made.
 *
 * Pure, bigint paise only, no I/O and no clock — `today` is passed in.
 */

import {
  ScheduleInputError,
  ScheduleIntegrityError,
  generateSchedule,
  type Distribution,
} from './payout-engine';
import {
  PROCESSING_WORKING_DAYS,
  isPriorityCase,
  payoutPlanFor,
  strideFor,
  type Cadence,
} from './payout-policy';
import { legsAfterPayment } from './register-view';
import type { WorkingDayCalendar } from './working-days';

/** A case as the board receives it — money already serialised to strings. */
export interface PlanCase {
  caseId: string;
  branchId: string;
  caseNumber: string;
  customerName: string;
  accountNumber: string | null;
  phone: string | null;
  agentName: string;
  status: string;
  maturityAmountPaise: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  windowDays: number;
  roundingPaise: string;
  distribution: string;
  cadence: string;
  cashPolicy: string;
  cashCapPerDayPaise: string | null;
  startOnNextWorkingDay: boolean;
  approvedOn: string | null;
  deadlineOn: string | null;
}

export interface PlanInstalment {
  caseId: string;
  seq: number;
  dueOn: string;
  amountPaise: string;
  cashLegPaise?: string;
  onlineLegPaise?: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  status: string;
}

/** Which column a case belongs in. The ₹1 lakh line is the policy's, not a literal repeated here. */
export type PlanBand = 'LARGE' | 'SMALL';

export function bandOf(maturityAmountPaise: bigint): PlanBand {
  return isPriorityCase(maturityAmountPaise) ? 'LARGE' : 'SMALL';
}

export type DayState = 'PAID' | 'PARTIAL' | 'DUE_TODAY' | 'OVERDUE' | 'UPCOMING';

export interface PlanDay {
  seq: number;
  dueOn: string;
  amountPaise: bigint;
  paidPaise: bigint;
  /** Cash actually given on this day. */
  givenCashPaise: bigint;
  /** Online / by-account actually given on this day. */
  givenOnlinePaise: bigint;
  /** Remaining physical-cash leg for this day. */
  cashPaise: bigint;
  /** Remaining online leg for this day. */
  onlinePaise: bigint;
  state: DayState;
}

export interface PlanRow {
  caseId: string;
  caseNumber: string;
  customerName: string;
  accountNumber: string | null;
  phone: string | null;
  agentName: string;
  status: string;
  band: PlanBand;
  cadence: Cadence;
  maturityPaise: bigint;
  givenPaise: bigint;
  remainingPaise: bigint;
  /** How many days the amount is split across. */
  parts: number;
  /** What each remaining day should carry: remaining ÷ the days still to come. */
  perDayPaise: bigint;
  days: PlanDay[];
  /** Today's share, 0 when nothing falls due today. */
  dueTodayPaise: bigint;
  /** true when the days are computed rather than promised. */
  isProjection: boolean;
  approvedOn: string | null;
  deadlineOn: string | null;
  /** Set when no schedule could be built — the row still lists, with the reason. */
  error: string | null;
}

const big = (v: string | null | undefined): bigint => (v == null || v === '' ? 0n : BigInt(v));

/** The default number of parts for an amount: 12 for a large case, 6 for a small one. */
export function defaultPartsFor(maturityAmountPaise: bigint, windowDays: number): number {
  return payoutPlanFor(maturityAmountPaise, windowDays).payoutDays;
}

function stateOf(dueOn: string, amount: bigint, paid: bigint, today: string): DayState {
  if (amount > 0n && paid >= amount) return 'PAID';
  if (paid > 0n) return 'PARTIAL';
  if (dueOn === today) return 'DUE_TODAY';
  if (dueOn < today) return 'OVERDUE';
  return 'UPCOMING';
}

function remainingLegs(
  amount: bigint,
  givenCash: bigint,
  givenOnline: bigint,
  plannedCash: bigint,
  plannedOnline: bigint,
): { cashPaise: bigint; onlinePaise: bigint } {
  const paid = givenCash + givenOnline;
  const leftover = amount > paid ? amount - paid : 0n;
  if (leftover === 0n) return { cashPaise: 0n, onlinePaise: 0n };
  if (paid === 0n) return { cashPaise: plannedCash, onlinePaise: plannedOnline };
  const aligned = legsAfterPayment(amount, givenCash, givenOnline);
  const remainCash = aligned.cashPaise > givenCash ? aligned.cashPaise - givenCash : 0n;
  return { cashPaise: remainCash, onlinePaise: leftover - remainCash };
}

function dayFromStored(i: PlanInstalment, today: string): PlanDay {
  const amount = big(i.amountPaise);
  const givenCash = big(i.paidCashPaise);
  const givenOnline = big(i.paidOnlinePaise);
  const paid = givenCash + givenOnline;
  const plannedCash = big(i.cashLegPaise ?? i.amountPaise);
  const plannedOnline = big(i.onlineLegPaise);
  const remain = remainingLegs(amount, givenCash, givenOnline, plannedCash, plannedOnline);
  return {
    seq: i.seq,
    dueOn: i.dueOn,
    amountPaise: amount,
    paidPaise: paid,
    givenCashPaise: givenCash,
    givenOnlinePaise: givenOnline,
    cashPaise: remain.cashPaise,
    onlinePaise: remain.onlinePaise,
    state: stateOf(i.dueOn, amount, paid, today),
  };
}

/**
 * Build one customer's plan.
 *
 * `customParts` overrides how many days the money is split across. Supplying it always produces a
 * projection, even for an approved case: changing the number of days on a live schedule is a
 * reschedule, and this board is where you look before deciding to do one — not the place it
 * silently happens.
 */
export function buildPlanRow(
  c: PlanCase,
  instalments: readonly PlanInstalment[],
  cal: WorkingDayCalendar,
  today: string,
  customParts?: number,
): PlanRow {
  const maturityPaise = big(c.maturityAmountPaise);
  const givenPaise = big(c.paidCashPaise) + big(c.paidOnlinePaise);
  const remainingPaise = maturityPaise > givenPaise ? maturityPaise - givenPaise : 0n;
  const band = bandOf(maturityPaise);
  const cadence: Cadence = c.cadence === 'ALTERNATE' || band === 'SMALL' ? 'ALTERNATE' : 'DAILY';

  const base = {
    caseId: c.caseId,
    caseNumber: c.caseNumber,
    customerName: c.customerName,
    accountNumber: c.accountNumber,
    phone: c.phone,
    agentName: c.agentName,
    status: c.status,
    band,
    cadence,
    maturityPaise,
    givenPaise,
    remainingPaise,
    approvedOn: c.approvedOn,
    deadlineOn: c.deadlineOn,
  };

  const finish = (days: PlanDay[], isProjection: boolean, error: string | null): PlanRow => {
    // Recommendation means what may actually be withdrawn TODAY. Averaging the full remaining
    // balance across open rows diverges from a rounded schedule (₹88,000 became ₹88,073) and
    // incorrectly recommends money on alternate off-days.
    const todayDay = days.find((d) => d.dueOn === today);
    const dueTodayPaise = todayDay
      ? todayDay.amountPaise > todayDay.paidPaise
        ? todayDay.amountPaise - todayDay.paidPaise
        : 0n
      : 0n;
    return {
      ...base,
      parts: days.length,
      perDayPaise: dueTodayPaise,
      days,
      dueTodayPaise,
      isProjection,
      error,
    };
  };

  // ── the real schedule, when there is one and nobody is asking "what if" ──
  const real = instalments.filter((i) => i.caseId === c.caseId).sort((a, b) => a.seq - b.seq);

  if (customParts == null && real.length > 0) {
    return finish(
      real.map((i) => dayFromStored(i, today)),
      false,
      null,
    );
  }

  // ── otherwise project it ────────────────────────────────────────────────
  if (maturityPaise <= 0n) {
    return finish([], true, 'No maturity amount on this row yet.');
  }

  const parts = customParts ?? defaultPartsFor(maturityPaise, c.windowDays);
  if (!Number.isInteger(parts) || parts < 1) {
    return finish([], true, 'Number of parts must be a whole number of at least 1.');
  }

  try {
    const res = generateSchedule({
      totalPaise: maturityPaise,
      days: parts,
      roundingPaise: big(c.roundingPaise) || 1n,
      // An unapproved case is projected from today: "if this were approved now". An approved one
      // keeps its real anchor so the dates match what was promised.
      startDate: c.approvedOn ?? today,
      calendar: cal,
      distribution: (c.distribution as Distribution) ?? 'FRONT_LOADED',
      cashPolicy:
        c.cashPolicy === 'CASH_CAP'
          ? { kind: 'CASH_CAP', cashCapPerDayPaise: big(c.cashCapPerDayPaise) }
          : { kind: c.cashPolicy === 'ONLINE_ONLY' ? 'ONLINE_ONLY' : 'CASH_ONLY' },
      startOnNextWorkingDay: c.startOnNextWorkingDay,
      stride: strideFor(cadence),
      // A persisted approvedOn is already the schedule anchor (maturity + three calendar days).
      // Draft projections start from today and still need the policy's processing gap.
      startOffsetWorkingDays: c.approvedOn ? 0 : PROCESSING_WORKING_DAYS,
      policyMaxDays: parts,
    });

    return finish(
      res.installments.map((i) => ({
        seq: i.seq,
        dueOn: i.dueDate,
        amountPaise: i.amountPaise,
        paidPaise: 0n,
        givenCashPaise: 0n,
        givenOnlinePaise: 0n,
        cashPaise: i.cashLegPaise,
        onlinePaise: i.onlineLegPaise,
        state: stateOf(i.dueDate, i.amountPaise, 0n, today),
      })),
      true,
      null,
    );
  } catch (e) {
    const msg =
      e instanceof ScheduleInputError || e instanceof ScheduleIntegrityError
        ? e.message
        : 'This amount cannot be split into that many days.';
    return finish([], true, msg);
  }
}

export interface BandSummary {
  band: PlanBand;
  rows: PlanRow[];
  count: number;
  maturityPaise: bigint;
  givenPaise: bigint;
  remainingPaise: bigint;
  dueTodayPaise: bigint;
}

export function summariseBand(band: PlanBand, rows: readonly PlanRow[]): BandSummary {
  const mine = rows.filter((r) => r.band === band);
  return {
    band,
    rows: mine,
    count: mine.length,
    maturityPaise: mine.reduce((a, r) => a + r.maturityPaise, 0n),
    givenPaise: mine.reduce((a, r) => a + r.givenPaise, 0n),
    remainingPaise: mine.reduce((a, r) => a + r.remainingPaise, 0n),
    dueTodayPaise: mine.reduce((a, r) => a + r.dueTodayPaise, 0n),
  };
}

export interface TodayLine {
  caseId: string;
  customerName: string;
  accountNumber: string | null;
  agentName: string;
  band: PlanBand;
  amountPaise: bigint;
  isProjection: boolean;
}

export interface TodayColumn {
  totalPaise: bigint;
  /** Of that total, the part backed by a real approved schedule rather than a projection. */
  committedPaise: bigint;
  projectedPaise: bigint;
  count: number;
  lines: TodayLine[];
}

/** Column one: what the counter is expected to hand over today, and to whom. */
export function summariseToday(rows: readonly PlanRow[]): TodayColumn {
  const lines: TodayLine[] = [];
  let totalPaise = 0n;
  let committedPaise = 0n;
  let projectedPaise = 0n;
  for (const r of rows) {
    if (r.dueTodayPaise <= 0n) continue;
    totalPaise += r.dueTodayPaise;
    if (r.isProjection) projectedPaise += r.dueTodayPaise;
    else committedPaise += r.dueTodayPaise;
    lines.push({
      caseId: r.caseId,
      customerName: r.customerName,
      accountNumber: r.accountNumber,
      agentName: r.agentName,
      band: r.band,
      amountPaise: r.dueTodayPaise,
      isProjection: r.isProjection,
    });
  }
  lines.sort((a, b) =>
    b.amountPaise > a.amountPaise ? 1 : b.amountPaise < a.amountPaise ? -1 : 0,
  );
  return { totalPaise, committedPaise, projectedPaise, count: lines.length, lines };
}

export interface DailyRequirement {
  dueOn: string;
  totalPaise: bigint;
  cashPaise: bigint;
  onlinePaise: bigint;
  committedPaise: bigint;
  projectedPaise: bigint;
  count: number;
}

/**
 * Exact day-wise withdrawal requirement across every row in the Plan.
 *
 * `from` excludes historical schedule dates because this figure answers how much the branch must
 * arrange, not how much it should have arranged in the past. Paid portions are removed from each
 * leg before aggregation. Search filters must never be applied before calling this function.
 */
export function summariseDailyRequirements(
  rows: readonly PlanRow[],
  from: string,
): DailyRequirement[] {
  const byDate = new Map<string, DailyRequirement>();
  for (const row of rows) {
    for (const day of row.days) {
      if (day.dueOn < from) continue;
      const remaining = day.amountPaise > day.paidPaise ? day.amountPaise - day.paidPaise : 0n;
      if (remaining <= 0n) continue;

      // Database-backed rows reconcile by constraint. The clamp keeps a malformed imported or
      // projected row from ever making the displayed cash requirement exceed the withdrawal.
      const cash = day.cashPaise < remaining ? day.cashPaise : remaining;
      const online = remaining - cash;
      const current = byDate.get(day.dueOn) ?? {
        dueOn: day.dueOn,
        totalPaise: 0n,
        cashPaise: 0n,
        onlinePaise: 0n,
        committedPaise: 0n,
        projectedPaise: 0n,
        count: 0,
      };
      current.totalPaise += remaining;
      current.cashPaise += cash;
      current.onlinePaise += online;
      if (row.isProjection) current.projectedPaise += remaining;
      else current.committedPaise += remaining;
      current.count += 1;
      byDate.set(day.dueOn, current);
    }
  }
  return [...byDate.values()].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}
