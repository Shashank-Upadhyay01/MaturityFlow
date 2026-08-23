# ADR 0002 — Drizzle ORM rather than Prisma

**Status:** Accepted · **Date:** 2026-08-18

## Context

The schema was first written for Prisma. Prisma downloads platform-specific **native engine
binaries** at install time (`schema-engine`, `query-engine`). In the build environment those
downloads were blocked, so the schema could neither be generated nor migrated — meaning the
application could not be verified end-to-end before delivery.

## Decision

Use **Drizzle ORM** with the `pg` driver.

## Why this is the better choice regardless

1. **No binary download step.** Pure TypeScript. `npm install` on a locked-down bank network
   cannot half-fail.
2. **CHECK constraints are first-class.** Drizzle expresses them in the schema, so INV-3 and INV-4
   are enforced by Postgres itself — a hand-written `UPDATE` cannot corrupt the ledger. Prisma has
   no native CHECK support.
3. **`SELECT … FOR UPDATE` is first-class** (`.for('update')`), which is exactly what payout
   recording needs to serialise concurrent cashiers.
4. **The generated SQL is the SQL.** For a system an auditor may inspect, a thin, legible query
   layer is worth more than a clever one.
5. Smaller runtime, faster cold start.

## Consequences

`bigint` defaults must be written as `sql\`100000\`` rather than `100000n`, because `drizzle-kit`
serialises the schema snapshot to JSON and `JSON.stringify` cannot serialise a `BigInt`. This is
noted in `src/db/schema.ts`.

Migrations are plain `.sql` files in `drizzle/` — readable, reviewable, and applicable with `psql`
if the tooling is ever unavailable.
