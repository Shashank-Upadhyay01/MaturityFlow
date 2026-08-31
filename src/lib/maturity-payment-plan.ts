/**
 * Pure payout projection for maturity-forecast cohorts.
 *
 * A forecast is never a case. This module only answers how much would be required on each day
 * if the forecast were activated under the bank's existing payout policy.
 */
import { generateSchedule, type CashPolicy, type PlannedInstallment } from './payout-engine';
import {
  firstPayoutOn,
  isPriorityCase,
  payoutPlanFor,
  PROCESSING_WORKING_DAYS,
} from './payout-policy';
import {
  countWorkingDaysBetween,
  makeCalendar,
  nextWorkingDayAfter,
  type ISODate,
  type WorkingDayCalendar,
} from './working-days';

export const AUGUST_2026_COHORT = '2026-08';
export const AUGUST_2026_PAYOUT_START: ISODate = '2026-09-01';
export const AUGUST_2026_PAYOUT_END: ISODate = '2026-09-12';

/** 3 policy processing days + 10 usable working days inside 1–12 September. */
export const AUGUST_2026_WINDOW_DAYS = 13;

function monthOffset(month: string, offset: number): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function carryForwardWindowFor(cohortMonth: string): {
  paymentMonth: string;
  startsOn: ISODate;
  carryForwardStartsOn: ISODate;
  endsOn: ISODate;
} {
  const paymentMonth = monthOffset(cohortMonth, 1);
  if (cohortMonth === AUGUST_2026_COHORT) {
    return {
      paymentMonth,
      startsOn: AUGUST_2026_PAYOUT_START,
      carryForwardStartsOn: AUGUST_2026_PAYOUT_START,
      endsOn: AUGUST_2026_PAYOUT_END,
    };
  }
  return {
    paymentMonth,
    startsOn: `${cohortMonth}-04`,
    carryForwardStartsOn: `${paymentMonth}-01`,
    endsOn: `${paymentMonth}-12`,
  };
}

export interface ForecastPaymentInput {
  id: string;
  maturityOn: ISODate;
  amountPaise: bigint;
}

export interface ForecastPaymentPolicy {
  calendar: WorkingDayCalendar;
  windowDays: number;
  roundingPaise: bigint;
  cashPolicy: CashPolicy;
  dailyCashComfortPaise?: bigint;
}

export interface ForecastPaymentInstalment extends PlannedInstallment {
  forecastId: string;
}

export interface DailyForecastPayment {
  dueOn: ISODate;
  cases: number;
  totalPaise: bigint;
  cashPaise: bigint;
  onlinePaise: bigint;
}

function calendarWithMonthStartOpen(
  calendar: WorkingDayCalendar,
  month: string,
): WorkingDayCalendar {
  return makeCalendar(
    calendar.holidays,
    calendar.weekend,
    [...calendar.monthsOpenAtStart, month],
  );
}

/** The exact calendar/policy override explicitly authorised for the August 2026 test cohort. */
export function august2026PaymentPolicy(policy: ForecastPaymentPolicy): ForecastPaymentPolicy {
  return {
    ...policy,
    calendar: calendarWithMonthStartOpen(policy.calendar, '2026-09'),
    windowDays: AUGUST_2026_WINDOW_DAYS,
  };
}

export function projectForecastPayments(
  cohortMonth: string,
  forecasts: ForecastPaymentInput[],
  basePolicy: ForecastPaymentPolicy,
): ForecastPaymentInstalment[] {
  const window = carryForwardWindowFor(cohortMonth);
  const policy = {
    ...basePolicy,
    calendar: calendarWithMonthStartOpen(basePolicy.calendar, window.paymentMonth),
  };

  // Alternate-day cases can occupy either of the two working-day tracks. Greedily place the
  // largest cases first onto the track with the lower projected per-day load. This preserves the
  // alternate cadence while avoiding a heavy-day/light-day sawtooth in branch cash demand.
  const alternateLoads = new Map<string, [bigint, bigint]>();
  const orderedForecasts = [...forecasts].sort((a, b) => {
    if (a.amountPaise === b.amountPaise) return a.id.localeCompare(b.id);
    return a.amountPaise > b.amountPaise ? -1 : 1;
  });

  return orderedForecasts.flatMap((forecast) => {
    // The cohort begins on day four of its maturity month and may carry through day twelve of the
    // next month, but no customer starts before their own maturity + 3-day promise.
    const promised = firstPayoutOn(forecast.maturityOn, policy.calendar);
    const baseStartDate = promised > window.startsOn ? promised : window.startsOn;
    let startDate = baseStartDate;
    if (!isPriorityCase(forecast.amountPaise)) {
      const secondTrackStart = nextWorkingDayAfter(baseStartDate, policy.calendar);
      const firstTrackDays = countWorkingDaysBetween(
        baseStartDate,
        window.endsOn,
        policy.calendar,
      );
      const secondTrackDays = secondTrackStart <= window.endsOn
        ? countWorkingDaysBetween(secondTrackStart, window.endsOn, policy.calendar)
        : 0;
      const firstSlots = Math.ceil(firstTrackDays / 2);
      const secondSlots = Math.ceil(secondTrackDays / 2);
      const loads = alternateLoads.get(baseStartDate) ?? [0n, 0n];
      if (secondSlots > 0) {
        // Cross-multiply rather than using floating point: compare the two projected averages
        // exactly in paise per payout slot.
        const firstProjected = (loads[0] + forecast.amountPaise) * BigInt(secondSlots);
        const secondProjected = (loads[1] + forecast.amountPaise) * BigInt(firstSlots);
        if (secondProjected < firstProjected) {
          startDate = secondTrackStart;
          loads[1] += forecast.amountPaise;
        } else {
          loads[0] += forecast.amountPaise;
        }
      } else {
        loads[0] += forecast.amountPaise;
      }
      alternateLoads.set(baseStartDate, loads);
    }
    const availableWorkingDays = countWorkingDaysBetween(
      startDate,
      window.endsOn,
      policy.calendar,
    );
    if (availableWorkingDays < 1) {
      throw new Error(
        `No open payout day remains for ${forecast.id} inside ${window.startsOn}–${window.endsOn}.`,
      );
    }
    const plan = payoutPlanFor(
      forecast.amountPaise,
      PROCESSING_WORKING_DAYS + availableWorkingDays,
    );
    const schedule = generateSchedule({
      totalPaise: forecast.amountPaise,
      days: plan.payoutDays,
      roundingPaise: policy.roundingPaise,
      startDate,
      calendar: policy.calendar,
      distribution: 'FRONT_LOADED',
      cashPolicy: policy.cashPolicy,
      stride: plan.stride,
      policyMaxDays: plan.payoutDays,
      branchDailyCashComfortPaise: policy.dailyCashComfortPaise,
    });

    if (schedule.lastPayoutDate > window.endsOn) {
      throw new Error(
        `Carry-forward payout for ${forecast.id} exceeds the authorised ${window.endsOn} deadline.`,
      );
    }

    return schedule.installments.map((instalment) => ({
      ...instalment,
      forecastId: forecast.id,
    }));
  });
}

export function aggregateForecastPayments(
  instalments: ForecastPaymentInstalment[],
): DailyForecastPayment[] {
  const days = new Map<ISODate, DailyForecastPayment & { caseIds: Set<string> }>();
  for (const instalment of instalments) {
    const day = days.get(instalment.dueDate) ?? {
      dueOn: instalment.dueDate,
      cases: 0,
      totalPaise: 0n,
      cashPaise: 0n,
      onlinePaise: 0n,
      caseIds: new Set<string>(),
    };
    day.totalPaise += instalment.amountPaise;
    day.cashPaise += instalment.cashLegPaise;
    day.onlinePaise += instalment.onlineLegPaise;
    day.caseIds.add(instalment.forecastId);
    days.set(instalment.dueDate, day);
  }

  return [...days.values()]
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
    .map(({ caseIds, ...day }) => ({ ...day, cases: caseIds.size }));
}
