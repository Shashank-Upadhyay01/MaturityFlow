# MaturityFlow — working notes for future sessions

Context for Claude Code / Cursor / any IDE agent picking this repository up later.
**Read `docs/00-DESIGN-OVERVIEW.md` and `docs/03-PAYOUT-ENGINE.md` before changing anything that
touches money.**

## What this is

A bank maturity-payout control system, built as a **Next.js web application** (App Router,
server actions, Postgres via Drizzle). An agent submits a maturity form; an Operations Head
approves it; **at approval** the server generates an exact, day-by-day payout schedule; cashiers
record what actually goes out against that plan.

It is a web app, not desktop software. There is no packaged binary and no Windows-launcher layer:
the pile of `.bat` files and source-backup archives that used to live here were removed — run it
the way you run any web app (below). The one Windows convenience kept is `start-lan.bat`, a single
launcher for serving branches over the office LAN in Phase 1.

## How this runs — and where it's going

**Locally (this laptop = the developer environment):**

The database is **native Windows PostgreSQL 18 on `localhost:5432`** — already installed, service
`postgresql-x64-18` set to start automatically, and holding the data. Day-to-day you only need:

```bash
npm run dev                 # http://localhost:3000
```

Fresh machine with no local Postgres: `npm install`, create a Postgres 16+ database, point
`DATABASE_URL` at it, then `npm run db:migrate` and — for a demo only — `npm run db:seed` (it
truncates first, so never against real data). A Docker Postgres exists (`docker compose up -d db`)
but binds host port **5433** to avoid clashing with the native one, and is intentionally left
stopped; on this laptop the native `:5432` instance is the single source of truth.

**To branch PCs over the LAN (Phase 1 "production"):** double-click `start-lan.bat` — it builds,
prints the address branches type, and serves on port 3000. In `.env` set
`APP_URL="http://<this-pc-ip>:3000"` and `COOKIE_SECURE=false` (a `Secure` cookie is silently
dropped over plain HTTP, so otherwise nobody can sign in). Details in `README.md`.

**The roadmap — `docs/11-CLOUD-MIGRATION.md` is the runbook:**

1. **Now — the laptop.** This machine both develops and hosts (localhost for you, LAN for
   branches). Postgres runs in Docker here.
2. **Phase 2 — the cloud.** The app deploys to **Vercel** for a 24/7 URL. A Vercel app cannot
   reach a database on your laptop, so the managed database moves in the *same* step: Postgres →
   **Neon/Supabase** (only `DATABASE_URL` changes) and document storage → **blob** (S3/Azure — the
   one code change, in `src/lib/storage.ts`; see "Known gaps"). After this the laptop is purely a
   dev box; the cloud serves everyone 24/7.

   **Status (2026-08-23):** the Supabase Postgres is already provisioned and in sync — project
   `maturityflow` (`fktcubdpsgutcvyfdozt`, ap-south-1), all 17 tables, 10 demo logins. What's left
   is the Vercel import + env vars (needs your accounts). Full runbook: `docs/11-CLOUD-MIGRATION.md`.

**Local DB note:** the app's `.env` points at `localhost:5432`, which on this laptop is
**native Windows PostgreSQL 18** (holds the real 107-case register + demo logins). The
`docker compose` Postgres is deliberately on host port **5433** to avoid clashing with it, and is
currently unused — so `docker compose up -d db` alone does *not* give you the app's data. Migrations
and `test:db` run against 5432.

What keeps this cheap: **every environment-specific setting is read from `.env`, so moving between
laptop, LAN and cloud is configuration, not code** — the single exception being document storage.

## Non-negotiables

These are enforced in code and in the database. Do not weaken them.

1. **Money is `bigint` paise. Everywhere.** No `number`, no `float`, no `Decimal`. The only
   exceptions are `paiseToRupeeNumber()` (chart axes) and `formatPaise()` (display).
2. **`Σ(instalments) === maturityAmount`, exactly.** `generateSchedule()` asserts this at runtime
   and throws `ScheduleIntegrityError` rather than returning a wrong schedule. Never remove that
   assertion.
3. **The client never supplies instalment rows.** It supplies *parameters*
   (amount, days, rounding, cash policy) and the server derives the schedule. Both sides import
   the same pure module, so an honest client sees exactly what the server will write.
4. **Every mutation starts with `requireActor()` then `assertCan()`.** No exceptions.
5. **Every money-affecting mutation writes an audit row in the same transaction.** Never write to
   `audit_log` outside the transaction it describes; never update or delete from it.
6. **`formSubmittedOn` and `approvedOn` are different things.** The schedule and the SLA clock are
   anchored to `approvedOn`. Do not conflate them.
7. **Any writer to a case's instalments or transactions must take the CASE row lock FIRST,
   then re-read the row it is about to change with `.for('update')`.** Lock order is always
   case → instalment/transaction, so concurrent payouts cannot deadlock. Reading the
   instalment *before* the case lock was a real bug: twelve cashiers each saw `paid = 0`,
   queued on the case lock, and each validated against its own stale snapshot — so the same
   day could be paid several times over while the case total still looked correct.
   `tests/integration/concurrency.test.ts` exists to catch exactly this. Run `npm run test:db`
   after touching anything in `payout-service.ts` or `case-service.ts`.
8. **The Register's "due today" figure is computed from every row, never from the filtered
   view.** It is the cash the branch must open with; if it moved when somebody filtered to one
   agent it would be worse than useless. `summariseDueToday()` in `src/lib/register-view.ts` is
   the single definition, it is unit-tested, and nothing should recompute it inline.

9. **A bulk action is a loop over the audited single-row path, never a second faster path.**
   `removeRegisterRowsAction` and friends fan out to `cancelCase` / `setTodayAmount` /
   `setFormSubmitted` — each taking its own case row lock and writing its own audit line. One
   `UPDATE … WHERE id IN (…)` would be one round-trip instead of fifty and would also be the
   first place here where money moved without a lock and without a trail. Each row is attempted
   independently and failures come back in `failed`, because "these forty rows, two of which are
   already paid" is the normal case, not the exception. Per-row `assertCan` too: a selection can
   span branches for an HQ user, so scope is a per-row question.

10. **Removing a register row means cancelling the case, not deleting it.** `listRegister()`
   excludes CANCELLED, so the row leaves the sheet while the case, its events and its audit
   trail stay. `cancelCase()` refuses outright once a rupee has been paid. `case.cancel` is held
   by the roles that can *create* register rows (Admin, Branch Manager, Ops Head, CMD, CEO) —
   a role that can add a hundred blank rows in one click has to be able to take them back.

11. **A `'use server'` module may export only async functions.** Every export is rewritten into a
   server-action reference, so exporting an array or object from one hands the client a *function*
   instead of the value — it fails at runtime with `x.map is not a function`, not at build time.
   Constants a component reads go in a plain module (see `src/lib/documents.ts`).

## Where things live

```
src/lib/payout-engine.ts   ★ the algorithm. Pure, deterministic, no I/O. Read the docs first.
src/lib/money.ts           BigInt paise: parsing, Indian formatting, rounding steps
src/lib/working-days.ts    weekend rules (2nd/4th Saturday), holidays, date maths in UTC
src/lib/payment-rules.ts   pure validation for recording a disbursement (INV-4)
src/lib/rbac.ts            the permission matrix — single source of truth
src/lib/audit.ts           withAudit-style helper; append-only
src/lib/serialize.ts       the bigint → string boundary between server and client
src/lib/storage.ts         document I/O (server-only); src/lib/storage-rules.ts is its pure, tested half
src/lib/documents.ts       document vocabulary — plain constants, NOT in the 'use server' file
src/lib/register-view.ts   ★ pure Register view rules: what counts as due today, which sort a
                           filter implies, which rows a date range covers, what a bulk "set
                           today" writes, Indian digit grouping. tests/register-view.test.ts
src/lib/register-layout.ts Register column catalog: order, widths, Excel header names

src/db/schema.ts           Drizzle schema incl. CHECK constraints (INV-3, INV-4, INV-5)
drizzle/*.sql              generated migrations — plain SQL, reviewable

src/services/*.ts          business operations (case, payout, schedule, calendar, queries)
src/services/register-bulk.ts  fan-out for the Register's ticked-row actions: load scope for the
                           whole selection in one query, run the single-row function per row,
                           collect failures instead of aborting the batch
src/actions/*.ts           server actions: authenticate → authorise → validate → transact → audit
src/app/(app)/*            the screens
src/components/domain/schedule-preview.tsx   the live calculator (client-side, same engine)
```

## Commands

```bash
npm run dev            # dev server
npm run typecheck      # tsc --noEmit, strict
npm test               # vitest: 170 unit tests + 100k-case fuzz (FUZZ_ITERATIONS=1000 to run it fast)
npm run build          # production build
npm run db:migrate     # apply migrations
npm run db:seed        # DESTRUCTIVE — truncates everything, then seeds demo data
npm run test:db        # concurrency tests against a REAL database (needs DATABASE_URL)
node scripts/smoke.mjs # 55-check browser walk-through across all roles (needs the app running)
```

Local database: `docker compose up -d db` (Postgres 16 on 5432).

## Conventions

- **Server Components by default.** `'use client'` only where there is real interactivity.
- Reads go through `src/services/queries.ts`, which applies branch/agent scoping via
  `caseScope(actor)`. Never query a table directly from a component.
- Money crossing to a Client Component goes through `serialize()`; the client re-parses with
  `BigInt(...)`. Money props are typed `bigint | string`.
- New permission? Add it to the `Permission` union **and** to `ROLE_PERMISSIONS` **and**, if it
  is a write, to `WRITE_PERMISSIONS` so `AUDITOR` stays read-only. Then extend `tests/rbac.test.ts`.
- New status transition? Add it to `ALLOWED_TRANSITIONS` in `case-service.ts`. Nothing sets
  `status` directly.
- Styling is Tailwind v4 + the token layer in `src/app/globals.css`. Use `.glass` /
  `.glass-interactive`; do not hand-roll another translucent panel.

## Changing the engine

If you touch `payout-engine.ts`:

1. Run `npm test` — the fuzz suite sweeps 100,000 random cases and asserts INV-2, INV-3, positivity,
   working-day placement, strict date ordering and smoothness (`max − min < 2 × step`).
2. Add a worked example to `docs/03-PAYOUT-ENGINE.md` if the behaviour changed.
3. Keep it **pure** — no `Date.now()`, no randomness, no I/O. Purity is what lets the browser
   preview and the server-persisted schedule be identical.

## Traps this codebase has already sprung

Three real bugs that cost real time. Each is cheap to hit again.

- **`.glass` sets `position: relative`, and `globals.css` is unlayered**, so it beats Tailwind's
  layered `absolute` utility. `className="glass absolute …"` silently renders *in flow* and
  wrecks whatever row it sits in. Position a wrapper, style the panel inside it — see the
  "Add rows" popover in `register-sheet.tsx`.
- **`--color-brand-50 / -100 / -700` are role tokens, not fixed colours**, and they flip in
  `.dark`. 50 and 100 mean "the faintest tint you can lay a surface in"; 700 means "a label that
  stays readable on top of that tint". Printing `--page-fg` on a `--color-brand-50` panel without
  those dark overrides gives light-on-light and the number simply disappears.
- **Hand-written migrations leave drizzle-kit's snapshot stale**, so the next `db:generate`
  re-emits columns that already exist and the migration fails. If you hand-write SQL, write it
  idempotently (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before `ADD`) and prove
  it: migrate a scratch database and diff `information_schema.columns` against a `db:push` one.
  0000–0003 were hand-written; 0004 repairs the drift and the snapshot is correct from there.

## Checking a UI change instead of guessing

`scripts/shot.mjs` logs in and screenshots any page. `scripts/check-register.mjs` drives the
Register the way a clerk would and asserts the filter, the auto-sort and the direction toggle,
for whichever role you name. Run them against a running server before believing a layout change:

```bash
node scripts/shot.mjs /maturities /tmp/x.png admin@bank.test
node scripts/check-register.mjs cashier@bank.test cashier
```

Look at dark mode too. Two of the three traps above were invisible in light mode.

## Known gaps (deliberate, documented in the README)

- No core-banking integration — payouts are recorded, not executed.
- Documents are written to local disk under `STORAGE_ROOT`. Swap `src/lib/storage.ts` for an
  S3/Azure adapter before running more than one app instance — this is the one code change the
  cloud move needs, and `docs/11-CLOUD-MIGRATION.md` walks through it.
- Notification model exists; no sender.
- No maker-checker on payout recording (approval has one).
