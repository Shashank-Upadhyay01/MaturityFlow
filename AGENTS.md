# KGGNL Core — working notes for future sessions

Context for Codex / Cursor / any IDE agent picking this repository up later.
**Read `docs/00-DESIGN-OVERVIEW.md` and `docs/03-PAYOUT-ENGINE.md` before changing anything that
touches money.**

## What this is

A banking operations platform, built as a **Next.js web application** (App Router, server actions,
Postgres via Drizzle). The public product name is **KGGNL Core**; the repository, deployment and
some internal technical identifiers retain the original `MaturityFlow` name. Its maturity workflow
starts when an agent submits a form; an Operations Head
approves it; **at approval** the server generates an exact, day-by-day payout schedule; cashiers
record what actually goes out against that plan.

It is a web app, not desktop software. There is no packaged binary and no Windows-launcher layer:
the pile of `.bat` files and source-backup archives that used to live here were removed — run it
the way you run any web app (below). The one Windows convenience kept is `start-lan.bat`, a single
launcher for serving branches over the office LAN in Phase 1.

## How this runs — and where it's going

**Locally (this laptop = the developer environment):**

The database is **native Windows PostgreSQL 18 on `localhost:5432`** — already installed, service
`postgresql-x64-18` set to start automatically, and holding the data.

**Editing code vs. using the app are two different commands. Do not confuse them:**

```bash
npm run dev                        # EDITING code — hot reload, http://localhost:3000
npm run build && npm run start     # USING the app for real work — same URL, ~100x faster
```

`next dev` compiles each route the first time it is opened and re-compiles on any file change,
and on this Windows laptop that is not a small tax: measured on the real 80-case register,
`/maturities` took **71s** and `/api/export/template` took **90s** in dev versus **0.9s** and
**0.2s** built. The database is not involved either way — the register query plans out at
**0.5ms**. So if someone reports "the app takes minutes to open a page", check which of the two
commands is running *before* looking for a query to optimise. The cost of the built mode is that
a code change needs `npm run build` again; that is the right trade whenever the machine is being
used as the branch's server rather than as an editor.

Never run `next build` while `next dev` is running, or vice versa — they share `.next`, and the
loser serves 404s for its own chunks until you delete `.next` and restart.

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

   **Status (2026-09-01):** production is live at `https://kggnl.in` on Vercel project
   `maturityflow`, deploying `payout-cadence-phase-1`. Supabase project `maturityflow`
   (`fktcubdpsgutcvyfdozt`, ap-south-1) has all 21 tables through migration 0008. Read
   `docs/16-GO-LIVE-STATUS-2026-09-01.md` before any production or data operation.

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
6. **The schedule anchors to the customer's maturity date, not to any staff action.**
   `scheduleAnchorFor()` is the single definition: maturity + 3 CALENDAR days, never earlier than
   today, rolled to the next open day. Calendar days because it is a promise the customer checks
   on a wall calendar; never-earlier-than-today because the register holds cases that matured in
   2024 and a schedule generated into the past is overdue before it exists. `formSubmittedOn` is
   when the agent handed the form in and is not an anchor. `approvedOn` survives as the column
   holding that anchor and as the SLA clock's start; `approvedById IS NULL` marks a case the
   system scheduled rather than a person approved. **Operations review is an acknowledgement,
   never a payment gate**: `opsReviewedOn` / `opsReviewedById` record the human Day-3 check, while
   an empty value is derived into the Maturities “Not reviewed” list and payment still progresses
   automatically. `submitCase()` schedules, and `createCase({ submitNow: true })` goes through the same helper.
   See `docs/adr/0005-schedule-anchored-to-maturity.md`.
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

12. **The Daily Cashbook is its own ledger, never a second Register view.** Read
    `docs/12-DAILY-CASHBOOK.md` and `docs/adr/0006-daily-cashbook-ledger.md` before changing it.
    Do not reuse `register_days`: Register close has maturity-only side effects. Ordinary movements
    are category + channel entries, so one Renewal projects into Renewal and either Receiving or
    By Account without duplicate typing. Derived totals are not stored while the day is open.

13. **The cashbook formula has one definition: `calculateDailyCashbook()`.** It is BigInt paise and
    the sign is `cash in hand − expected physical`: negative is Short, positive is Extra, zero
    Matches. Receiving and Renewal are report projections and are not added to Total Amount. The
    exact attached-sheet example is pinned in `tests/daily-cashbook.test.ts`; do not recompute any
    of these figures inline in a page, query or export.

14. **Every cashbook child writer locks the CASHBOOK DAY first, then the entry/commitment.** The
    lifecycle is OPEN → CLOSE_REQUESTED → CLOSED. Final close must re-read and recompute on the
    server, then store the string-only snapshot in the same locked transaction. Non-zero difference
    requires an explanation; reopening requires a reason. Later settlement of a carried named item
    must never rewrite its source day's closed snapshot.

15. **Cashbook obligations are named but reporting-only.** Given Cash, Due Amount and Pending
    Withdrawal require a person/customer name and can carry forward until settled. They never
    silently change Expected Physical Cash. Payout Desk and Cash Planner figures are diagnostics
    too: show variances, never auto-post an entry or “correct” the book from another subsystem.

16. **Compiled imports route by an exact branch identity, never a guess.** Read
    `docs/13-COMPILED-BRANCH-IMPORT.md` before changing register import or visibility. Admin, CEO
    and CMD may upload an all-branch workbook and see the compiled bank; branch staff remain at
    their assigned branch and agents at their own portfolio. Blank/unknown branch references are
    skipped and reported — never default them silently to Azamgarh and never create branches from
    workbook text.

17. **An upcoming maturity forecast is not a payout case.** Read
    `docs/14-MATURITY-FORECAST.md` before changing the maturity calendar/import. Forecast rows do
    not have a form-submission date and live in `maturity_forecasts`; never fabricate that date to
    push them into `maturity_cases`. Current/next month views are derived from `maturity_on`, and
    re-import of the same workbook must remain idempotent and audited. In the supplied August
    worksheet, `MaturityAmount` is the final manually completed figure and already includes 8.50%
    interest; all of its maturity dates are explicitly 2026-08-29. September and later worksheets
    use `Current Maturity Amount` and retain their supplied maturity dates. Forecast import never
    auto-creates payout cases. The explicitly authorised August testing activation is performed by
    `scripts/activate-maturity-forecast.ts`, which fans out through audited `createCase({ submitNow:
    true })`; keep it idempotent and never replace it with a bulk insert.

## Where things live

```
src/lib/payout-engine.ts   ★ the algorithm. Pure, deterministic, no I/O. Read the docs first.
src/lib/payout-policy.ts   ★ the ₹1 lakh rule: cadence, payout count — and `scheduleAnchorFor()`,
                           which decides the day a schedule starts. Pure. The engine stays
                           policy-free so a rule change cannot reach the money.
src/lib/schedule-edit.ts   ★ moving money between days of a live schedule. Pure, fuzz-tested.
                           Later days absorb the change; paid days are never rewritten.
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
src/lib/daily-cashbook.ts  ★ pure daily-cash arithmetic, projections, denominations and vocabulary

src/db/schema.ts           Drizzle schema incl. CHECK constraints (INV-3, INV-4, INV-5)
drizzle/*.sql              generated migrations — plain SQL, reviewable

src/services/*.ts          business operations (case, payout, schedule, calendar, queries)
src/services/register-bulk.ts  fan-out for the Register's ticked-row actions: load scope for the
                           whole selection in one query, run the single-row function per row,
                           collect failures instead of aborting the batch
src/services/cashbook-service.ts  parent-day-first locked writes, audit and close snapshots
src/actions/*.ts           server actions: authenticate → authorise → validate → transact → audit
src/app/(app)/*            the screens
src/app/(app)/cashbook/*   daily cash workbench plus the A4 Save-as-PDF view
src/app/api/export/cashbook/*  no-store Excel/CSV and privacy-limited PNG summary
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
- **ADMIN holds every permission** (`new Set(ALL)`), by design — it is the account that must be
  able to see and do anything any other role can. So for Admin alone the maker-checker split that
  `case.approve` gives everywhere else does not apply: an Admin can approve a case and then pay it
  out. The audit row written in the same transaction is what keeps that reviewable. A new
  permission is therefore granted to Admin automatically; `tests/rbac.test.ts` asserts both that
  Admin has all of them and that no other role holds one Admin lacks.
- **Every screen belongs in `NAV`.** `/payouts` and `/maturities/new` existed for months with no
  link anywhere — whole features reachable only by typing the URL, and `getNavBadges`' `dueToday`
  count was computed on every page load and rendered nowhere. If a route has a `page.tsx`, give it
  a nav entry gated on the right permission, or it does not exist to the people using this.
- **Seeing and changing are two different scopes.** `ROLE_SCOPE` is what a role may *read*:
  Admin, CEO, CMD and Auditor read the compiled bank; Branch Manager and Cashier read their
  assigned branch; Agent reads `OWN`. `ROLE_WRITE_SCOPE` stays independently narrow: Branch
  Manager and Cashier at `BRANCH`, Agent at `OWN`. `inScope()` picks between them by asking
  whether the permission is in `WRITE_PERMISSIONS`. Do not collapse the tables: a future role may
  need wider reporting without wider money authority. `tests/rbac.test.ts` asserts no role writes
  further than it reads.
- **Register-typing is asked by name, not inferred.** `REGISTER_READ_ONLY_ROLES` (`AUDITOR`,
  `AGENT`) is checked first in `canTypeRegister()`, and every mutating action in
  `src/actions/register.ts` calls `assertCanTypeRegister(actor)` *before* its `assertCan`.
  Deriving the answer from permissions alone let an Agent back in through `case.create` and
  `case.submit` — adding blank rows and ticking "form in" are register edits whatever permission
  they travel under. `maturities/page.tsx` gates the sheet's write affordances the same way, or
  the buttons render for a role the server then rejects.
- **The register's blank rows are not database rows.** The sheet renders up to
  `DEFAULT_SHEET_LENGTH` (100) rows *counting the ones that exist*, padding the rest with
  `<BlankRow>`. Nothing is written until a clerk types in one and leaves it, at which point
  `createRegisterRowWithFieldsAction` creates that single case and applies the edit — both
  audited, in that order. "Add rows" raises `sheetLength`; it no longer calls
  `addRegisterRowsAction`, so it is instant and burns no case numbers. Blank rows render **only**
  on the unfiltered All tab: padding "Due today" out to a hundred would bury the one figure that
  says how much cash to open with.
- **`columnsThatFit()` decides the columns, not CSS.** The sheet measures its own width with a
  `ResizeObserver` and drops the lowest-`priority` columns into a per-row expander so it never
  scrolls sideways — losing the customer's name off the left edge while reading a cash figure is
  how a payout lands on the wrong account. Required columns never drop. Exports are unaffected:
  they read `visCols` (the saved layout), never the responsive `shownCols`. The caller must
  reserve room via `reservedRem` for everything that is not a data column — select box, ticks,
  Given, the expander — or `table-fixed` squeezes those to zero width.
- **Panels that sit *on top of* content must be opaque.** `--surface-solid` exists for them. The
  selection bar parks over the table's sticky header, and at any translucency the column headings
  read straight through the totals printed on it. Set it inline, not with a `bg-*` utility —
  `.glass` is unlayered and wins (see the traps below). That bar must also stay **one line**, or
  its second row covers the headings.
- **Never express "may not edit" by hiding data.** The Register shows every row and every column
  to every role; only the *control* goes flat. `canSubmit` / `canApprove` used to decide whether
  the "Form" and "Appr." columns were rendered **at all**, so switching them off for a read-only
  role deleted two columns of data from the sheet. They now always render and the checkbox is
  `disabled` instead. Likewise there is no role filter in `visible` — a cashier was shown approved
  rows only, which emptied the whole sheet on a register where nothing had been approved yet.
  Paying is still gated on `r.approved` at the row's own Pay control, which is where that belongs.
- **`windowDays` is the TOTAL working-day window, not the payout count.** 15 means 3 processing
  days plus 12 payout days. `payoutPlanFor()` is the only thing that should do that subtraction —
  never inline `windowDays - 3`. Maturities of ₹1,00,000 and over pay every working day; below
  that they pay on alternate working days inside the same window and share the same deadline.
  The minimum window is `MIN_WINDOW_DAYS` (4), enforced at every input site so a case cannot be
  created that could never be approved.
- **"Missed" is derived, never read from a stored flag.** `isOverdueInstalment(asOf)` in
  `queries.ts` is the one definition (`due_on < today AND status IN ('PENDING','PARTIAL')`).
  `markMissedInstalments()` exists in `schedule-service.ts` and has no callers on purpose:
  calling it from the follow-up lists would be a write on a read path — a transaction per page
  view, fired by anyone holding `case.view` including the read-only Auditor, changing stored state
  with no audit row. Leave it for a future scheduled job.
- **A per-day figure is `remaining / payoutDays`, never `remaining / windowDays`.** The window
  includes days that pay nothing. `recommendedPerDay()` in `register-view.ts` is the single
  definition — the Per day column, its sort and the bulk "set today" action all call it.
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
