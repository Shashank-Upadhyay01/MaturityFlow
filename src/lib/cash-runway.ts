/**
 * Cash runway — how much the counter must be able to pay on each working day.
 *
 * PURE. BIGINT-ONLY. NO I/O.
 *
 * This is a capacity plan, not a forecast of who will walk in. Every remaining
 * rupee is placed on a working day inside that case's window and split cash vs
 * online at the cash cap.
 *
 *   Smooth — remaining is taken evenly over the window.
 *   Queue  — remaining bunches at the start of the window (stress).
 *
 * INV-2: Σ(day totals) + beyondHorizon === Σ(remaining), exactly.
 */
import { generateSchedule, type Distribution } from './payout-engine';
import type { Paise } from './money';
import { addDays, type ISODate, type WorkingDayCalendar, nextWorkingDay } from './working-days';

export interface RunwayCase {
  id: string;
  customerName: string;
  agentName: string;
  remainingPaise: Paise;
  todayApprovedPaise: Paise;
  todayCashPaise: Paise;
  todayOnlinePaise: Paise;
  windowDays: number;
  committed: boolean;
  cashCapPaise: Paise;
}

export interface RunwayDriver {
  caseId: string;
  customerName: string;
  agentName: string;
  cashPaise: Paise;
  onlinePaise: Paise;
  committed: boolean;
}

export interface RunwayDay {
  date: ISODate;
  cashPaise: Paise;
  onlinePaise: Paise;
  cashCommittedPaise: Paise;
  onlineCommittedPaise: Paise;
  heads: number;
  openingPaise: Paise;
  extraCashPaise: Paise;
  overComfort: boolean;
  drivers: RunwayDriver[];
}

export interface RunwayResult {
  days: RunwayDay[];
  remainingPaise: Paise;
  cashPaise: Paise;
  onlinePaise: Paise;
  extraCashPaise: Paise;
  peakCashPaise: Paise;
  peakDate: ISODate | null;
  nextCashPaise: Paise;
  nextOnlinePaise: Paise;
  nextDate: ISODate | null;
  beyondPaise: Paise;
  committedPaise: Paise;
  pipelinePaise: Paise;
  liveCases: number;
  /** Share of next-5-days cash sitting with the single busiest agent, 0–100. */
  topAgentShare: number;
  topAgentName: string | null;
}

export interface RunwayInput {
  cases: RunwayCase[];
  workingDays: ISODate[];
  distribution: Distribution;
  roundingPaise: Paise;
  defaultCashCapPaise: Paise;
  calendar: WorkingDayCalendar;
  openings: Map<string, Paise>;
  defaultOpeningPaise: Paise;
  comfortPaise: Paise;
}

export function splitCashCap(amount: Paise, cap: Paise): { cash: Paise; online: Paise } {
  const bound = cap < 0n ? 0n : cap;
  const cash = amount < bound ? amount : bound;
  return { cash, online: amount - cash };
}

function addDriver(day: RunwayDay, d: RunwayDriver) {
  day.cashPaise += d.cashPaise;
  day.onlinePaise += d.onlinePaise;
  if (d.committed) {
    day.cashCommittedPaise += d.cashPaise;
    day.onlineCommittedPaise += d.onlinePaise;
  }
  day.heads += 1;
  day.drivers.push(d);
}

export function buildRunway(input: RunwayInput): RunwayResult {
  const {
    cases,
    workingDays,
    distribution,
    roundingPaise,
    defaultCashCapPaise,
    calendar,
    openings,
    defaultOpeningPaise,
    comfortPaise,
  } = input;

  if (workingDays.length === 0) return emptyResult();
  const firstDate = workingDays[0];
  const lastDate = workingDays[workingDays.length - 1];

  const days: RunwayDay[] = workingDays.map((date) => ({
    date,
    cashPaise: 0n,
    onlinePaise: 0n,
    cashCommittedPaise: 0n,
    onlineCommittedPaise: 0n,
    heads: 0,
    openingPaise: openings.get(date) ?? defaultOpeningPaise,
    extraCashPaise: 0n,
    overComfort: false,
    drivers: [],
  }));
  const index = new Map(days.map((d, i) => [d.date, i]));

  let remainingPaise = 0n;
  let committedPaise = 0n;
  let pipelinePaise = 0n;
  let beyondPaise = 0n;
  let liveCases = 0;

  for (const c of cases) {
    let left = c.remainingPaise;
    if (left <= 0n) continue;
    liveCases += 1;
    remainingPaise += left;
    if (c.committed) committedPaise += left;
    else pipelinePaise += left;

    const cap = c.cashCapPaise > 0n ? c.cashCapPaise : defaultCashCapPaise;
    const window = Math.max(1, Math.min(c.windowDays || 15, 60));
    const pinned = c.todayApprovedPaise > 0n ? (c.todayApprovedPaise < left ? c.todayApprovedPaise : left) : 0n;

    if (pinned > 0n) {
      let cash = c.todayCashPaise;
      let online = c.todayOnlinePaise;
      if (cash + online !== pinned || cash < 0n || online < 0n) {
        const s = splitCashCap(pinned, cap);
        cash = s.cash;
        online = s.online;
      }
      addDriver(days[0], {
        caseId: c.id,
        customerName: c.customerName,
        agentName: c.agentName,
        cashPaise: cash,
        onlinePaise: online,
        committed: c.committed,
      });
      left -= pinned;
    }

    if (left <= 0n) continue;

    const restDays = pinned > 0n ? Math.max(1, window - 1) : window;
    const start = pinned > 0n ? nextWorkingDay(addDays(firstDate, 1), calendar) : firstDate;
    const sched = generateSchedule({
      totalPaise: left,
      days: restDays,
      roundingPaise,
      startDate: start,
      calendar,
      distribution,
      cashPolicy: { kind: 'CASH_CAP', cashCapPerDayPaise: cap },
      startOnNextWorkingDay: false,
    });

    for (const inst of sched.installments) {
      const driver: RunwayDriver = {
        caseId: c.id,
        customerName: c.customerName,
        agentName: c.agentName,
        cashPaise: inst.cashLegPaise,
        onlinePaise: inst.onlineLegPaise,
        committed: c.committed,
      };
      const i = index.get(inst.dueDate);
      if (i != null) addDriver(days[i], driver);
      else if (inst.dueDate > lastDate) beyondPaise += inst.amountPaise;
      else addDriver(days[0], driver);
    }
  }

  let cashPaise = 0n;
  let onlinePaise = 0n;
  let extraCashPaise = 0n;
  let peakCashPaise = 0n;
  let peakDate: ISODate | null = null;
  const agentCash = new Map<string, Paise>();

  for (const d of days) {
    d.drivers.sort((a, b) => (a.cashPaise + a.onlinePaise > b.cashPaise + b.onlinePaise ? -1 : 1));
    d.drivers = d.drivers.slice(0, 8);
    d.extraCashPaise = d.cashPaise > d.openingPaise ? d.cashPaise - d.openingPaise : 0n;
    d.overComfort = d.cashPaise > comfortPaise;
    cashPaise += d.cashPaise;
    onlinePaise += d.onlinePaise;
    extraCashPaise += d.extraCashPaise;
    if (d.cashPaise > peakCashPaise) {
      peakCashPaise = d.cashPaise;
      peakDate = d.date;
    }
  }

  const next5 = days.slice(0, 5);
  let next5Cash = 0n;
  for (const d of next5) {
    next5Cash += d.cashPaise;
    for (const dr of d.drivers) {
      agentCash.set(dr.agentName, (agentCash.get(dr.agentName) ?? 0n) + dr.cashPaise);
    }
  }
  let topAgentName: string | null = null;
  let topAgentPaise = 0n;
  for (const [name, v] of agentCash) {
    if (v > topAgentPaise) {
      topAgentPaise = v;
      topAgentName = name;
    }
  }
  const topAgentShare = next5Cash > 0n ? Number((topAgentPaise * 100n) / next5Cash) : 0;

  const placed = cashPaise + onlinePaise + beyondPaise;
  if (placed !== remainingPaise) {
    throw new Error(
      `Runway does not cover remaining: remaining=${remainingPaise} placed=${placed} ` +
        `(cash=${cashPaise} online=${onlinePaise} beyond=${beyondPaise})`,
    );
  }

  return {
    days,
    remainingPaise,
    cashPaise,
    onlinePaise,
    extraCashPaise,
    peakCashPaise,
    peakDate,
    nextCashPaise: days[0]?.cashPaise ?? 0n,
    nextOnlinePaise: days[0]?.onlinePaise ?? 0n,
    nextDate: days[0]?.date ?? null,
    beyondPaise,
    committedPaise,
    pipelinePaise,
    liveCases,
    topAgentShare,
    topAgentName,
  };
}

function emptyResult(): RunwayResult {
  return {
    days: [],
    remainingPaise: 0n,
    cashPaise: 0n,
    onlinePaise: 0n,
    extraCashPaise: 0n,
    peakCashPaise: 0n,
    peakDate: null,
    nextCashPaise: 0n,
    nextOnlinePaise: 0n,
    nextDate: null,
    beyondPaise: 0n,
    committedPaise: 0n,
    pipelinePaise: 0n,
    liveCases: 0,
    topAgentShare: 0,
    topAgentName: null,
  };
}
