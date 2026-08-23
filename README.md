<div align="center">

# MaturityFlow

**Turns a bank maturity approval into an exact, day-by-day payout schedule — and measures every rupee against it.**

`Next.js 15` · `TypeScript` · `PostgreSQL 16` · `Drizzle ORM` · `Tailwind v4` · `Framer Motion`

</div>

---

## The problem

When a deposit matures, an agent submits a maturity form. An Operations Head approves it — same
day, or five days later. The customer is told "you'll have it within 12 to 15 days". Then:

- nobody computes **how much must move each day**, so the window is a promise rather than a plan;
- a ₹5,00,000 maturity gets the same window as a ₹50,000 one, though daily cash per customer is capped;
- the branch discovers **tomorrow's cash requirement tomorrow**;
- the agent cannot answer *"how much is left?"* without phoning the branch.

The result is payouts that drift past the window, restless agents, and angry customers.

## The insight

Every one of those failures disappears if, **at the moment of approval**, the system emits an
immutable, arithmetically-exact, day-by-day schedule — and then measures reality against it.

```
₹5,00,000 · approved 18 Aug · give within 15 working days · round to ₹1,000

  Day 1–5    ₹34,000        ← 18, 19, 20, 21, 24 Aug   (22nd is a 4th Saturday, 23rd a Sunday)
  Day 6–15   ₹33,000
  ─────────────────────
  Σ          ₹5,00,000      exactly, always
```

Once that schedule exists, everything else is a projection of it: tomorrow's branch cash
requirement, the agent's "how much is left", whether a case will breach its promise — computed,
days in advance.

## What makes it correct

This system moves real money, so eight invariants are enforced in code and in the database, not by
convention:

| | Invariant | Enforced by |
|---|---|---|
| **INV-1** | All money is integer **paise in `bigint`**. No floating point, anywhere. | `src/lib/money.ts`, `BIGINT` columns |
| **INV-2** | `Σ(instalments) === maturity amount`, exactly | runtime assertion in the engine + **100,000-case fuzz suite** |
| **INV-3** | `instalment = cash leg + online leg` | engine assertion + `CHECK` constraint |
| **INV-4** | `Σ(paid) ≤ maturity amount` — over-payment is impossible | row-locked transaction + `CHECK` constraint |
| **INV-5** | Approval can never predate submission | engine precondition + `CHECK` constraint |
| **INV-6** | Every money-affecting mutation writes an audit row **in the same transaction** | `writeAudit()`; the table has no update or delete path |
| **INV-7** | Approval is idempotent — a double-click cannot create two schedules | status guard inside the locked transaction |
| **INV-8** | No instalment lands on a non-working day | working-day calendar in the engine |
| **INV-9** | Concurrent writers to one case serialise; the same instalment cannot be paid twice | case row lock taken **before** re-reading the target row, proven by `npm run test:db` |

`npm test` must be green before the build will pass. The schedule engine is pure, deterministic and
runs **identically in the browser and on the server** — so the figure an approver is shown is
bit-for-bit the figure that gets written.

## Screens

| | |
|---|---|
| **Dashboard** | Today's forms, today's approvals, given vs remaining, cash vs online, 14-day payout curve |
| **New maturity** | Intake form whose **day-by-day plan builds itself as you type** |
| **Approvals** | The Ops queue; the exact schedule is previewed *before* it is committed |
| **Payout desk** | The cashier's screen — what is due today, cash / online / partial |
| **Cash planner** | 14 days of cash requirement vs branch opening balance → **extra cash to arrange** |
| **Agents · Branches · Reports** | Rollups, registers, CSV / Excel export |
| **Documents** | Maturity form and KYC papers attached to the case, verified per file by the approver |
| **Audit log** | Append-only. Who did what, when, from where, before and after |

## Roles

`CMD` · `CEO` · `ADMIN` · `OPS_HEAD` · `BRANCH_MANAGER` · `CASHIER` · `AGENT` · `AUDITOR`

Enforced **server-side on every mutation**, with branch/agent scoping applied at the query layer so
a page cannot forget it. `AUDITOR` is structurally read-only: an explicit deny-list means a
permission added by mistake still cannot grant write access.

## Run it

```bash
cp .env.example .env          # set SESSION_SECRET: openssl rand -base64 48
npm install
docker compose up -d db       # Postgres 16 on :5432
npm run db:migrate
npm run db:seed               # demo data — skip for a real go-live
npm run dev                   # http://localhost:3000
```

> **No Docker?** Point `DATABASE_URL` at any PostgreSQL 16 — a local install, or a free
> [Neon](https://neon.tech) / [Supabase](https://supabase.com) database — and run the same
> `db:migrate` / `db:seed` / `dev` steps. Nothing else changes.

Demo logins — password `Maturity@2026`:

| Role | Email |
|---|---|
| CMD | `cmd@bank.test` |
| CEO | `ceo@bank.test` |
| Operations Head | `ops@bank.test` |
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
npm test                 # 110 unit tests + a 100,000-case property sweep
npm run test:db          # 5 concurrency tests against a real Postgres
npm run build            # production build
node scripts/smoke.mjs   # 55-check browser walk-through of the whole lifecycle
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
| [Design system](docs/06-DESIGN-SYSTEM.md) | How the liquid-glass look is built |
| [Deployment](docs/07-DEPLOYMENT.md) | Local, LAN and cloud |
| [**Cloud migration**](docs/11-CLOUD-MIGRATION.md) | Laptop → 24/7 URL: what moves, in what order, and why |
| [Runbook](docs/08-RUNBOOK.md) | Daily rhythm, diagnostics, ledger verification SQL |
| [ADRs](docs/adr) | Why `bigint` paise, why Drizzle, why the approval anchor, why unit distribution |

## Not in v1 — stated plainly

- No core-banking integration. Payouts are **recorded**, not executed. The seam for a CBS or
  NEFT/RTGS adapter is isolated in the service layer.
- No SMS/WhatsApp notifications to customers (the model exists; the sender is a stub).
- No maker-checker on payout *recording* — approval already has one.
- Documents are stored on the app server's disk under `STORAGE_ROOT`. Fine for a single branch
  server; move to S3/Azure Blob before running more than one app instance (the adapter is one
  file: `src/lib/storage.ts`).
- No offline mode; branches need LAN/VPN reachability.
