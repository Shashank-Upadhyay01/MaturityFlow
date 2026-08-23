# ADR 0004 — Distribute rounding units, not the remainder

**Status:** Accepted · **Date:** 2026-08-18

## Context

The business rule is: every daily payout is a round number, and the last day carries whatever is
left. Implemented naïvely — divide, floor to the rounding step, dump the difference on the final
day — that rule produces schedules the branch cannot actually pay:

```
₹10,00,000 over 15 days, rounded to ₹10,000
  → 14 days × ₹60,000  +  ₹1,60,000 on day 15
```

The final day is 2.6× a normal day. If the branch could hand over ₹1,60,000 in one go, the whole
schedule would be unnecessary.

## Decision

Divide in **units of the rounding step**, not in rupees.

```
units = total / step ;  residue = total % step
q = units / days     ;  r = units % days
→ r days receive (q+1) × step,  (days − r) receive q × step
→ residue is added to the final instalment
```

The spread between the busiest and quietest day is therefore **exactly one rounding step**, and
the final day is at most one step away from a normal day.

```
₹10,00,000 over 15 days, rounded to ₹10,000
  → 10 days × ₹70,000  +  5 days × ₹60,000        Σ exact, every day payable
```

Which days carry the extra unit is configurable: `FRONT_LOADED` (default — the customer gets more
money sooner), `BACK_LOADED`, or `EVEN` (Bresenham spread, flattest daily cash requirement across
a branch).

## Consequences

- The business rule "the last withdrawal is the remaining amount" is still literally true — the
  residue does land on the final day. It is simply never more than one rounding step.
- Smoothness is asserted by the fuzz suite: across 100,000 random cases,
  `max − min < 2 × step` always holds.
- When the amount cannot fill the window at the chosen step (₹3,000 over 15 days at ₹1,000), the
  engine compresses to the days it *can* fill and raises `AMOUNT_TOO_SMALL_FOR_DAYS` rather than
  emitting ₹0 instalments.
