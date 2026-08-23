# The Payout Schedule Engine

`src/lib/payout-engine.ts` — the arithmetic heart of MaturityFlow.
Pure, deterministic, dependency-free, `BigInt`-only. Runs identically on client and server.

---

## 1. Contract

```ts
generateSchedule(input: ScheduleInput): ScheduleResult
```

**Pure.** Same input → same output, forever. No `Date.now()`, no randomness, no I/O.
This is what allows the browser preview and the server-persisted schedule to be identical.

### Input

| Field | Type | Meaning |
|---|---|---|
| `totalPaise` | `bigint` | Maturity amount, in paise. `₹5,00,000` → `50000000n`. |
| `days` | `number` | "Give within N days" — **working** days. |
| `roundingPaise` | `bigint` | Installments are multiples of this. `₹1,000` → `100000n`. |
| `startDate` | `ISODate` | Anchor = approval date. Rolled forward if non-working. |
| `calendar` | `WorkingDayCalendar` | Weekend policy + holiday set. |
| `distribution` | `FRONT_LOADED \| BACK_LOADED \| EVEN` | Where the "heavier" days sit. Default `FRONT_LOADED`. |
| `cashPolicy` | `CashPolicy` | `CASH_ONLY` / `ONLINE_ONLY` / `CASH_CAP` with `cashCapPerDayPaise`. |
| `firstDayIsStartDate` | `boolean` | Pay from the approval day itself (default) or from the next working day. |

### Output

```ts
{
  installments: Array<{
    seq, dueDate, amountPaise, cashLegPaise, onlineLegPaise, isFinal
  }>,
  totalPaise, effectiveDays, typicalDailyPaise, finalInstallmentPaise,
  totalCashPaise, totalOnlinePaise, firstPayoutDate, lastPayoutDate,
  warnings: ScheduleWarning[]
}
```

---

## 2. The distribution algorithm

### Step 0 — Preconditions (throw, do not guess)

```
totalPaise    > 0n
days          >= 1  and integer
roundingPaise >= 1n
```

### Step 1 — Convert money to *rounding units*

The whole trick: stop thinking in rupees, think in units of the rounding step.

```
units   = totalPaise / roundingPaise        (integer division)
residue = totalPaise % roundingPaise        (the un-roundable tail)
```

`residue` is money that cannot be expressed as a whole rounding step — e.g. ₹5,00,000.50 with a
₹1,000 step leaves a ₹0.50 residue. It is parked and re-attached in Step 5.

### Step 2 — Degrade gracefully when the amount is too small

```
if units == 0n            → effectiveDays = 1, one installment of totalPaise
                            warn: ROUNDING_STEP_EXCEEDS_AMOUNT
else if units < days       → effectiveDays = Number(units)
                            warn: AMOUNT_TOO_SMALL_FOR_DAYS  (e.g. ₹3,000 cannot fill 15 days
                            at a ₹1,000 step — it fills 3)
else                       → effectiveDays = days
```

Never silently emits a ₹0 installment. Never silently ignores the user's chosen `days` either —
it warns, visibly, in the UI.

### Step 3 — Split the units

```
q = units / effectiveDays        // base units every day gets
r = units % effectiveDays        // leftover units — exactly r days get one extra
```

So `r` days receive `(q + 1) × roundingPaise` and `(effectiveDays − r)` days receive
`q × roundingPaise`. Every installment is therefore a whole multiple of the rounding step, and the
spread between the largest and smallest day is **exactly one rounding step**. This is what kills
the lumpy-last-day problem.

### Step 4 — Decide *which* days get the extra unit

| Mode | Rule | Use when |
|---|---|---|
| `FRONT_LOADED` *(default)* | first `r` days | Customer-friendly: more money earlier. |
| `BACK_LOADED` | last `r` days | Branch is cash-tight in the first week. |
| `EVEN` | Bresenham spread: day *i* gets the extra iff `floor((i+1)·r / n) > floor(i·r / n)` | Flattest possible daily cash requirement across the branch. |

### Step 5 — Re-attach the residue

```
installments[last].amountPaise += residue
```

Matches the existing business rule verbatim: *"in the last withdrawal the remaining amount will be
given."* Because `residue < roundingPaise`, the final day is at most one rounding step away from a
normal day — never a shock.

### Step 6 — Assert the invariant, hard

```ts
const sum = installments.reduce((a, i) => a + i.amountPaise, 0n);
if (sum !== totalPaise) throw new ScheduleIntegrityError(...);
```

This is not a test — it is a runtime assertion that ships to production. If the arithmetic is ever
wrong, the schedule refuses to exist rather than paying out a wrong number. **INV-2.**

### Step 7 — Assign working-day dates

Walk forward from `startDate`, skipping Sundays, 2nd/4th Saturdays and holidays, until
`effectiveDays` dates are collected. (`docs/02-DOMAIN-MODEL.md` § Working days.)

### Step 8 — Split each installment into cash and online legs

```
CASH_ONLY    → cash = amount,                     online = 0
ONLINE_ONLY  → cash = 0,                          online = amount
CASH_CAP(C)  → cash = min(amount, C),             online = amount − cash
```

Asserted per row: `cash + online === amount` (**INV-3**).

---

## 3. Worked examples

### A. The case from the brief — ₹5,00,000 in 15 days, ₹1,000 step

```
units   = 50000000 / 100000 = 500
residue = 0
q = 500 / 15 = 33      r = 500 % 15 = 5

→ 5 days  × 34 units = ₹34,000   (days 1–5, FRONT_LOADED)
→ 10 days × 33 units = ₹33,000   (days 6–15)
Σ = 5×34,000 + 10×33,000 = 1,70,000 + 3,30,000 = ₹5,00,000  ✓
```

Spread between busiest and quietest day: **₹1,000**.

### B. Why unit-distribution matters — ₹10,00,000 in 15 days, ₹10,000 step

```
Naïve (floor-then-dump):   14 × ₹60,000  +  ₹1,60,000 on the last day     ✗ unpayable last day
MaturityFlow:              10 × ₹70,000  +   5 × ₹60,000                  ✓ every day payable
```

### C. Residue — ₹1,00,750.50 in 10 days, ₹1,000 step

```
totalPaise = 10075050 paise
units   = 10075050 / 100000 = 100,   residue = 75050 paise (₹750.50)
q = 100 / 10 = 10,  r = 0
→ 10 units × ₹1,000 = ₹10,000 per day, and the last day carries the residue → ₹10,750.50
Σ = 9 × ₹10,000 + ₹10,750.50 = ₹1,00,750.50  ✓
```

### D. Amount too small for the window — ₹3,000 in 15 days, ₹1,000 step

```
units = 3 < days = 15
→ effectiveDays = 3:  ₹1,000 × 3
warning: AMOUNT_TOO_SMALL_FOR_DAYS — "₹3,000 at a ₹1,000 rounding step fits 3 days, not 15.
         Lower the rounding step to spread it further."
```

### E. Cash cap — ₹5,00,000 in 15 days, ₹1,000 step, ₹20,000/day cash cap

```
Day 1–5 : ₹34,000  →  cash ₹20,000  +  online ₹14,000
Day 6–15: ₹33,000  →  cash ₹20,000  +  online ₹13,000
Total cash   = 15 × ₹20,000 = ₹3,00,000   ← this is what the branch must have in the drawer
Total online = ₹2,00,000
```

That `₹3,00,000` figure, summed across every live case in a branch for a given date, **is** the
Cash Opening Planner.

---

## 4. Rescheduling (reality vs plan)

When an installment is missed or short-paid, history is never rewritten. Instead:

```ts
rescheduleRemaining({ remainingPaise, remainingWorkingDays, fromDate, ...sameParams })
```

which is just `generateSchedule` applied to what is left, from tomorrow, over the working days
still inside the promised window. Two outcomes:

- **Recoverable** — the remaining days can absorb the remaining amount → new plan, same end date,
  slightly heavier days. A `RESCHEDULED` audit entry records who, when and why.
- **Not recoverable** — the remaining amount cannot fit before the deadline at this cash cap →
  the engine returns `warnings: [SLA_BREACH_UNAVOIDABLE]` and the case is flagged red on the Ops
  dashboard *before* the customer finds out.

That second branch is the whole point: the system surfaces the breach **days in advance** instead
of on the day it happens.

---

## 5. Test strategy

| Suite | What it proves |
|---|---|
| `tests/money.test.ts` | Rupee↔paise parsing is exact for every pathological string (`"1,00,000.5"`, `".5"`, `"1e3"` rejected…). |
| `tests/working-days.test.ts` | 2nd/4th Saturday logic, holiday skipping, month/year boundaries, leap years. |
| `tests/payout-engine.test.ts` | Every worked example above, every warning path, every distribution mode. |
| `tests/payout-engine.fuzz.test.ts` | **100,000 random cases** — amounts ₹1 → ₹50 Cr, days 1→60, steps ₹1/₹100/₹500/₹1,000/₹10,000. Asserts INV-2, INV-3, every installment > 0 and a whole multiple of the step (bar the residue day), max−min ≤ one step. |
| `tests/invariants.test.ts` | Over-payment rejection, idempotent approval, schedule-before-approval rejection. |

If any of these fail, the build fails. There is no path to production around them.
