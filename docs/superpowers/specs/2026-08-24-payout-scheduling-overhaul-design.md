# Payout scheduling overhaul — design

**Date:** 2026-08-24
**Status:** approved for planning
**Touches money.** Read `docs/03-PAYOUT-ENGINE.md` first. Nothing here weakens an invariant in
`CLAUDE.md` § Non-negotiables; § 7 below states how each one survives.

---

## 1. Why this is safe to do now

Verified against the live database on 2026-08-24:

| Fact | Count |
|---|---|
| `payout_instalments` rows | **0** |
| cases with `approved_on` set | **0** |
| cases with `deadline_on` set | **0** |
| maturity cases total | 81 (80 SUBMITTED, 1 DRAFT) |

No schedule has ever been generated against real data, so changing how schedules are built
**cannot corrupt an existing one**. There is no data migration and no backfill. This is the
cheapest moment this change will ever be made; it stops being true the first time Ops approves a
case.

Amount distribution in the live register: **53 below ₹1 lakh, 28 at or above**, none exactly at
₹1,00,000.

---

## 2. Decisions taken

Four questions were put to the product owner. The answers are settled and are not open in
planning:

| # | Question | Decision |
|---|---|---|
| D1 | Window counted in working or calendar days | **Working days.** Sundays, 2nd/4th Saturdays and holidays never count and never carry a payout. |
| D2 | The ₹1 lakh boundary | **`maturityAmountPaise >= 10_000_000n`.** Exactly ₹1,00,000 is a large case: pays daily, appears on the priority list. |
| D3 | Sub-₹1-lakh span | **Same 15-working-day deadline.** Alternate days *inside* the same window → 6 payouts, not a longer schedule. One breach rule for every case. |
| D4 | Which days absorb a manual edit | **Later unpaid days only.** Paid and part-paid rows are immutable; days before the edited one keep the figures the branch has already planned cash against. |

---

## 3. The window model

Let `W0` be the approval date, rolled forward to the next working day if approval lands on a
non-working day. Working days are then counted `W0, W1, W2, …`, skipping non-working days
entirely.

```
W0  W1  W2 │ W3  W4  W5  W6  W7  W8  W9  W10 W11 W12 W13 W14
└─ processing ┘ └──────────── 12 withdrawal days ────────────┘
   (3 days)                                        deadline = W14
```

- The window is **15 working days inclusive of the approval day**. 3 + 12 = 15.
- **Daily** (`>= ₹1,00,000`): payouts on `W3 … W14` → **12 instalments**.
- **Alternate** (`< ₹1,00,000`): payouts on `W3, W5, W7, W9, W11, W13` → **6 instalments**,
  finishing on `W13`, one working day inside the deadline.

`deriveDeadline(approvalDate, 15, calendar)` already returns `W14` — it collects 15 working days
from the anchor inclusive and takes the last. **`deriveDeadline` needs no change.**

### `windowDays` changes meaning

Today `windowDays` (column `maturity_cases.window_days`, default 15) means "number of payout
days". It becomes **the total window**, with:

```
processingDays = 3                       (constant, see § 8)
payoutDays     = windowDays - processingDays
```

A branch that sets `defaultWindowDays = 20` therefore gets 17 payout days, so the rule
generalises rather than hard-coding 12. This is a semantic change to a column read by
`import-service.ts` and four functions in `queries.ts`; it is harmless today only because no case
is approved (§ 1). **Every read site is listed in § 6.4 and must be reviewed during implementation.**

---

## 4. What does NOT change

This is the load-bearing part of the design.

`generateSchedule` Steps 1–6 — rounding units, the `q`/`r` split, which days get the extra unit,
**re-attaching the residue to the last instalment**, and the `Σ(instalments) === totalPaise`
assertion — are **untouched**.

In particular, the requirement *"if the maturity amount is not in round digits, divide them so the
odd amount comes at the last withdrawal"* is **already implemented** as Step 5 and documented as
worked example C in `docs/03-PAYOUT-ENGINE.md`. No work is needed for it and none will be done to
it.

Cadence changes only:

- **Step 7**, date assignment — which working days the instalments land on;
- the **instalment count** passed in as `days`.

The money arithmetic never learns that cadence exists.

---

## 5. Phase 1 — the engine

### 5.1 New pure module: `src/lib/payout-policy.ts`

The engine stays mechanical and policy-free; the ₹1 lakh rule is business policy and lives on its
own, unit-tested.

```ts
export const LARGE_CASE_THRESHOLD_PAISE = 10_000_000n;   // ₹1,00,000
export const PROCESSING_WORKING_DAYS = 3;

export type Cadence = 'DAILY' | 'ALTERNATE';

export function isPriorityCase(maturityAmountPaise: bigint): boolean;   // >= threshold
export function cadenceFor(maturityAmountPaise: bigint): Cadence;
export function strideFor(cadence: Cadence): 1 | 2;

export interface PayoutPlan {
  cadence: Cadence;
  processingDays: number;   // PROCESSING_WORKING_DAYS
  payoutDays: number;       // instalment count
  stride: 1 | 2;
}

/** windowDays is the TOTAL window (default 15). */
export function payoutPlanFor(maturityAmountPaise: bigint, windowDays: number): PayoutPlan;
```

`payoutDays` for `ALTERNATE` is `ceil((windowDays - processingDays) / 2)` — 6 when
`windowDays = 15`. Placing 6 payouts at stride 2 from `W3` ends at `W13`, inside the window;
the module asserts this rather than assuming it.

Guard: if `windowDays - processingDays < 1`, throw. A 3-day window has no room to pay anything,
and silently producing a one-day schedule would hide a misconfigured branch.

### 5.2 `collectWorkingDays` gains a stride

`src/lib/working-days.ts`:

```ts
export function collectWorkingDays(
  start: ISODate,
  count: number,
  cal: WorkingDayCalendar,
  stride = 1,          // NEW — 1 = every working day, 2 = every other
): ISODate[]
```

Implementation: walk working days as today, but push only when the working-day index is a
multiple of `stride`. `stride = 1` is the existing behaviour exactly, so all current callers are
unaffected. `stride < 1` or non-integer throws `CalendarError`.

### 5.3 `generateSchedule` gains two inputs

`ScheduleInput` adds:

```ts
/** 1 = consecutive working days (default). 2 = every other working day. */
stride?: number;
/** Working days to skip after the anchor before the first payout. Default 0. */
startOffsetWorkingDays?: number;
```

Step 7 becomes: collect `startOffsetWorkingDays + 1` working days from the anchor, take the last
as the payout anchor, then `collectWorkingDays(payoutAnchor, effectiveDays, calendar, stride)`.

Both default to the current behaviour (`stride = 1`, `startOffsetWorkingDays = 0`), so the live
schedule preview and every existing test keep passing unchanged.

`startOnNextWorkingDay` stays as-is. Note `docs/03-PAYOUT-ENGINE.md` § 1 calls this field
`firstDayIsStartDate`, which is **stale** — the code has always called it `startOnNextWorkingDay`.
Fix the doc while in there.

### 5.4 Schema

One new column, generated with `drizzle-kit generate` (never hand-written — see the migration trap
in `CLAUDE.md`):

```sql
CREATE TYPE payout_cadence AS ENUM ('DAILY', 'ALTERNATE');
ALTER TABLE maturity_cases ADD COLUMN cadence payout_cadence NOT NULL DEFAULT 'DAILY';
```

Cadence is **persisted at approval, not re-derived on read**. The maturity amount is editable; a
reschedule months later must not silently flip a case from alternate to daily because someone
corrected a figure. `persistSchedule` writes it; `persistReschedule` and `persistReplanWindow`
read it and keep it.

### 5.5 Call sites

`src/services/schedule-service.ts` is the only place that builds a schedule. `persistSchedule`
calls `payoutPlanFor(caseRow.maturityAmountPaise, caseRow.windowDays)` and passes
`days: plan.payoutDays`, `stride: plan.stride`,
`startOffsetWorkingDays: plan.processingDays` into `generateSchedule`. `persistReschedule` uses
the stored `cadence` and the working days remaining before `deadlineOn`.

---

## 6. Phase 2 — editable schedule with live rebalance

### 6.1 New pure module: `src/lib/schedule-edit.ts`

```ts
export interface EditableInstalment {
  seq: number;
  dueOn: ISODate;
  amountPaise: bigint;
  paidPaise: bigint;      // paidCash + paidOnline
  isFinal: boolean;
}

export type RebalanceError =
  | 'EDITED_ROW_ALREADY_PAID'
  | 'NO_LATER_UNPAID_DAYS'
  | 'AMOUNT_EXCEEDS_REMAINING'
  | 'AMOUNT_BELOW_ALREADY_PAID'
  | 'NEGATIVE_AMOUNT';

export type RebalanceResult =
  | { ok: true; instalments: EditableInstalment[] }
  | { ok: false; error: RebalanceError; message: string };

export function rebalanceAfter(
  instalments: readonly EditableInstalment[],
  seq: number,
  newAmountPaise: bigint,
  roundingPaise: bigint,
): RebalanceResult;
```

Rules, in order:

1. `newAmountPaise < 0n` → `NEGATIVE_AMOUNT`. Zero is allowed: a clerk may empty a day.
2. A **fully paid** row (`paidPaise >= amountPaise`) is immutable → `EDITED_ROW_ALREADY_PAID`.
3. A **part-paid** row may be edited, but never below what has already gone out against it:
   `newAmountPaise < paidPaise` → `AMOUNT_BELOW_ALREADY_PAID`. Cutting a part-paid day down to
   exactly what was handed over, and pushing the rest later, is a normal counter correction and
   must be allowed.
4. `delta = oldAmount - newAmount` spreads across **later rows only**, using the engine's own
   unit-distribution so every row stays a whole multiple of `roundingPaise` and the residue lands
   on the final row. A later row that is part-paid can absorb a reduction only down to its own
   `paidPaise`; a later row that is fully paid absorbs nothing and is skipped.
5. No later row can absorb anything → `NO_LATER_UNPAID_DAYS`. The clerk must edit an earlier day
   or reschedule the case.
6. The later rows cannot absorb `delta` without some row falling below its `paidPaise` →
   `AMOUNT_EXCEEDS_REMAINING`.
7. **`Σ(all instalments)` is re-asserted before returning.** A mismatch throws
   `ScheduleIntegrityError`, exactly as the engine does. A wrong schedule must never exist, even
   transiently, even in the browser.

Returning a typed error rather than throwing for cases 1–6 is deliberate: these are things a clerk
does by accident many times a day, and they need a message, not a stack trace. Case 7 is an
arithmetic bug and must be loud.

### 6.2 Live preview, one save

The browser imports `schedule-edit.ts` directly and re-renders as the clerk types — the same
client/server-parity trick `schedule-preview.tsx` already uses for `generateSchedule`. Nothing is
persisted while typing.

**Save** calls a new server action which:

1. `requireActor()` → `assertCan(actor, 'schedule.override', caseRef)`;
2. takes the **CASE row lock first**, then re-reads the instalments with `.for('update')`
   (non-negotiable § 7 — lock order is always case → instalment);
3. recomputes the rebalance **server-side from the re-read rows**, ignoring the client's numbers.
   The client supplies `(seq, newAmountPaise)` — *parameters* — and the server derives the
   schedule (non-negotiable § 3);
4. supersedes the current `scheduleVersion` and inserts the new one, as `persistReschedule`
   already does, so history is kept;
5. writes an audit row **in the same transaction** (non-negotiable § 5).

One version per save, not per keystroke.

### 6.3 Why a new version rather than an in-place update

`payout_instalments` already models supersession (`scheduleVersion`, `supersededAt`, status
`SUPERSEDED`) and `persistReschedule` uses it. Re-using it keeps one story for "how the plan
changed" and keeps the audit trail readable. The cost is rows; the benefit is that "what did we
promise this customer on Tuesday" stays answerable.

### 6.4 `windowDays` read sites to review

`import-service.ts:153`, `queries.ts:410`, `queries.ts:457`, `queries.ts:672`, `queries.ts:697`,
`queries.ts:929`, `register-service.ts:120`, `case-service.ts:115/173/195/256/289/497`. Each must
be checked for whether it means "total window" or "payout days" under the new definition.

---

## 7. Phase 3 — the four lists

One screen, `/follow-up`, four tabs sharing a row shape. All queries go through
`caseScope(actor)`; none touches a table directly from a component.

| Tab | Rows | Columns beyond identity |
|---|---|---|
| **Missed** | instalments due before today, `PENDING`/`PARTIAL` | paid to date, remaining, days overdue |
| **Not taken today** | instalments due today, unpaid at read time | today's amount, cash/online split, agent |
| **Priority (≥ ₹1L)** | live cases at or above the threshold, grouped by agent | count withdrawable today, withdrawn to date, remaining |
| **Breached** | cases past `deadlineOn` with remaining > 0 | approved on, deadline, days past, remaining |

Summarising arithmetic goes in pure, unit-tested helpers beside `summariseDueToday()` in
`register-view.ts` — never recomputed inline in a component (non-negotiable § 8's rule, applied to
the new figures).

### 7.1 Missed is derived, not stored

`markMissedInstalments` exists in `schedule-service.ts:261` and **has no callers anywhere in the
codebase** — verified by grep. That is why no instalment is ever `MISSED`.

The obvious fix is to call it when these lists are read. **This design does not do that.** It
would be a write on a read path: it mutates rows, it needs a transaction on every page view, it
would fire from any role holding `case.view` including the read-only Auditor, and it changes
stored state without an audit row.

Instead the lists **derive** missed-ness from the predicate the function itself uses:

```sql
due_on < :today AND status IN ('PENDING', 'PARTIAL')
```

That is the same answer, needs no write, no transaction and no scheduler, and cannot drift from
the stored column because it does not consult one. `instalment_status.MISSED` and
`markMissedInstalments` stay in place for a future scheduled job; they are simply not on this
path. The predicate lives in one exported helper so the four tabs cannot disagree about what
"missed" means.

### 7.2 Permissions

All four tabs need `case.view` only; the export buttons need `report.export`. No new permission is
introduced, so `ROLE_PERMISSIONS`, `WRITE_PERMISSIONS` and `tests/rbac.test.ts` are untouched.

---

## 8. Invariants and how each survives

| Non-negotiable | How this design honours it |
|---|---|
| 1. bigint paise everywhere | No new money type. `schedule-edit.ts` is `bigint`-only. |
| 2. `Σ(instalments) === maturityAmount` | Untouched in the engine; re-asserted in `rebalanceAfter` and again server-side before persisting. |
| 3. Client never supplies instalment rows | The client sends `(seq, newAmountPaise)`; the server re-derives from re-read rows. |
| 4. `requireActor()` then `assertCan()` | The new action starts with both. |
| 5. Audit in the same transaction | The save writes its audit row inside the same tx. |
| 6. `formSubmittedOn` ≠ `approvedOn` | The window anchors on `approvedOn`. Unchanged. |
| 7. Case row lock first, then re-read `.for('update')` | Stated explicitly in § 6.2 step 2. |
| 8. Due-today computed from every row | The new lists add figures; they do not recompute `summariseDueToday`. |
| 9. Bulk = loop over the audited single-row path | No bulk path is added in this design. |
| 10. Removing a row is a cancellation | Unchanged. |
| 11. `'use server'` exports only async functions | `payout-policy.ts` and `schedule-edit.ts` are plain modules, not server files. |

---

## 9. Testing

| Suite | Additions |
|---|---|
| `tests/payout-policy.test.ts` (new) | Threshold at exactly ₹1,00,000 (D2), cadence mapping, `payoutDays` for both cadences, the `windowDays - processingDays < 1` throw. |
| `tests/working-days.test.ts` | `stride = 2` spacing, `stride = 1` identical to today, stride across holidays and month boundaries, invalid stride throws. |
| `tests/payout-engine.test.ts` | The worked window of § 3 for both cadences; `startOffsetWorkingDays` placing the first payout on `W3`; defaults unchanged. |
| `tests/payout-engine.fuzz.test.ts` | Across 100k cases: consecutive payout dates differ by exactly one working day (DAILY) or exactly two (ALTERNATE); every payout falls on a working day inside the window; INV-2 and INV-3 still hold. |
| `tests/schedule-edit.test.ts` (new) | Each `RebalanceError`; paid rows never change; total never moves; rows stay multiples of the step; residue on the final row. Fuzzed. |
| `tests/register-view.test.ts` | The new list summaries. |
| `npm run test:db` | Re-run after touching anything under `services/` — the concurrency suite guards the lock order. |

A browser pass with `scripts/shot.mjs` on `/follow-up` in **both themes**, per the trap notes.

---

## 10. Sequencing

Three phases, each shippable and independently verifiable:

1. **Engine** — `payout-policy.ts`, `collectWorkingDays` stride, `generateSchedule` inputs,
   `cadence` column, `persistSchedule` wiring. Proven by unit + fuzz suites before any UI exists.
2. **Editing** — `schedule-edit.ts`, the save action, the case detail UI.
3. **Lists** — queries, summaries, `/follow-up`.

Phase 1 must land first: Phases 2 and 3 both read what it produces.

---

## 11. Non-goals

- The 3-day processing offset is a **constant**, not a branch setting. Making it configurable is a
  later change if asked for.
- No cron or scheduler is introduced (§ 7.1).
- No change to how payouts are *recorded* — only to how they are *planned*.
- No maker-checker is added to schedule editing; it inherits `schedule.override`, which today is
  held by Admin, Ops Head, Branch Manager, Cashier, CMD and CEO.
