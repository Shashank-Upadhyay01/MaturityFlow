# Payout Scheduling — Phase 2 (Editable Schedules) Implementation Plan

> **Partly superseded on 2026-08-26.** The cadence and ₹1 lakh work here is done and still stands. Anything in this plan that assumes an approval step or an OPS_HEAD role no longer applies — see [ADR 0005](../../adr/0005-schedule-anchored-to-maturity.md) and [the removal plan](2026-08-26-remove-approval-auto-schedule.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a clerk change any one day's payout amount and have the difference spread automatically across the later unpaid days, live as they type, with the total never moving.

**Architecture:** A new pure module `schedule-edit.ts` owns the redistribution. The browser calls it on every keystroke to preview; the server calls the *same* function on save, re-deriving from `(instalmentId, newAmount)` rather than trusting the amounts the client computed. Persisting supersedes the current schedule version exactly as `persistReschedule` does, so what was promised on any given day stays answerable.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle ORM + Postgres 18, `bigint` paise only.

**Spec:** `docs/superpowers/specs/2026-08-24-payout-scheduling-overhaul-design.md` (§6)

## What already exists — read this before starting

Phase 2 is smaller on the server than the spec implies, and one existing behaviour must be
*changed*, not extended:

`adjustUnpaidInstalmentsAction` in `src/actions/cases.ts:465` already takes the case row lock,
asserts `schedule.override`, refuses a day below what has been paid, enforces that the unpaid
total is unchanged, and writes its audit row in the same transaction. **But the client sends every
adjusted amount and the server only checks they add up.** `CLAUDE.md` non-negotiable 3 says the
client supplies *parameters* and the server derives the schedule. Today's version is guarded
enough that money cannot be created — but it is the client's arithmetic that lands in the
database, and Task 3 replaces that.

The UI at `src/app/(app)/maturities/[id]/schedule-adjust.tsx` (112 lines) makes the clerk type
every day until the figures balance, showing a mismatch error until they do. Task 4 replaces that
with live rebalancing.

## One open decision — the plan deviates from the spec here

**Spec §6.2 step 4 and §6.3 say a day-edit should supersede the schedule version** (mark the old
rows `SUPERSEDED`, insert a new version), as `persistReschedule` does, so that "what did we promise
this customer on Tuesday" stays answerable.

**Task 3 below updates the rows in place instead.** Reasons: it matches what
`adjustUnpaidInstalmentsAction` already does; superseding on every nudge of a figure would produce
a new version per keystroke-batch and a long tail of dead rows; and re-inserting rows changes
their ids, which `payout_transactions` reference.

What is lost: the day-by-day history of *plan* changes. What is kept: every edit still writes an
audit row naming the case, the day and the new amount, in the same transaction.

**This is the product owner's call.** If the history matters more than the row churn, Task 3's
`persistInstalmentEdit` should follow `persistReschedule`'s supersede-and-reinsert shape instead —
the rest of the plan is unaffected either way.

## Global Constraints

- **Money is `bigint` paise everywhere.** No `number`, no `float`, no `Decimal`.
- **`Σ(instalments) === maturityAmount`, exactly** — re-asserted in the pure module AND again
  server-side before persisting. A mismatch throws `ScheduleIntegrityError`.
- **Paid rows are immutable; part-paid rows may be cut only down to what was actually paid.**
- **The difference spreads across LATER rows only** (spec D4). Rows before the edited one keep the
  figures the branch has already planned cash against.
- **Every mutation: `requireActor()` then `assertCan()`, then the CASE row lock FIRST, then re-read
  the instalments with `.for('update')`** — lock order is always case → instalment.
- **Audit row in the same transaction** as the change it describes.
- `schedule-edit.ts` is a plain module, not `'use server'`, so the browser can import it.
- Verification: `npm run typecheck`, `npm run lint`, `FUZZ_ITERATIONS=1000 npm test` (fast),
  `npm test` (full) and `npm run test:db` before the final commit.

---

### Task 1: The pure rebalance module

**Files:**
- Create: `src/lib/schedule-edit.ts`
- Test: `tests/schedule-edit.test.ts`

**Interfaces:**
- Consumes: nothing — a leaf module.
- Produces:
  - `interface EditableInstalment { id: string; seq: number; dueOn: string; amountPaise: bigint; paidPaise: bigint; isFinal: boolean }`
  - `type RebalanceError = 'NEGATIVE_AMOUNT' | 'EDITED_ROW_ALREADY_PAID' | 'AMOUNT_BELOW_ALREADY_PAID' | 'NO_LATER_UNPAID_DAYS' | 'AMOUNT_EXCEEDS_REMAINING' | 'ROW_NOT_FOUND'`
  - `type RebalanceResult = { ok: true; instalments: EditableInstalment[] } | { ok: false; error: RebalanceError; message: string }`
  - `class ScheduleEditIntegrityError extends Error`
  - `rebalanceAfter(instalments: readonly EditableInstalment[], id: string, newAmountPaise: bigint, roundingPaise: bigint): RebalanceResult`

- [ ] **Step 1: Write the failing test**

Create `tests/schedule-edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ScheduleEditIntegrityError,
  rebalanceAfter,
  type EditableInstalment,
} from '../src/lib/schedule-edit';

const STEP = 100_000n; // ₹1,000

/** Six equal ₹10,000 days, none paid. */
function sixDays(overrides: Partial<Record<number, Partial<EditableInstalment>>> = {}) {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `i${i + 1}`,
    seq: i + 1,
    dueOn: `2026-09-0${i + 1}`,
    amountPaise: 1_000_000n,
    paidPaise: 0n,
    isFinal: i === 5,
    ...(overrides[i + 1] ?? {}),
  })) as EditableInstalment[];
}

const total = (rows: readonly EditableInstalment[]) =>
  rows.reduce((a, r) => a + r.amountPaise, 0n);

describe('rebalanceAfter', () => {
  it('spreads an increase across the later days only', () => {
    const before = sixDays();
    const res = rebalanceAfter(before, 'i2', 4_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);

    expect(res.instalments[0].amountPaise).toBe(1_000_000n); // day 1 untouched
    expect(res.instalments[1].amountPaise).toBe(4_000_000n); // the edit
    expect(total(res.instalments)).toBe(total(before)); // total never moves
    // Days 3-6 absorbed -₹30,000 between them.
    expect(total(res.instalments.slice(2))).toBe(1_000_000n);
  });

  it('spreads a decrease across the later days only', () => {
    const res = rebalanceAfter(sixDays(), 'i1', 400_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[0].amountPaise).toBe(400_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('never touches a row before the edited one', () => {
    const before = sixDays();
    const res = rebalanceAfter(before, 'i4', 2_000_000n, STEP);
    if (!res.ok) throw new Error('expected ok');
    for (let i = 0; i < 3; i++) {
      expect(res.instalments[i].amountPaise).toBe(before[i].amountPaise);
    }
  });

  it('leaves every row a whole multiple of the rounding step, bar the final one', () => {
    const res = rebalanceAfter(sixDays(), 'i2', 1_500_000n, STEP);
    if (!res.ok) throw new Error('expected ok');
    for (const r of res.instalments.filter((x) => !x.isFinal)) {
      expect(r.amountPaise % STEP).toBe(0n);
    }
  });

  it('refuses to edit a fully paid row', () => {
    const rows = sixDays({ 1: { paidPaise: 1_000_000n } });
    const res = rebalanceAfter(rows, 'i1', 500_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('EDITED_ROW_ALREADY_PAID');
  });

  it('lets a part-paid row be cut to exactly what went out', () => {
    const rows = sixDays({ 1: { paidPaise: 500_000n } });
    const res = rebalanceAfter(rows, 'i1', 500_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[0].amountPaise).toBe(500_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('refuses to cut a part-paid row below what went out', () => {
    const rows = sixDays({ 1: { paidPaise: 500_000n } });
    const res = rebalanceAfter(rows, 'i1', 400_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('AMOUNT_BELOW_ALREADY_PAID');
  });

  it('refuses a negative amount but allows zero', () => {
    expect(rebalanceAfter(sixDays(), 'i2', -1n, STEP).ok).toBe(false);
    const zero = rebalanceAfter(sixDays(), 'i2', 0n, STEP);
    if (!zero.ok) throw new Error(`expected ok, got ${zero.error}`);
    expect(zero.instalments[1].amountPaise).toBe(0n);
    expect(total(zero.instalments)).toBe(6_000_000n);
  });

  it('refuses when there is no later row to absorb the change', () => {
    const res = rebalanceAfter(sixDays(), 'i6', 2_000_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('NO_LATER_UNPAID_DAYS');
  });

  it('refuses when the later rows cannot absorb the increase', () => {
    // Days 3-6 hold ₹40,000 between them; asking day 2 for ₹60,000 cannot be paid for.
    const res = rebalanceAfter(sixDays(), 'i2', 6_000_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('AMOUNT_EXCEEDS_REMAINING');
  });

  it('later fully paid rows absorb nothing and are left alone', () => {
    const rows = sixDays({ 5: { paidPaise: 1_000_000n }, 6: { paidPaise: 1_000_000n } });
    const res = rebalanceAfter(rows, 'i1', 400_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[4].amountPaise).toBe(1_000_000n);
    expect(res.instalments[5].amountPaise).toBe(1_000_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('reports an unknown row rather than silently doing nothing', () => {
    const res = rebalanceAfter(sixDays(), 'nope', 1n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('ROW_NOT_FOUND');
  });

  it('exports the integrity error it throws on an arithmetic bug', () => {
    expect(new ScheduleEditIntegrityError('x')).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/schedule-edit.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/schedule-edit"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/schedule-edit.ts`:

```ts
/**
 * schedule-edit.ts — moving money between the days of an existing schedule.
 *
 * Pure, bigint-only, no I/O. The browser runs this on every keystroke to preview the result and
 * the server runs the SAME function on save, so what the clerk saw is what gets written.
 *
 * The rule (spec D4): the difference spreads across the days AFTER the edited one. Days before it
 * keep the figures the branch has already planned cash against, and money that has actually gone
 * out is never rewritten.
 */

export interface EditableInstalment {
  id: string;
  seq: number;
  dueOn: string;
  amountPaise: bigint;
  /** cash + online already paid against this row. */
  paidPaise: bigint;
  isFinal: boolean;
}

export type RebalanceError =
  | 'NEGATIVE_AMOUNT'
  | 'EDITED_ROW_ALREADY_PAID'
  | 'AMOUNT_BELOW_ALREADY_PAID'
  | 'NO_LATER_UNPAID_DAYS'
  | 'AMOUNT_EXCEEDS_REMAINING'
  | 'ROW_NOT_FOUND';

export type RebalanceResult =
  | { ok: true; instalments: EditableInstalment[] }
  | { ok: false; error: RebalanceError; message: string };

/** Thrown when the arithmetic itself is wrong — never in response to clerk input. */
export class ScheduleEditIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleEditIntegrityError';
  }
}

const fail = (error: RebalanceError, message: string): RebalanceResult => ({
  ok: false,
  error,
  message,
});

/**
 * Set one day's amount and spread the difference over the later days.
 *
 * Returns a typed error for anything a clerk can do by accident — those need a message, not a
 * stack trace. It THROWS only if the result would not sum to what it started at, which is an
 * arithmetic bug and must be loud.
 */
export function rebalanceAfter(
  instalments: readonly EditableInstalment[],
  id: string,
  newAmountPaise: bigint,
  roundingPaise: bigint,
): RebalanceResult {
  if (newAmountPaise < 0n) {
    return fail('NEGATIVE_AMOUNT', 'A day cannot be a negative amount.');
  }
  const idx = instalments.findIndex((i) => i.id === id);
  if (idx < 0) return fail('ROW_NOT_FOUND', 'That day is not part of this schedule.');

  const target = instalments[idx];
  if (target.paidPaise >= target.amountPaise) {
    return fail('EDITED_ROW_ALREADY_PAID', 'This day has already been paid in full.');
  }
  if (newAmountPaise < target.paidPaise) {
    return fail(
      'AMOUNT_BELOW_ALREADY_PAID',
      'This day cannot go below what has already been handed over against it.',
    );
  }

  const startingTotal = instalments.reduce((a, i) => a + i.amountPaise, 0n);
  let delta = target.amountPaise - newAmountPaise; // >0 frees money, <0 needs money

  // Later rows, and how far each can move before it would fall below what was already paid.
  const later = instalments.slice(idx + 1).filter((i) => i.paidPaise < i.amountPaise);
  if (later.length === 0) {
    return fail(
      'NO_LATER_UNPAID_DAYS',
      'There is no later unpaid day to move the difference into. Edit an earlier day, or ' +
        'reschedule the case.',
    );
  }
  const headroom = later.reduce((a, i) => a + (i.amountPaise - i.paidPaise), 0n);
  if (-delta > headroom) {
    return fail(
      'AMOUNT_EXCEEDS_REMAINING',
      'The later days do not hold enough to cover that increase.',
    );
  }

  // Spread `delta` over the later rows in whole rounding steps, largest-first so the earliest
  // later days move before the last one does; whatever cannot be expressed in whole steps lands
  // on the final row, exactly as the engine parks its residue there.
  const next = instalments.map((i) => ({ ...i }));
  const step = roundingPaise > 0n ? roundingPaise : 1n;

  for (let k = idx + 1; k < next.length && delta !== 0n; k++) {
    const row = next[k];
    if (row.paidPaise >= row.amountPaise) continue; // fully paid — absorbs nothing
    const floor = row.paidPaise;
    if (delta > 0n) {
      // Money to give away: add it here, in whole steps, remainder handled after the loop.
      const give = delta - (delta % step);
      if (give <= 0n) continue;
      row.amountPaise += give;
      delta -= give;
    } else {
      // Money needed: take what this row can spare without dropping below what was paid.
      const spare = row.amountPaise - floor;
      const want = -delta;
      const takeRaw = want < spare ? want : spare;
      const take = takeRaw - (takeRaw % step);
      if (take <= 0n) continue;
      row.amountPaise -= take;
      delta += take;
    }
  }

  next[idx].amountPaise = newAmountPaise;

  // Anything left that could not be expressed in whole steps goes on the last row that can carry
  // it — the same place the engine puts its residue.
  if (delta !== 0n) {
    for (let k = next.length - 1; k > idx; k--) {
      const row = next[k];
      if (row.paidPaise >= row.amountPaise && delta < 0n) continue;
      const candidate = row.amountPaise + delta;
      if (candidate >= row.paidPaise) {
        row.amountPaise = candidate;
        delta = 0n;
        break;
      }
    }
  }
  if (delta !== 0n) {
    return fail(
      'AMOUNT_EXCEEDS_REMAINING',
      'The later days cannot absorb that change at this rounding step.',
    );
  }

  const endingTotal = next.reduce((a, i) => a + i.amountPaise, 0n);
  if (endingTotal !== startingTotal) {
    throw new ScheduleEditIntegrityError(
      `Rebalance changed the total: ${startingTotal} became ${endingTotal}.`,
    );
  }
  for (const row of next) {
    if (row.amountPaise < 0n) {
      throw new ScheduleEditIntegrityError(`Rebalance produced a negative day on ${row.dueOn}.`);
    }
    if (row.amountPaise < row.paidPaise) {
      throw new ScheduleEditIntegrityError(
        `Rebalance put ${row.dueOn} below what was already paid against it.`,
      );
    }
  }

  return { ok: true, instalments: next };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/schedule-edit.test.ts`
Expected: PASS, 13 tests. If a spreading test fails, fix the *implementation* — the assertions
encode the spec's rule and are not negotiable.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/schedule-edit.ts tests/schedule-edit.test.ts
git commit -m "feat(payout): pure rebalance module for editing a schedule day"
```

---

### Task 2: Fuzz the rebalance

**Files:**
- Create: `tests/schedule-edit.fuzz.test.ts`

**Interfaces:**
- Consumes: `rebalanceAfter`, `EditableInstalment` from Task 1.
- Produces: nothing.

- [ ] **Step 1: Write the fuzz test**

Create `tests/schedule-edit.fuzz.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rebalanceAfter, type EditableInstalment } from '../src/lib/schedule-edit';

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

const STEPS = [1n, 100n, 10_000n, 100_000n, 1_000_000n];
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 20_000);

describe(`rebalanceAfter — ${ITERATIONS.toLocaleString('en-IN')} randomised edits`, () => {
  it('never moves the total and never rewrites money already paid', async () => {
    const rand = mulberry32(20260824);
    let applied = 0;
    let refused = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const n = 2 + Math.floor(rand() * 12);
      const step = STEPS[Math.floor(rand() * STEPS.length)];
      const rows: EditableInstalment[] = Array.from({ length: n }, (_, i) => {
        const amount = BigInt(1 + Math.floor(rand() * 500)) * step;
        // Some rows carry money already: none, part, or all of it.
        const roll = rand();
        const paid = roll < 0.6 ? 0n : roll < 0.85 ? amount / 2n : amount;
        return {
          id: `i${i + 1}`,
          seq: i + 1,
          dueOn: `2026-09-${String(i + 1).padStart(2, '0')}`,
          amountPaise: amount,
          paidPaise: paid,
          isFinal: i === n - 1,
        };
      });

      const before = rows.reduce((a, r) => a + r.amountPaise, 0n);
      const pick = rows[Math.floor(rand() * rows.length)];
      const newAmount = BigInt(Math.floor(rand() * 800)) * step;

      const res = rebalanceAfter(rows, pick.id, newAmount, step);
      const ctx = `#${iter}: n=${n} step=${step} pick=${pick.id} new=${newAmount}`;

      if (!res.ok) {
        refused++;
        continue;
      }
      applied++;

      const after = res.instalments.reduce((a, r) => a + r.amountPaise, 0n);
      if (after !== before) throw new Error(`Total moved: ${before} -> ${after}. ${ctx}`);

      for (let i = 0; i < rows.length; i++) {
        const was = rows[i];
        const now = res.instalments[i];
        if (now.amountPaise < now.paidPaise) {
          throw new Error(`Row ${now.id} below what was paid. ${ctx}`);
        }
        if (now.amountPaise < 0n) throw new Error(`Negative row ${now.id}. ${ctx}`);
        // Rows before the edited one never move.
        if (was.seq < pick.seq && now.amountPaise !== was.amountPaise) {
          throw new Error(`Row ${now.id} before the edit changed. ${ctx}`);
        }
        // A fully paid row is never rewritten.
        if (was.paidPaise >= was.amountPaise && now.amountPaise !== was.amountPaise) {
          throw new Error(`Fully paid row ${now.id} was rewritten. ${ctx}`);
        }
      }
      // The edit actually took effect.
      const edited = res.instalments.find((r) => r.id === pick.id)!;
      if (edited.amountPaise !== newAmount) {
        throw new Error(`Edit not applied: ${edited.amountPaise} != ${newAmount}. ${ctx}`);
      }

      if (applied % 5_000 === 0) await new Promise((r) => setImmediate(r));
    }

    // The sweep must exercise both outcomes, or it is not testing what it claims to.
    expect(applied).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the fast sweep**

Run: `FUZZ_ITERATIONS=1000 npx vitest run tests/schedule-edit.fuzz.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full sweep**

Run: `npx vitest run tests/schedule-edit.fuzz.test.ts`
Expected: PASS across 20,000 edits. A failure prints the case; fix the module, not the assertion.

- [ ] **Step 4: Commit**

```bash
git add tests/schedule-edit.fuzz.test.ts
git commit -m "test(payout): fuzz the schedule rebalance"
```

---

### Task 3: The save action re-derives server-side

**Files:**
- Modify: `src/actions/cases.ts:465-546` (replace `adjustUnpaidInstalmentsAction`)
- Modify: `src/services/schedule-service.ts` (add `persistInstalmentEdit`)

**Interfaces:**
- Consumes: `rebalanceAfter`, `EditableInstalment` from Task 1.
- Produces:
  - `persistInstalmentEdit({ tx, caseRow, instalmentId, newAmountPaise }): Promise<EditableInstalment[]>` in `schedule-service.ts`
  - `setInstalmentAmountAction(caseId: string, instalmentId: string, amountRupees: string): Promise<ActionResult<{ instalments: number }>>` in `cases.ts`

- [ ] **Step 1: Add the service function**

In `src/services/schedule-service.ts`, after `persistReschedule`:

```ts
/**
 * Apply one day's new amount and spread the difference over the later unpaid days.
 *
 * The caller has already taken the CASE row lock. The instalments are re-read here WITH
 * `.for('update')` — lock order is always case → instalment — and the rebalance is computed from
 * those re-read rows, never from anything the client sent. The client supplies two parameters:
 * which day, and what it should now be.
 */
export async function persistInstalmentEdit({
  tx,
  caseRow,
  instalmentId,
  newAmountPaise,
}: {
  tx: Queryable;
  caseRow: MaturityCase;
  instalmentId: string;
  newAmountPaise: bigint;
}): Promise<{ changed: number }> {
  const live = await tx
    .select()
    .from(payoutInstalments)
    .where(
      and(
        eq(payoutInstalments.caseId, caseRow.id),
        eq(payoutInstalments.scheduleVersion, caseRow.scheduleVersion),
        ne(payoutInstalments.status, 'SUPERSEDED'),
      ),
    )
    .for('update');

  const ordered = [...live].sort((a, b) => a.seq - b.seq);
  const editable: EditableInstalment[] = ordered.map((i) => ({
    id: i.id,
    seq: i.seq,
    dueOn: i.dueOn,
    amountPaise: i.amountPaise,
    paidPaise: i.paidCashPaise + i.paidOnlinePaise,
    isFinal: i.isFinal,
  }));

  const res = rebalanceAfter(editable, instalmentId, newAmountPaise, caseRow.roundingPaise);
  if (!res.ok) throw new Error(res.message);

  const cap = caseRow.cashPolicy === 'CASH_CAP' ? (caseRow.cashCapPerDayPaise ?? 0n) : null;
  let changed = 0;
  for (let k = 0; k < res.instalments.length; k++) {
    const now = res.instalments[k];
    const was = ordered[k];
    if (now.amountPaise === was.amountPaise) continue;
    // Legs are re-split from the case's own cash policy, never carried over from the old row.
    const cash =
      caseRow.cashPolicy === 'ONLINE_ONLY'
        ? 0n
        : cap !== null && now.amountPaise > cap
          ? cap
          : now.amountPaise;
    await tx
      .update(payoutInstalments)
      .set({
        amountPaise: now.amountPaise,
        cashLegPaise: cash,
        onlineLegPaise: now.amountPaise - cash,
        updatedAt: new Date(),
      })
      .where(eq(payoutInstalments.id, now.id));
    changed++;
  }
  return { changed };
}
```

Add to that file's imports:

```ts
import { rebalanceAfter, type EditableInstalment } from '@/lib/schedule-edit';
```

- [ ] **Step 2: Replace the action**

In `src/actions/cases.ts`, replace `adjustUnpaidInstalmentsAction` entirely with:

```ts
/**
 * Set one day's amount; the server spreads the difference over the later unpaid days.
 *
 * The client sends parameters — which day, what it should be — and the server derives the rest
 * from rows it re-read under lock. It never accepts a set of amounts computed in a browser.
 */
export async function setInstalmentAmountAction(
  caseId: string,
  instalmentId: string,
  amountRupees: string,
): Promise<ActionResult<{ changed: number }>> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.override', c);

    let newAmountPaise: bigint;
    try {
      newAmountPaise = parseRupeesToPaise(amountRupees);
    } catch {
      return fail('Enter a valid rupee amount', 'VALIDATION');
    }

    const out = await db.transaction(async (tx) => {
      // Case row FIRST, then the instalments inside persistInstalmentEdit with .for('update').
      const [row] = await tx
        .select()
        .from(maturityCases)
        .where(eq(maturityCases.id, caseId))
        .for('update')
        .limit(1);
      if (!row) throw new Error('Case not found');

      const res = await persistInstalmentEdit({
        tx,
        caseRow: row,
        instalmentId,
        newAmountPaise,
      });

      await writeAudit(tx, session, {
        action: 'schedule.adjusted',
        entity: 'MaturityCase',
        entityId: caseId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: one day set to ${amountRupees}, ${res.changed} day(s) re-balanced`,
        ...(await requestMeta()),
      });
      return res;
    });

    revalidateCase(caseId);
    return ok({ changed: out.changed });
  } catch (e) {
    return toActionError(e);
  }
}
```

Add `persistInstalmentEdit` to the `@/services/schedule-service` import in `cases.ts`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `ne` is not already imported from `drizzle-orm` in `schedule-service.ts`, add it.

- [ ] **Step 4: Run every suite**

Run: `FUZZ_ITERATIONS=1000 npm test && npm run lint && npm run test:db`
Expected: all pass. `test:db` is required — this touched `services/`.

- [ ] **Step 5: Commit**

```bash
git add src/actions/cases.ts src/services/schedule-service.ts
git commit -m "feat(payout): server re-derives a schedule edit from one changed day"
```

---

### Task 4: Live rebalancing in the UI

**Files:**
- Modify: `src/app/(app)/maturities/[id]/schedule-adjust.tsx` (all 112 lines — the manual-balancing flow is replaced)

**Interfaces:**
- Consumes: `rebalanceAfter`, `EditableInstalment` from Task 1; `setInstalmentAmountAction` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the component body**

The current component asks the clerk to type every day until the figures balance and blocks Save
on a mismatch. Replace that with: the clerk edits one day, the preview shows the later days
moving as they type, and Save sends only that one day.

Key shape — inside the component, replacing the `vals` / `mismatch` state:

```tsx
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Live preview, computed by the same function the server will run on save.
  const preview = useMemo(() => {
    if (!editingId) return null;
    let paise: bigint;
    try {
      paise = parseRupeesToPaise(draft || '0');
    } catch {
      return { ok: false as const, error: 'NEGATIVE_AMOUNT' as const, message: 'Enter a rupee amount.' };
    }
    return rebalanceAfter(rows, editingId, paise, roundingPaise);
  }, [rows, editingId, draft, roundingPaise]);

  const shown = preview?.ok ? preview.instalments : rows;
```

Render each day from `shown`, marking the ones whose amount differs from `rows` so the clerk can
see what moved. Show `preview.message` when `preview` is not ok, and disable Save then.

Save calls:

```tsx
    const res = await setInstalmentAmountAction(caseId, editingId, draft);
    if (!res.ok) toast.error(res.error);
    else {
      toast.success(res.data?.changed === 1 ? 'Day updated' : `${res.data?.changed} days re-balanced`);
      setEditingId(null);
      router.refresh();
    }
```

`rows` is built from the case's instalments the page already loads, mapped into
`EditableInstalment` exactly as `persistInstalmentEdit` does: `paidPaise` is
`paidCashPaise + paidOnlinePaise`.

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: See it in the real app**

Run: `npm run build && npm run start`, then in another shell:

```bash
MSYS_NO_PATHCONV=1 node scripts/shot.mjs /maturities /tmp/x.png ops@bank.test
```

Then approve a case, open it, edit a middle day, and confirm the later days move while the total
stays put. Check **both themes** — two of the three traps in `CLAUDE.md` were invisible in light
mode. Delete the screenshot afterwards.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/maturities/[id]/schedule-adjust.tsx"
git commit -m "feat(payout): live rebalancing when a schedule day is edited"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/03-PAYOUT-ENGINE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the edit rule**

Add to `docs/03-PAYOUT-ENGINE.md` after § 4 (Rescheduling):

```markdown
## 4a. Editing one day

`src/lib/schedule-edit.ts` — `rebalanceAfter(instalments, id, newAmount, step)`.

Setting one day's amount spreads the difference over the days **after** it. Days before it keep
the figures the branch has already planned cash against; fully paid days are never rewritten; a
part-paid day may be cut only as far as what actually went out. The total never moves, and that is
re-asserted before the result is returned — a mismatch throws `ScheduleEditIntegrityError`.

Clerk mistakes come back as typed errors (`NO_LATER_UNPAID_DAYS`, `AMOUNT_EXCEEDS_REMAINING`, …)
with a message, not an exception. Only broken arithmetic throws.

The browser previews with this function and the server re-derives with the same one from rows it
re-read under lock, so the client supplies two parameters — which day, what amount — and never a
set of instalment rows.
```

- [ ] **Step 2: Note it in `CLAUDE.md` § Where things live**

```
src/lib/schedule-edit.ts   ★ moving money between days of a live schedule. Pure, fuzz-tested.
                           Later days absorb the change; paid days are never rewritten.
```

- [ ] **Step 3: Commit**

```bash
git add docs/03-PAYOUT-ENGINE.md CLAUDE.md
git commit -m "docs(payout): document editing a schedule day"
```

---

## Done when

- `npm run typecheck`, `npm run lint` clean.
- `npm test` (full, including both fuzz sweeps) passes.
- `npm run test:db` passes.
- Editing a middle day of an approved case moves the later days only, leaves the total unchanged,
  and refuses to touch a day that has already been paid.
- The figure the browser previews is the figure the server writes.

## Not in this plan

Phase 3 — the Missed / Not-taken-today / Priority / Breached lists — gets its own plan. It reads
schedules but does not write them, so it is independent of this work.
