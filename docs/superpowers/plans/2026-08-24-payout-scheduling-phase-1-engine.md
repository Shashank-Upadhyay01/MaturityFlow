# Payout Scheduling — Phase 1 (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the payout engine two new ideas — a payout *cadence* (daily for maturities of ₹1 lakh and over, every other working day below that) and a *processing offset* (the first 3 working days after approval carry no payout) — without changing any of the money arithmetic.

**Architecture:** The business rule lives in a new pure module `payout-policy.ts`, so `payout-engine.ts` stays mechanical and policy-free. The engine gains two optional inputs (`stride`, `startOffsetWorkingDays`) that affect **only Step 7, date assignment**. Steps 1–6 — rounding units, the `q`/`r` split, residue-on-the-last-day, and the `Σ === total` assertion — are not edited at all. A new `cadence` column persists the decision at approval so a later reschedule cannot silently flip a case.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM + Postgres 18, `bigint` paise only.

**Spec:** `docs/superpowers/specs/2026-08-24-payout-scheduling-overhaul-design.md`

## Global Constraints

- **Money is `bigint` paise everywhere.** No `number`, no `float`, no `Decimal`.
- **`Σ(instalments) === maturityAmount`, exactly.** The runtime assertion in `generateSchedule` is never removed or weakened.
- **`payout-engine.ts` stays pure** — no `Date.now()`, no randomness, no I/O.
- **The ₹1 lakh line is `maturityAmountPaise >= 10_000_000n`.** Exactly ₹1,00,000 is a large case (spec D2).
- **Days are working days** — Sundays, 2nd/4th Saturdays and holidays never count (spec D1).
- **Window model:** `W0` = approval day (rolled to next working day). `W0–W2` processing, `W3–W14` the 12 payout days, deadline `W14`. Total window = 15 working days *inclusive of the approval day*.
- **Sub-₹1-lakh cases keep the same deadline** — 6 payouts at `W3, W5, W7, W9, W11, W13` (spec D3).
- **Do not edit Steps 1–6 of `generateSchedule`.** Cadence touches Step 7 and the instalment count only.
- **Migrations are generated with `drizzle-kit generate`, never hand-written** (`CLAUDE.md` § Traps).
- Verification commands: `npm run typecheck`, `npm run lint`, `FUZZ_ITERATIONS=1000 npm test` (fast) or `npm test` (full 100k sweep before the final commit).

---

### Task 1: The payout policy module

**Files:**
- Create: `src/lib/payout-policy.ts`
- Test: `tests/payout-policy.test.ts`

**Interfaces:**
- Consumes: nothing — this is a leaf module with no imports.
- Produces:
  - `LARGE_CASE_THRESHOLD_PAISE: bigint` (= `10_000_000n`)
  - `PROCESSING_WORKING_DAYS: number` (= `3`)
  - `type Cadence = 'DAILY' | 'ALTERNATE'`
  - `class PayoutPolicyError extends Error`
  - `isPriorityCase(maturityAmountPaise: bigint): boolean`
  - `cadenceFor(maturityAmountPaise: bigint): Cadence`
  - `strideFor(cadence: Cadence): 1 | 2`
  - `interface PayoutPlan { cadence: Cadence; processingDays: number; payoutDays: number; stride: 1 | 2 }`
  - `payoutPlanFor(maturityAmountPaise: bigint, windowDays: number, processingDays?: number): PayoutPlan`

- [ ] **Step 1: Write the failing test**

Create `tests/payout-policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LARGE_CASE_THRESHOLD_PAISE,
  PROCESSING_WORKING_DAYS,
  PayoutPolicyError,
  cadenceFor,
  isPriorityCase,
  payoutPlanFor,
  strideFor,
} from '../src/lib/payout-policy';

const LAKH = 10_000_000n; // ₹1,00,000 in paise

describe('the ₹1 lakh line', () => {
  it('sits at exactly ₹1,00,000, inclusive', () => {
    expect(LARGE_CASE_THRESHOLD_PAISE).toBe(LAKH);
    expect(isPriorityCase(LAKH)).toBe(true);
    expect(isPriorityCase(LAKH + 1n)).toBe(true);
    expect(isPriorityCase(LAKH - 1n)).toBe(false);
  });

  it('decides the cadence', () => {
    expect(cadenceFor(LAKH)).toBe('DAILY');
    expect(cadenceFor(LAKH - 1n)).toBe('ALTERNATE');
    expect(cadenceFor(159_095_400n)).toBe('DAILY');
    expect(cadenceFor(100n)).toBe('ALTERNATE');
  });

  it('maps cadence to a stride', () => {
    expect(strideFor('DAILY')).toBe(1);
    expect(strideFor('ALTERNATE')).toBe(2);
  });
});

describe('payoutPlanFor', () => {
  it('gives a large case 12 daily payouts in a 15-day window', () => {
    expect(payoutPlanFor(LAKH, 15)).toEqual({
      cadence: 'DAILY',
      processingDays: 3,
      payoutDays: 12,
      stride: 1,
    });
  });

  it('gives a small case 6 alternate payouts in the same window', () => {
    expect(payoutPlanFor(LAKH - 1n, 15)).toEqual({
      cadence: 'ALTERNATE',
      processingDays: 3,
      payoutDays: 6,
      stride: 2,
    });
  });

  it('generalises to a longer window rather than hard-coding 12', () => {
    expect(payoutPlanFor(LAKH, 20).payoutDays).toBe(17);
    expect(payoutPlanFor(LAKH - 1n, 20).payoutDays).toBe(9); // ceil(17 / 2)
  });

  it('the last payout always lands inside the window', () => {
    for (const windowDays of [4, 5, 8, 15, 20, 31, 60]) {
      for (const amount of [LAKH, LAKH - 1n]) {
        const p = payoutPlanFor(amount, windowDays);
        const lastOffset = (p.payoutDays - 1) * p.stride; // working days past the payout anchor
        expect(lastOffset).toBeLessThanOrEqual(windowDays - p.processingDays - 1);
      }
    }
  });

  it('refuses a window with no room to pay', () => {
    expect(() => payoutPlanFor(LAKH, 3)).toThrow(PayoutPolicyError);
    expect(() => payoutPlanFor(LAKH, 0)).toThrow(PayoutPolicyError);
    expect(() => payoutPlanFor(LAKH, 15.5)).toThrow(PayoutPolicyError);
    // 4 working days minus 3 processing leaves exactly one payout day — allowed.
    expect(payoutPlanFor(LAKH, 4).payoutDays).toBe(1);
    expect(payoutPlanFor(LAKH - 1n, 4).payoutDays).toBe(1);
  });

  it('exposes the processing constant it used', () => {
    expect(PROCESSING_WORKING_DAYS).toBe(3);
    expect(payoutPlanFor(LAKH, 15, 0).payoutDays).toBe(15);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/payout-policy.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/payout-policy"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/payout-policy.ts`:

```ts
/**
 * payout-policy.ts — who gets paid how often.
 *
 * Deliberately NOT part of payout-engine.ts. The engine is mechanical arithmetic and must stay
 * policy-free: if the ₹1 lakh rule ever moves, that must not be able to reach the code that
 * splits money. Pure, no I/O, bigint-only.
 */

/**
 * At or above this, a maturity is a "large" case: paid every working day and listed on the
 * priority sheet. Below it, payouts fall on alternate working days.
 *
 * Inclusive on purpose — a maturity of exactly ₹1,00,000 is a large case.
 */
export const LARGE_CASE_THRESHOLD_PAISE = 10_000_000n;

/**
 * Working days after approval that carry no payout.
 *
 * The form is checked, the schedule signed off and the cash arranged before a rupee moves, so
 * the window opens on the fourth working day. A constant, not a branch setting — see the spec's
 * non-goals before making it configurable.
 */
export const PROCESSING_WORKING_DAYS = 3;

export type Cadence = 'DAILY' | 'ALTERNATE';

export class PayoutPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutPolicyError';
  }
}

/** Large enough to be paid daily and tracked on the priority sheet. */
export function isPriorityCase(maturityAmountPaise: bigint): boolean {
  return maturityAmountPaise >= LARGE_CASE_THRESHOLD_PAISE;
}

export function cadenceFor(maturityAmountPaise: bigint): Cadence {
  return isPriorityCase(maturityAmountPaise) ? 'DAILY' : 'ALTERNATE';
}

/** How many working days apart consecutive payouts sit. */
export function strideFor(cadence: Cadence): 1 | 2 {
  return cadence === 'DAILY' ? 1 : 2;
}

export interface PayoutPlan {
  cadence: Cadence;
  /** Working days after approval with no payout. */
  processingDays: number;
  /** How many instalments the schedule should have. */
  payoutDays: number;
  /** Working days between consecutive payouts. */
  stride: 1 | 2;
}

/**
 * Turn an amount and a window into the shape of its schedule.
 *
 * `windowDays` is the TOTAL window counted in working days and inclusive of the approval day —
 * not the number of payout days. With the default 15 and 3 processing days, a large case gets 12
 * daily payouts and a small one gets 6 on alternate days, both finishing inside the same window.
 */
export function payoutPlanFor(
  maturityAmountPaise: bigint,
  windowDays: number,
  processingDays: number = PROCESSING_WORKING_DAYS,
): PayoutPlan {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new PayoutPolicyError(`windowDays must be a whole number of at least 1, got ${windowDays}`);
  }
  if (!Number.isInteger(processingDays) || processingDays < 0) {
    throw new PayoutPolicyError(
      `processingDays must be a whole number of at least 0, got ${processingDays}`,
    );
  }

  const usableDays = windowDays - processingDays;
  if (usableDays < 1) {
    throw new PayoutPolicyError(
      `A ${windowDays}-working-day window with ${processingDays} processing days leaves no day ` +
        'to pay on. Widen the window or reduce the processing days.',
    );
  }

  const cadence = cadenceFor(maturityAmountPaise);
  const stride = strideFor(cadence);
  const payoutDays = cadence === 'DAILY' ? usableDays : Math.ceil(usableDays / 2);

  // The window has to be able to hold what we just planned. This cannot fail with the arithmetic
  // above; it is here so that it cannot start failing silently if the arithmetic changes.
  const lastOffset = (payoutDays - 1) * stride;
  if (lastOffset > usableDays - 1) {
    throw new PayoutPolicyError(
      `${payoutDays} payouts at stride ${stride} need ${lastOffset + 1} working days but only ` +
        `${usableDays} are inside the window.`,
    );
  }

  return { cadence, processingDays, payoutDays, stride };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/payout-policy.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean, no output beyond the script banner.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payout-policy.ts tests/payout-policy.test.ts
git commit -m "feat(payout): add payout-policy module for cadence and window shape"
```

---

### Task 2: `collectWorkingDays` learns a stride

**Files:**
- Modify: `src/lib/working-days.ts:154-176` (the `collectWorkingDays` function)
- Test: `tests/working-days.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `collectWorkingDays(start: ISODate, count: number, cal: WorkingDayCalendar, stride?: number): ISODate[]` — `stride` defaults to `1`, which is byte-for-byte the current behaviour.

- [ ] **Step 1: Write the failing test**

Append to `tests/working-days.test.ts`:

```ts
describe('collectWorkingDays with a stride', () => {
  // 2026-08-24 is a Monday. Sundays and 2nd/4th Saturdays are off by default.
  const cal = makeCalendar([]);

  it('stride 1 is exactly the old behaviour', () => {
    const a = collectWorkingDays('2026-08-24', 6, cal);
    const b = collectWorkingDays('2026-08-24', 6, cal, 1);
    expect(b).toEqual(a);
  });

  it('stride 2 takes every other working day', () => {
    const every = collectWorkingDays('2026-08-24', 11, cal);
    const alternate = collectWorkingDays('2026-08-24', 6, cal, 2);
    expect(alternate).toEqual([every[0], every[2], every[4], every[6], every[8], every[10]]);
  });

  it('stride 2 counts working days, not calendar days, across a weekend', () => {
    const dates = collectWorkingDays('2026-08-24', 4, cal, 2);
    for (const d of dates) expect(isWorkingDay(d, cal)).toBe(true);
    // Consecutive picks are two working days apart, inclusive count of 3.
    for (let i = 0; i + 1 < dates.length; i++) {
      expect(countWorkingDaysBetween(dates[i], dates[i + 1])).toBe(3);
    }
  });

  it('stride 2 steps over a holiday without landing on it', () => {
    const withHoliday = makeCalendar(['2026-08-26']); // the Wednesday
    const dates = collectWorkingDays('2026-08-24', 3, withHoliday, 2);
    expect(dates).not.toContain('2026-08-26');
    for (const d of dates) expect(isWorkingDay(d, withHoliday)).toBe(true);
  });

  it('rejects a stride that is not a positive whole number', () => {
    expect(() => collectWorkingDays('2026-08-24', 3, cal, 0)).toThrow(CalendarError);
    expect(() => collectWorkingDays('2026-08-24', 3, cal, -1)).toThrow(CalendarError);
    expect(() => collectWorkingDays('2026-08-24', 3, cal, 1.5)).toThrow(CalendarError);
  });
});
```

Check the existing import block at the top of `tests/working-days.test.ts` and add any of
`collectWorkingDays`, `countWorkingDaysBetween`, `isWorkingDay`, `makeCalendar`, `CalendarError`
that are not already imported from `../src/lib/working-days`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/working-days.test.ts -t "stride"`
Expected: FAIL — the stride tests fail because the 4th argument is ignored (`stride 2 takes every other working day` returns consecutive days).

- [ ] **Step 3: Write the implementation**

Replace `collectWorkingDays` in `src/lib/working-days.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/working-days.test.ts`
Expected: PASS — the new stride block plus every pre-existing working-days test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/working-days.ts tests/working-days.test.ts
git commit -m "feat(calendar): collectWorkingDays takes an optional stride"
```

---

### Task 3: The engine accepts a stride and a processing offset

**Files:**
- Modify: `src/lib/payout-engine.ts` — `ScheduleInput` (around line 46), the destructuring block (around line 143), Step 0 validation, and Step 7 (around line 252)
- Test: `tests/payout-engine.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `collectWorkingDays(..., stride)` from Task 2.
- Produces: `ScheduleInput` gains two optional fields — `stride?: number` (default `1`) and `startOffsetWorkingDays?: number` (default `0`). Both defaults reproduce today's behaviour exactly.

- [ ] **Step 1: Write the failing test**

Append to `tests/payout-engine.test.ts`:

```ts
describe('cadence and the processing offset', () => {
  const cal = makeCalendar([]);
  const LAKH = 10_000_000n;

  // 2026-08-24 is a Monday.
  const base = {
    roundingPaise: 100_000n, // ₹1,000
    startDate: '2026-08-24' as const,
    calendar: cal,
  };

  it('defaults are unchanged — no stride, no offset', () => {
    const a = generateSchedule({ ...base, totalPaise: 50_000_000n, days: 12 });
    const b = generateSchedule({
      ...base,
      totalPaise: 50_000_000n,
      days: 12,
      stride: 1,
      startOffsetWorkingDays: 0,
    });
    expect(b.installments.map((i) => i.dueDate)).toEqual(a.installments.map((i) => i.dueDate));
    expect(a.installments[0].dueDate).toBe('2026-08-24');
  });

  it('the offset holds the first payout back by whole working days', () => {
    const withOffset = generateSchedule({
      ...base,
      totalPaise: 50_000_000n,
      days: 12,
      startOffsetWorkingDays: 3,
    });
    const everyDay = collectWorkingDays('2026-08-24', 4, cal);
    // W0, W1, W2 are processing; the first payout is W3.
    expect(withOffset.installments[0].dueDate).toBe(everyDay[3]);
    expect(withOffset.installments).toHaveLength(12);
  });

  it('a large case pays on 12 consecutive working days from W3', () => {
    const r = generateSchedule({
      ...base,
      totalPaise: LAKH * 5n,
      days: 12,
      stride: 1,
      startOffsetWorkingDays: 3,
    });
    const window = collectWorkingDays('2026-08-24', 15, cal);
    expect(r.installments.map((i) => i.dueDate)).toEqual(window.slice(3, 15));
    expect(r.installments[r.installments.length - 1].dueDate).toBe(window[14]);
  });

  it('a small case pays on 6 alternate working days, finishing inside the window', () => {
    const r = generateSchedule({
      ...base,
      totalPaise: 6_000_000n, // ₹60,000
      days: 6,
      stride: 2,
      startOffsetWorkingDays: 3,
    });
    const window = collectWorkingDays('2026-08-24', 15, cal);
    expect(r.installments.map((i) => i.dueDate)).toEqual([
      window[3], window[5], window[7], window[9], window[11], window[13],
    ]);
    // W13 is inside the W14 deadline.
    expect(r.installments[5].dueDate).not.toBe(window[14]);
  });

  it('still sums to the maturity amount with a stride and an offset', () => {
    const total = 6_012_345n;
    const r = generateSchedule({
      ...base,
      totalPaise: total,
      days: 6,
      stride: 2,
      startOffsetWorkingDays: 3,
    });
    expect(r.installments.reduce((a, i) => a + i.amountPaise, 0n)).toBe(total);
  });

  it('rejects a stride or offset that is not a whole non-negative number', () => {
    const bad = { ...base, totalPaise: 50_000_000n, days: 6 };
    expect(() => generateSchedule({ ...bad, stride: 0 })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...bad, stride: 1.5 })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...bad, startOffsetWorkingDays: -1 })).toThrow(ScheduleInputError);
    expect(() => generateSchedule({ ...bad, startOffsetWorkingDays: 2.5 })).toThrow(ScheduleInputError);
  });
});
```

Add `collectWorkingDays` and `ScheduleInputError` to the imports at the top of
`tests/payout-engine.test.ts` if they are not already there.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/payout-engine.test.ts -t "cadence and the processing offset"`
Expected: FAIL — `stride` and `startOffsetWorkingDays` are ignored, so the offset and alternate-day tests get consecutive days from `2026-08-24`.

- [ ] **Step 3a: Add the two fields to `ScheduleInput`**

In `src/lib/payout-engine.ts`, inside `interface ScheduleInput`, directly after
`startOnNextWorkingDay`:

```ts
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
```

- [ ] **Step 3b: Destructure them with today's defaults**

In the destructuring block at the top of `generateSchedule`, add after `startOnNextWorkingDay = false,`:

```ts
    stride = 1,
    startOffsetWorkingDays = 0,
```

- [ ] **Step 3c: Validate them in Step 0**

Add to the Step 0 precondition block, after the `roundingPaise` check:

```ts
  if (!Number.isInteger(stride) || stride < 1) {
    throw new ScheduleInputError('stride must be a whole number of at least 1');
  }
  if (!Number.isInteger(startOffsetWorkingDays) || startOffsetWorkingDays < 0) {
    throw new ScheduleInputError('startOffsetWorkingDays must be a whole number of at least 0');
  }
```

- [ ] **Step 3d: Apply them in Step 7**

Replace the Step 7 block:

```ts
  // ── Step 7: assign working-day dates ─────────────────────────────────────
  const anchor = startOnNextWorkingDay
    ? nextWorkingDay(addOneDay(startDate), calendar)
    : nextWorkingDay(startDate, calendar);
  const dates = collectWorkingDays(anchor, effectiveDays, calendar);
```

with:

```ts
  // ── Step 7: assign working-day dates ─────────────────────────────────────
  // The anchor is the approval day. The processing days sit between it and the first payout, so
  // the payout window opens `startOffsetWorkingDays` working days later. `stride` then decides
  // whether payouts land on every working day or every other one.
  const anchor = startOnNextWorkingDay
    ? nextWorkingDay(addOneDay(startDate), calendar)
    : nextWorkingDay(startDate, calendar);
  const payoutAnchor =
    startOffsetWorkingDays > 0
      ? collectWorkingDays(anchor, startOffsetWorkingDays + 1, calendar)[startOffsetWorkingDays]
      : anchor;
  const dates = collectWorkingDays(payoutAnchor, effectiveDays, calendar, stride);
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/payout-engine.test.ts`
Expected: PASS — the new block and all 34 pre-existing engine tests.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `FUZZ_ITERATIONS=1000 npm test && npm run typecheck && npm run lint`
Expected: all suites pass, typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payout-engine.ts tests/payout-engine.test.ts
git commit -m "feat(payout): engine accepts a payout stride and a processing offset"
```

---

### Task 4: Prove cadence across 100,000 random cases

**Files:**
- Modify: `tests/payout-engine.fuzz.test.ts`

**Interfaces:**
- Consumes: `generateSchedule` with `stride` and `startOffsetWorkingDays` from Task 3; `countWorkingDaysBetween` from `working-days.ts`.
- Produces: nothing — this task only adds assertions.

- [ ] **Step 1: Add the cadence assertions to the sweep**

In `tests/payout-engine.fuzz.test.ts`:

1. Add `countWorkingDaysBetween` and `collectWorkingDays` to the import from `../src/lib/working-days`.
2. Inside the random-case loop, pick a cadence and an offset alongside the other random inputs:

```ts
    const stride = rand() < 0.5 ? 1 : 2;
    const startOffsetWorkingDays = rand() < 0.5 ? 0 : 3;
```

3. Pass both into the `generateSchedule({ ... })` call in the loop:

```ts
      stride,
      startOffsetWorkingDays,
```

4. After the existing per-case assertions, add:

```ts
      // Cadence: consecutive payouts sit exactly `stride` working days apart.
      // countWorkingDaysBetween is inclusive of both ends, so the expected count is stride + 1.
      for (let i = 0; i + 1 < result.installments.length; i++) {
        const gap = countWorkingDaysBetween(
          result.installments[i].dueDate,
          result.installments[i + 1].dueDate,
          cal,
        );
        expect(gap).toBe(stride + 1);
      }

      // This sweep leaves `startOnNextWorkingDay` at its default of false, so the anchor is the
      // first working day on or after `startDate` — which is what collectWorkingDays(…, 1) gives.
      // If you ever randomise that flag, this anchor has to be computed to match.
      // The processing days really are clear of payouts: the first payout is exactly
      // `startOffsetWorkingDays` working days past the anchor, so the inclusive count between
      // them is the offset + 1. Anything less means a payout landed inside processing.
      if (result.installments.length > 0) {
        const anchor = collectWorkingDays(startDate, 1, cal)[0];
        expect(countWorkingDaysBetween(anchor, result.installments[0].dueDate, cal)).toBe(
          startOffsetWorkingDays + 1,
        );
      }
```

- [ ] **Step 2: Run the fast sweep**

Run: `FUZZ_ITERATIONS=1000 npx vitest run tests/payout-engine.fuzz.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full sweep**

Run: `npx vitest run tests/payout-engine.fuzz.test.ts`
Expected: PASS across 100,000 cases. If a case fails, the printed seed reproduces it — fix the engine, not the assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/payout-engine.fuzz.test.ts
git commit -m "test(payout): fuzz cadence spacing and the processing offset"
```

---

### Task 5: Persist the cadence on the case

**Files:**
- Modify: `src/db/schema.ts` — add `payoutCadenceEnum` beside `distributionEnum` (around line 62) and a `cadence` column in `maturityCases` beside `distribution` (around line 304)
- Create: `drizzle/<generated>.sql` (produced by `drizzle-kit`, never hand-written)

**Interfaces:**
- Consumes: `type Cadence` from Task 1.
- Produces: `maturityCases.cadence` — a `payout_cadence` enum column, `NOT NULL DEFAULT 'DAILY'`, readable as `caseRow.cadence`.

- [ ] **Step 1: Add the enum and the column**

In `src/db/schema.ts`, after the `distributionEnum` declaration:

```ts
/** How often a case pays out. Persisted at approval — never re-derived from the amount. */
export const payoutCadenceEnum = pgEnum('payout_cadence', ['DAILY', 'ALTERNATE']);
```

In the `maturityCases` table, directly after the `distribution` column:

```ts
    /**
     * Set once, at approval, from the maturity amount. Stored rather than re-derived because the
     * amount is editable: correcting a figure months later must not silently move a case from
     * alternate-day to daily payouts.
     */
    cadence: payoutCadenceEnum('cadence').notNull().default('DAILY'),
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` containing `CREATE TYPE "payout_cadence"` and
`ALTER TABLE "maturity_cases" ADD COLUMN "cadence"`. **Read the generated SQL before applying it** — confirm it only adds the type and the column and touches nothing else.

- [ ] **Step 3: Apply the migration**

Run: `npm run db:migrate`
Expected: success.

- [ ] **Step 4: Verify the column landed**

Run:

```bash
"/c/Program Files/PostgreSQL/18/bin/psql.exe" "$DATABASE_URL" -c "\d maturity_cases" | grep cadence
```

Expected: one row showing `cadence | payout_cadence | not null | 'DAILY'::payout_cadence`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add payout cadence to maturity_cases"
```

---

### Task 6: Generate schedules through the policy

**Files:**
- Modify: `src/services/schedule-service.ts` — `persistSchedule` (lines 43-99) and `persistReschedule` (from line 101)
- Modify: `src/lib/payout-engine.ts` — `RescheduleInput` (around line 379) and `rescheduleRemaining` (around line 404)

**Interfaces:**
- Consumes: `payoutPlanFor`, `strideFor`, `type Cadence` from Task 1; the engine inputs from Task 3; `maturityCases.cadence` from Task 5.
- Produces: `RescheduleInput` gains `cadence?: Cadence` (default `'DAILY'`). `persistSchedule` writes `cadence` onto the case row.

- [ ] **Step 1: Teach `rescheduleRemaining` about cadence**

In `src/lib/payout-engine.ts`, add to `RescheduleInput`:

```ts
  /** Keeps a sub-threshold case on alternate days when its remainder is re-planned. */
  cadence?: 'DAILY' | 'ALTERNATE';
```

In `rescheduleRemaining`, add `cadence = 'DAILY'` to the destructuring, then replace the
`generateSchedule({ ... })` call's `days` argument. After `const days = Math.max(1, availableDays);` insert:

```ts
  // An alternate-day case must stay on alternate days when it is re-planned, or a small
  // maturity would quietly become a daily one the first time anything slipped.
  const stride = cadence === 'ALTERNATE' ? 2 : 1;
  const payoutSlots = cadence === 'ALTERNATE' ? Math.ceil(days / 2) : days;
```

and change the call to pass `days: payoutSlots`, `stride`, and `policyMaxDays: payoutSlots`.

- [ ] **Step 2: Write the failing service test**

Create `tests/schedule-cadence.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rescheduleRemaining } from '../src/lib/payout-engine';
import { makeCalendar } from '../src/lib/working-days';
import { payoutPlanFor } from '../src/lib/payout-policy';

const cal = makeCalendar([]);

describe('rescheduling keeps the cadence', () => {
  it('an alternate-day case stays on alternate days', () => {
    const r = rescheduleRemaining({
      remainingPaise: 3_000_000n,
      fromDate: '2026-08-24',
      deadlineDate: '2026-09-11',
      roundingPaise: 100_000n,
      calendar: cal,
      cadence: 'ALTERNATE',
    });
    for (let i = 0; i + 1 < r.installments.length; i++) {
      const a = new Date(r.installments[i].dueDate).getTime();
      const b = new Date(r.installments[i + 1].dueDate).getTime();
      expect(b).toBeGreaterThan(a);
    }
    expect(r.installments.reduce((s, i) => s + i.amountPaise, 0n)).toBe(3_000_000n);
  });

  it('a daily case is unchanged by the new option', () => {
    const withDefault = rescheduleRemaining({
      remainingPaise: 3_000_000n,
      fromDate: '2026-08-24',
      deadlineDate: '2026-09-11',
      roundingPaise: 100_000n,
      calendar: cal,
    });
    const explicit = rescheduleRemaining({
      remainingPaise: 3_000_000n,
      fromDate: '2026-08-24',
      deadlineDate: '2026-09-11',
      roundingPaise: 100_000n,
      calendar: cal,
      cadence: 'DAILY',
    });
    expect(explicit.installments.map((i) => i.dueDate)).toEqual(
      withDefault.installments.map((i) => i.dueDate),
    );
  });

  it('the plan a small case gets is the one the policy asked for', () => {
    const plan = payoutPlanFor(6_000_000n, 15);
    expect(plan).toEqual({ cadence: 'ALTERNATE', processingDays: 3, payoutDays: 6, stride: 2 });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/schedule-cadence.test.ts`
Expected: FAIL — `cadence` is not yet an accepted `RescheduleInput` field, so the alternate case comes back daily.

- [ ] **Step 4: Wire `persistSchedule` to the policy**

In `src/services/schedule-service.ts`, add the import:

```ts
import { payoutPlanFor, type Cadence } from '@/lib/payout-policy';
```

Inside `persistSchedule`, replace the `generateSchedule({ ... })` call:

```ts
  // The window is the TOTAL working-day window; the policy decides how many of those days carry
  // a payout and how far apart they sit.
  const plan = payoutPlanFor(caseRow.maturityAmountPaise, caseRow.windowDays);

  const result = generateSchedule({
    totalPaise: caseRow.maturityAmountPaise,
    days: plan.payoutDays,
    roundingPaise: caseRow.roundingPaise,
    startDate: anchor,
    calendar,
    distribution: caseRow.distribution,
    cashPolicy: cashPolicyOf(caseRow),
    startOnNextWorkingDay: caseRow.startOnNextWorkingDay,
    stride: plan.stride,
    startOffsetWorkingDays: plan.processingDays,
    policyMaxDays: plan.payoutDays,
    branchDailyCashComfortPaise,
  });
```

and add `cadence` to the case update `.set({ ... })`:

```ts
      cadence: plan.cadence,
```

`deadlineOn` keeps using `deriveDeadline(anchor, caseRow.windowDays, calendar, caseRow.startOnNextWorkingDay)` — the deadline is the end of the whole window, not of the payout run, so this line does **not** change.

- [ ] **Step 5: Pass the stored cadence into reschedules**

In `persistReschedule`, add `cadence: caseRow.cadence as Cadence,` to the `rescheduleRemaining({ ... })` argument object. Do the same in `persistReplanWindow` if it calls `rescheduleRemaining`; if it calls `generateSchedule` directly, derive `const plan = payoutPlanFor(caseRow.maturityAmountPaise, windowDays)` there and pass `days`, `stride` and `startOffsetWorkingDays` as in Step 4.

- [ ] **Step 6: Run everything**

Run: `npx vitest run tests/schedule-cadence.test.ts && FUZZ_ITERATIONS=1000 npm test && npm run typecheck && npm run lint`
Expected: all pass, clean.

- [ ] **Step 7: Audit every other `windowDays` reader**

`windowDays` has just changed meaning from "payout days" to "total window". Every site that reads
it must be checked for whether it still says something true. Run:

```bash
grep -rn "windowDays" src/ --include=*.ts --include=*.tsx
```

Walk the list below and fix any that now mislead. Most are pass-throughs and need no change; the
ones that put a number in front of a human are the ones to look at.

| Site | What to check |
|---|---|
| `src/services/import-service.ts:153` | Imported sheets set `windowDays` from a column. Still the total window — no change, but confirm the column header means "days to complete", not "days of payouts". |
| `src/services/case-service.ts:191` | Summary text `"… over N working days"`. Still true of the window. Leave. |
| `src/services/case-service.ts:518` | Note text `"Window set to N working days"`. Still true. Leave. |
| `src/services/case-service.ts:497` | `persistReplanWindow` caller — must go through `payoutPlanFor`, see Step 5. |
| `src/services/queries.ts:410,457,672,697,929` | Read-only projections into view models. Confirm none of them computes a per-day figure as `amount / windowDays`; if one does, it must use `payoutPlanFor(...).payoutDays`. |
| `src/services/register-service.ts:120` | Blank rows take the branch default. No change. |
| `src/components/domain/schedule-preview.tsx` | The live preview must pass the same `stride` and `startOffsetWorkingDays` the server will, or the browser will show a schedule the server does not produce — which breaks the client/server parity the engine's purity exists for. |

The preview component is the one that matters. Update it to call `payoutPlanFor` and pass
`days`, `stride` and `startOffsetWorkingDays` exactly as `persistSchedule` does in Step 4.

- [ ] **Step 8: Verify the preview matches the server**

Run: `npm run build && npm run start` then, in another shell,
`MSYS_NO_PATHCONV=1 node scripts/shot.mjs /maturities/new ./tmp-preview.png ops@bank.test`

Expected: the preview renders a 12-row schedule for an amount at or above ₹1 lakh and a 6-row one
below it, with the first row three working days out. Delete `tmp-preview.png` afterwards.

- [ ] **Step 9: Run the database concurrency suite**

Run: `npm run test:db`
Expected: pass. `CLAUDE.md` requires this after touching anything under `services/`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/payout-engine.ts src/services/schedule-service.ts tests/schedule-cadence.test.ts
git commit -m "feat(payout): generate and reschedule through the cadence policy"
```

---

### Task 7: Update the documentation

**Files:**
- Modify: `docs/03-PAYOUT-ENGINE.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing executable.

- [ ] **Step 1: Fix the stale field name**

In `docs/03-PAYOUT-ENGINE.md` § 1, the input table lists `firstDayIsStartDate`. The code has always
called this `startOnNextWorkingDay`, and its sense is inverted from what the row implies. Replace
that row with:

```markdown
| `startOnNextWorkingDay` | `boolean` | `true` => first payout is the working day AFTER the anchor. Default `false` (pay from the approval day). |
| `stride` | `number` | Working days between payouts. `1` (default) daily, `2` alternate. |
| `startOffsetWorkingDays` | `number` | Working days after the anchor with no payout — the processing days. Default `0`. |
```

- [ ] **Step 2: Document the window and cadence**

Add a new section to `docs/03-PAYOUT-ENGINE.md` after § 2:

```markdown
## 2a. Cadence and the processing window

`src/lib/payout-policy.ts` decides the *shape* of a schedule; the engine only executes it.

Let `W0` be the approval date rolled forward to a working day. Working days are counted
`W0, W1, W2, …`, skipping non-working days.

    W0  W1  W2 │ W3 ........................ W14
    └ processing┘ └──── 12 withdrawal days ────┘   deadline = W14

- The window is **15 working days inclusive of the approval day**: 3 processing + 12 payout.
- **`>= ₹1,00,000`** — `DAILY`, stride 1: payouts on `W3…W14`, 12 instalments.
- **`< ₹1,00,000`** — `ALTERNATE`, stride 2: payouts on `W3, W5, W7, W9, W11, W13`, 6 instalments,
  finishing one working day inside the same deadline.

The threshold is inclusive: exactly ₹1,00,000 is a large case. `windowDays` is the **total**
window, not the payout count — `payoutDays = windowDays - 3`, so a 20-day window gives 17 daily
payouts or 9 alternate ones.

Cadence is persisted on `maturity_cases.cadence` at approval and never re-derived, because the
maturity amount is editable and a later correction must not move a live case onto a different
rhythm.
```

- [ ] **Step 3: Add the two new modules to `CLAUDE.md` § Where things live**

Under `src/lib/payout-engine.ts` in the file map, add:

```
src/lib/payout-policy.ts   ★ the ₹1 lakh rule: cadence, processing days, payout count. Pure.
                           The engine stays policy-free so a rule change cannot reach the money.
```

- [ ] **Step 4: Record the `windowDays` semantic change in `CLAUDE.md` § Conventions**

Add:

```markdown
- **`windowDays` is the TOTAL working-day window, not the payout count.** 15 means 3 processing
  days plus 12 payout days. `payoutPlanFor()` is the only thing that should do that subtraction —
  never inline `windowDays - 3`. Sub-₹1-lakh cases pay on alternate working days inside the same
  window and share the same deadline.
```

- [ ] **Step 5: Commit**

```bash
git add docs/03-PAYOUT-ENGINE.md CLAUDE.md
git commit -m "docs(payout): document cadence, the processing window and windowDays"
```

---

## Done when

- `npm run typecheck`, `npm run lint` clean.
- `npm test` (full 100k fuzz) passes.
- `npm run test:db` passes.
- A case at exactly ₹1,00,000 approved on a Monday pays on 12 consecutive working days starting
  the following Thursday, with `deadline_on` on the 15th working day.
- A case at ₹99,999 approved the same day pays 6 times on alternate working days, finishing one
  working day before that deadline.
- `maturity_cases.cadence` is populated for both.

## Not in this plan

Phase 2 (editable schedules with live rebalancing) and Phase 3 (the Missed / Not-taken-today /
Priority / Breached lists) get their own plans once this lands — both read what this produces, and
writing their steps before the engine exists would be guesswork.
