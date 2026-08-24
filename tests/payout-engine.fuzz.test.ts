import { describe, expect, it } from 'vitest';
import { generateSchedule, type Distribution } from '../src/lib/payout-engine';
import {
  addDays,
  collectWorkingDays,
  countWorkingDaysBetween,
  isWorkingDay,
  makeCalendar,
} from '../src/lib/working-days';

/**
 * Property-based sweep over the schedule engine.
 *
 * This is the test that lets us say "the arithmetic is right" rather than "the arithmetic is
 * right for the cases we thought of". Deterministic PRNG so any failure is reproducible from
 * the printed seed.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = [1n, 10_000n, 50_000n, 100_000n, 500_000n, 1_000_000n, 5_000_000n];
const MODES: Distribution[] = ['FRONT_LOADED', 'BACK_LOADED', 'EVEN'];
const CASH_KINDS = ['CASH_ONLY', 'ONLINE_ONLY', 'CASH_CAP'] as const;

// A realistic branch calendar: weekly-offs plus a scattering of holidays across two years.
const holidays: string[] = [];
for (let i = 0; i < 730; i += 37) holidays.push(addDays('2026-01-01', i));
const cal = makeCalendar(holidays);

const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 100_000);

describe(`payout engine — ${ITERATIONS.toLocaleString('en-IN')} randomised cases`, () => {
  it('never violates a money invariant', () => {
    const rand = mulberry32(20260818);
    let checked = 0;
    let maxInstallments = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      // ₹1 .. ₹50,00,00,000 (50 crore), in paise
      const totalPaise = BigInt(Math.floor(rand() * 5_000_000_000_00)) + 1n;
      const days = 1 + Math.floor(rand() * 60);
      const roundingPaise = STEPS[Math.floor(rand() * STEPS.length)];
      const distribution = MODES[Math.floor(rand() * MODES.length)];
      const kind = CASH_KINDS[Math.floor(rand() * CASH_KINDS.length)];
      const startDate = addDays('2026-01-01', Math.floor(rand() * 700));
      const cashCapPerDayPaise = BigInt(Math.floor(rand() * 5_000_000)) * 100n;
      // Cadence: daily or alternate, with and without the processing offset.
      const stride = rand() < 0.5 ? 1 : 2;
      const startOffsetWorkingDays = rand() < 0.5 ? 0 : 3;

      const res = generateSchedule({
        totalPaise,
        days,
        roundingPaise,
        startDate,
        calendar: cal,
        distribution,
        cashPolicy:
          kind === 'CASH_CAP' ? { kind, cashCapPerDayPaise } : { kind },
        stride,
        startOffsetWorkingDays,
      });

      const ctx = () =>
        `seed-case #${iter}: total=${totalPaise} days=${days} step=${roundingPaise} ` +
        `mode=${distribution} cash=${kind} start=${startDate} stride=${stride} ` +
        `offset=${startOffsetWorkingDays}`;

      // INV-2 — the sum is exact
      let sum = 0n;
      let cash = 0n;
      let online = 0n;
      let min = res.installments[0].amountPaise;
      let max = res.installments[0].amountPaise;

      for (let i = 0; i < res.installments.length; i++) {
        const inst = res.installments[i];
        sum += inst.amountPaise;
        cash += inst.cashLegPaise;
        online += inst.onlineLegPaise;
        if (inst.amountPaise < min) min = inst.amountPaise;
        if (inst.amountPaise > max) max = inst.amountPaise;

        // INV-3 — legs reconcile, and neither leg is negative
        if (inst.cashLegPaise + inst.onlineLegPaise !== inst.amountPaise) {
          throw new Error(`INV-3 broken at #${i + 1}. ${ctx()}`);
        }
        if (inst.cashLegPaise < 0n || inst.onlineLegPaise < 0n) {
          throw new Error(`Negative leg at #${i + 1}. ${ctx()}`);
        }
        // no zero-value payouts
        if (inst.amountPaise <= 0n) throw new Error(`Non-positive instalment. ${ctx()}`);
        // INV-8 — payable day
        if (!isWorkingDay(inst.dueDate, cal)) {
          throw new Error(`Non-working due date ${inst.dueDate}. ${ctx()}`);
        }
        // strictly increasing dates
        if (i > 0 && inst.dueDate <= res.installments[i - 1].dueDate) {
          throw new Error(`Dates not strictly increasing at #${i + 1}. ${ctx()}`);
        }
        // cadence — consecutive payouts sit exactly `stride` working days apart.
        // countWorkingDaysBetween is inclusive of both ends, so the expected count is stride + 1.
        if (i > 0) {
          const gap = countWorkingDaysBetween(res.installments[i - 1].dueDate, inst.dueDate, cal);
          if (gap !== stride + 1) {
            throw new Error(
              `Cadence broken at #${i + 1}: ${gap} working days apart, expected ${stride + 1}. ${ctx()}`,
            );
          }
        }
        // sequence numbering
        if (inst.seq !== i + 1) throw new Error(`Bad seq at #${i + 1}. ${ctx()}`);
        // rounding: every non-final instalment is a whole multiple of the step
        if (!inst.isFinal && inst.amountPaise % roundingPaise !== 0n) {
          throw new Error(`Instalment #${i + 1} is not a whole step. ${ctx()}`);
        }
      }

      // The processing days really are clear of payouts: the first payout sits exactly
      // `startOffsetWorkingDays` working days past the anchor, so the inclusive count between
      // them is the offset + 1. Anything less means a payout landed inside processing.
      //
      // This sweep leaves `startOnNextWorkingDay` at its default of false, so the anchor is the
      // first working day on or after `startDate` — which is what collectWorkingDays(…, 1) gives.
      // If that flag is ever randomised here, this anchor must be computed to match.
      const anchor = collectWorkingDays(startDate, 1, cal)[0];
      const lead = countWorkingDaysBetween(anchor, res.installments[0].dueDate, cal);
      if (lead !== startOffsetWorkingDays + 1) {
        throw new Error(
          `Processing offset broken: first payout ${lead} working days in, expected ` +
            `${startOffsetWorkingDays + 1}. ${ctx()}`,
        );
      }

      if (sum !== totalPaise) throw new Error(`INV-2 broken: ${sum} !== ${totalPaise}. ${ctx()}`);
      if (cash + online !== totalPaise) throw new Error(`Leg totals broken. ${ctx()}`);
      if (cash !== res.totalCashPaise || online !== res.totalOnlinePaise) {
        throw new Error(`Reported leg totals disagree with rows. ${ctx()}`);
      }

      // Smoothness: no day may be more than two rounding steps above the smallest day
      // (one step from unit distribution, at most one more from the residue on the final day).
      if (max - min >= 2n * roundingPaise) {
        throw new Error(`Schedule is lumpy: max=${max} min=${min}. ${ctx()}`);
      }

      if (res.effectiveDays > days) throw new Error(`Used more days than asked. ${ctx()}`);
      if (res.effectiveDays !== res.installments.length) {
        throw new Error(`effectiveDays disagrees with row count. ${ctx()}`);
      }
      if (res.finalInstallmentPaise !== res.installments[res.installments.length - 1].amountPaise) {
        throw new Error(`finalInstallmentPaise is wrong. ${ctx()}`);
      }

      maxInstallments = Math.max(maxInstallments, res.installments.length);
      checked++;
    }

    expect(checked).toBe(ITERATIONS);
    expect(maxInstallments).toBeGreaterThan(50); // the sweep really did exercise long windows
  });

  it('is deterministic — identical input yields byte-identical output', () => {
    const input = {
      totalPaise: 123_456_789n,
      days: 17,
      roundingPaise: 100_000n,
      startDate: '2026-08-17',
      calendar: cal,
      distribution: 'EVEN' as const,
      cashPolicy: { kind: 'CASH_CAP' as const, cashCapPerDayPaise: 2_000_000n },
    };
    const a = generateSchedule(input);
    const b = generateSchedule(input);
    expect(JSON.stringify(a, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(
      JSON.stringify(b, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
    );
  });
});
