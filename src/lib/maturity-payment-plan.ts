/**
 * Pure payout projection for maturity-forecast cohorts.
 *
 * A forecast is never a case. This module only answers how much would be required on each day
 * if the forecast were activated under the bank's existing payout policy.
 */
import { generateSchedule, type CashPolicy, type PlannedInstallment } from './payout-engine';
import { firstPayoutOn, payoutPlanFor } from './payout-policy';
import { makeCalendar, type ISODate, type WorkingDayCalendar } from './working-days';

export const AUGUST_2026_COHORT = '2026-08';
export const AUGUST_2026_PAYOUT_START: ISODate = '2026-09-01';
export const AUGUST_2026_PAYOUT_END: ISODate = '2026-09-12';

/** 3 policy processing days + 10 usable working days inside 1–12 September. */
export const AUGUST_2026_WINDOW_DAYS = 13;

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
  const isAugustException = cohortMonth === AUGUST_2026_COHORT;
  const policy = isAugustException ? august2026PaymentPolicy(basePolicy) : basePolicy;

  return forecasts.flatMap((forecast) => {
    const startDate = isAugustException
      ? AUGUST_2026_PAYOUT_START
      : firstPayoutOn(forecast.maturityOn, policy.calendar);
    const plan = payoutPlanFor(forecast.amountPaise, policy.windowDays);
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

    if (isAugustException && schedule.lastPayoutDate > AUGUST_2026_PAYOUT_END) {
      throw new Error(
        `August 2026 payout for ${forecast.id} exceeds the authorised 12 September deadline.`,
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
