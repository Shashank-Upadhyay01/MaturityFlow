<div align="center">

# KGGNL Core

**One secure workspace for maturity operations, daily cash, payouts, planning and audit.**

The repository and some internal technical identifiers retain the original `MaturityFlow` name.

`Next.js 15` · `TypeScript` · `PostgreSQL 16` · `Drizzle ORM` · `Tailwind v4` · `Framer Motion`

</div>

---

## The problem

When a deposit matures, an agent submits its maturity form. The customer is told "you'll have it
within 12 to 15 days". Then:

- nobody computes **how much must move each day**, so the window is a promise rather than a plan;
- a ₹5,00,000 maturity gets the same window as a ₹50,000 one, though daily cash per customer is capped;
- the branch discovers **tomorrow's cash requirement tomorrow**;
- the agent cannot answer *"how much is left?"* without phoning the branch.

The result is payouts that drift past the window, restless agents, and angry customers.

## The insight

Every one of those failures disappears if, **at submission**, the system emits an
immutable, arithmetically-exact, day-by-day schedule — and then measures reality against it.

```
₹5,00,000 · first payout 18 Aug · give within 15 working days · round to ₹1,000

  Day 1–5    ₹34,000        ← 18, 19, 20, 21, 24 Aug   (22nd is a 4th Saturday, 23rd a Sunday)
  Day 6–15   ₹33,000
  ─────────────────────
  Σ          ₹5,00,000      exactly, always
```

Once that schedule exists, everything else is a projection of it: tomorrow's branch cash
requirement, the agent's "how much is left", whether a case will breach its promise — computed,
days in advance.

## What makes it correct

This system moves real money, so nine invariants are enforced in code and in the database, not by
convention:

| | Invariant | Enforced by |
|---|---|---|
| **INV-1** | All money is integer **paise in `bigint`**. No floating point, anywhere. | `src/lib/money.ts`, `BIGINT` columns |
| **INV-2** | `Σ(instalments) === maturity amount`, exactly | runtime assertion in the engine + **100,000-case fuzz suite** |
| **INV-3** | `instalment = cash leg + online leg` | engine assertion + `CHECK` constraint |
| **INV-4** | `Σ(paid) ≤ maturity amount` — over-payment is impossible | row-locked transaction + `CHECK` constraint |
| **INV-5** | The stored schedule anchor can never predate submission | policy + `CHECK` constraint |
| **INV-6** | Every money-affecting mutation writes an audit row **in the same transaction** | `writeAudit()`; the table has no update or delete path |
| **INV-7** | Submission is idempotent — a double-click cannot create two schedules | status guard inside the locked transaction |
| **INV-8** | No instalment lands on a non-working day | working-day calendar in the engine |
| **INV-9** | Concurrent writers to one case serialise; the same instalment cannot be paid twice | case row lock taken **before** re-reading the target row, proven by `npm run test:db` |

`npm test` must be green before the build will pass. The schedule engine is pure, deterministic and
runs **identically in the browser and on the server** — so the figure the clerk is shown is
bit-for-bit the figure that gets written.

## Screens

| | |
|---|---|
| **Dashboard** | Register summary plus a separate bank-wide view of today's branch cashbooks, gross shortages and close status |
| **New maturity** | Intake form whose **day-by-day plan builds itself as you type** |
| **Register** | Spreadsheet-style maturity register with keyboard entry, responsive columns and a lazy-loaded cash plan |
| **Payout desk** | The cashier's screen — what is due today, cash / online / partial |
| **Cash planner** | 14 days of cash requirement vs branch opening balance → **extra cash to arrange** |
| **Daily cashbook** | Channel-aware day entries, denomination count, named obligations, live physical-cash reconciliation and maker–checker close |
| **Agents · Branches · Reports** | Rollups, registers, CSV / Excel export |
| **Documents** | Maturity form and KYC papers attached to the case, with an authenticated download trail |
| **Audit log** | Append-only. Who did what, when, from where, before and after |

## Roles

`CMD` · `CEO` · `ADMIN` · `BRANCH_MANAGER` · `CASHIER` · `AGENT` · `AUDITOR`

Enforced **server-side on every mutation**, with branch/agent scoping applied at the query layer so
a page cannot forget it. `AUDITOR` is structurally read-only: an explicit deny-list means a
permission added by mistake still cannot grant write access.

## Run it

```bash
cp .env.example .env          # set SESSION_SECRET (see command below)
npm install

# A PostgreSQL 16+ database, pointed at by DATABASE_URL in .env. Either:
#   • a local install — this project's laptop uses native PostgreSQL 18 on :5432, or
#   • Docker:  docker compose up -d db   # NOTE binds host port 5433 — set DATABASE_URL to :5433
npm run db:migrate            # create / upgrade the schema
npm run db:seed               # demo data + logins — SKIP for real data; it truncates first

npm run dev                   # http://localhost:3000
```

Generate `SESSION_SECRET` with:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`

> Already have a database with data (this laptop does — native PostgreSQL 18 on `:5432`, which
> starts automatically)? Then day-to-day it's just `npm run dev`. Point `DATABASE_URL` at any
> PostgreSQL 16+ — local, Docker, or a managed [Neon](https://neon.tech) /
> [Supabase](https://supabase.com) — and nothing else changes.

Seeded logins. **The password is not published here.** A fresh clone seeds whatever
`MF_SEED_PASSWORD` is set to (see `scripts/seed.ts`); the live deployment's passwords are held
by the administrator and are not the seed value.

| Role | Email |
|---|---|
| CMD | `cmd@bank.test` |
| CEO | `ceo@bank.test` |
| Admin (legacy Ops login) | `ops@bank.test` |
| Branch Manager | `manager@bank.test` |
| Cashier | `cashier@bank.test` |
| Auditor | `auditor@bank.test` |
| Agent | `agent1@bank.test` … `agent6@bank.test` |

**Serving branches over the office LAN** (Phase 1): double-click **`start-lan.bat`** — it builds,
prints the address branches type into their browser, and serves on port 3000. Set
`APP_URL="http://<this-pc-ip>:3000"` and `COOKIE_SECURE=false` in `.env` first (a `Secure` cookie is
silently dropped over plain HTTP, so sign-in would otherwise fail).

**Moving to the cloud** (Phase 2 — a 24/7 URL on Vercel + managed Postgres):
[`docs/11-CLOUD-MIGRATION.md`](docs/11-CLOUD-MIGRATION.md) is the step-by-step runbook.
General deployment reference: [`docs/07-DEPLOYMENT.md`](docs/07-DEPLOYMENT.md).

## Verify it

```bash
npm run typecheck        # tsc --noEmit, strict
npm run lint             # ESLint 9, flat config
npm test                 # 364 unit tests + a 100,000-case property sweep
npm run test:db:scratch  # 30 integration/concurrency checks in an isolated Postgres database
npm run build            # production build
node scripts/smoke-first-use.mjs # 23-check first-use browser walk-through (scratch server only)
```

## Documentation

| | |
|---|---|
| [Design overview](docs/00-DESIGN-OVERVIEW.md) | The problem, the insight, the invariants |
| [Architecture](docs/01-ARCHITECTURE.md) | Request flow, directory map, security |
| [Domain model](docs/02-DOMAIN-MODEL.md) | Every table and why it is shaped that way |
| [**Payout engine**](docs/03-PAYOUT-ENGINE.md) | The algorithm, derived, with worked examples |
| [Roles & permissions](docs/04-RBAC.md) | The full matrix |
| [Server actions & endpoints](docs/05-API.md) | Every mutation and its guard |
| [Design system](docs/06-DESIGN-SYSTEM.md) | Professional workstation tokens and interaction rules |
| [Deployment](docs/07-DEPLOYMENT.md) | Local, LAN and cloud |
| [**Cloud migration**](docs/11-CLOUD-MIGRATION.md) | Laptop → 24/7 URL: what moves, in what order, and why |
| [**Daily cashbook**](docs/12-DAILY-CASHBOOK.md) | Spreadsheet meanings, exact formulas, workflows, sharing and future upgrades |
| [Runbook](docs/08-RUNBOOK.md) | Daily rhythm, diagnostics, ledger verification SQL |
| [ADRs](docs/adr) | Why `bigint` paise, why Drizzle, why the maturity anchor, why unit distribution |

## Not in v1 — stated plainly

- No core-banking integration. Payouts are **recorded**, not executed. The seam for a CBS or
  NEFT/RTGS adapter is isolated in the service layer.
- No SMS/WhatsApp notifications to customers (the model exists; the sender is a stub).
- No maker-checker on payout recording; authorisation, row locking and same-transaction audit are enforced.
- Documents are stored on the app server's disk under `STORAGE_ROOT`. Fine for a single branch
  server; move to S3/Azure Blob before running more than one app instance (the adapter is one
  file: `src/lib/storage.ts`).
- No offline mode; branches need LAN/VPN reachability.
