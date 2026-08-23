# ADR 0001 — Money is `bigint` paise, everywhere

**Status:** Accepted · **Date:** 2026-08-18

## Context

The system moves real money and its central operation is division: split ₹X across N days. Any
floating-point representation makes `Σ(parts) === total` an approximate claim rather than a
guaranteed one.

`0.1 + 0.2 !== 0.3` is not an abstract concern when the result is what a customer is handed at a
counter.

## Decision

Every monetary value is an **integer number of paise held in a `bigint`** — in the database
(`BIGINT`), in the engine, in the services, in the components. There is not a single
floating-point money value in the system.

- Parsing: `parseRupeesToPaise()` works on the string digit-by-digit; the value never passes
  through a float, even when the input arrives as a JS `number` (guarded to `2^53/100`).
- Display: `formatPaise()` splits into whole rupees and paise and formats with `en-IN` grouping.
- Charts: `paiseToRupeeNumber()` exists and is documented as display-only — never fed back into a
  calculation.
- RSC boundary: `serialize()` converts `bigint` → decimal string; the client re-parses with
  `BigInt(...)`.

## Consequences

**Good.** `Σ = total` is exact by construction and asserted at runtime. Postgres `BIGINT` gives
headroom to ~₹9×10¹⁶. Comparisons and sums in SQL are exact too.

**Cost.** `bigint` is not JSON-serialisable, so a boundary conversion is needed — which is why
`serialize.ts` exists and why every money prop is typed `bigint | string`.

**Rejected alternatives.** `NUMERIC`/decimal.js — correct, but every arithmetic operation becomes
a method call and the type system stops helping; the failure mode is a silently-mixed
`number`/`Decimal` expression. Storing rupees as floats — never seriously considered.
