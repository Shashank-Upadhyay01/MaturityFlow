# MaturityFlow — Design Overview

> **One line:** MaturityFlow turns an unpredictable, manual maturity-payout process into a
> deterministic, day-by-day disbursement plan that every branch, agent and customer can see.

---

## 1. The problem, stated precisely

Today a maturity payout runs like this:

```
Agent collects customer docs ──▶ submits Maturity Form (date A)
                                       │
                          Ops Head reviews (date B, often ≠ A)
                                       │
                             APPROVED (date B) ──▶ money becomes payable
                                       │
                    "You'll get it within 12–15 days"  ← a promise, not a plan
                                       │
                    ┌──────────────────┴──────────────────┐
              Branch pays whatever cash it has        Customer waits
              on whatever day it has it               Agent chases
```

### Where it actually breaks

| # | Failure | Consequence |
|---|---------|-------------|
| F1 | The 12–15 day window is a *promise*, never a *schedule*. Nobody computes how much must move each day. | Payouts drift past the window. |
| F2 | A ₹5,00,000 maturity gets the same window as a ₹50,000 one, but daily cash-in-hand per customer is capped. | Big cases are structurally impossible to finish on time. |
| F3 | Submission date and approval date are conflated. Money is payable from **approval**, but the clock is often mentally started at **submission**. | Disputes over "you're already late". |
| F4 | Nobody knows tomorrow's total cash requirement until tomorrow. | Branch runs out of cash mid-day; customer sent home. |
| F5 | Cash vs online split is decided ad-hoc at the counter. | Cash exhausted on cases that could have gone online. |
| F6 | Progress lives in a register/WhatsApp. Agent cannot answer "how much is left?" | Restless agents, angry customers, escalations to CMD. |

### The core insight

Every one of these failures disappears if, **at the moment of approval**, the system emits an
immutable, arithmetically-exact, day-by-day payout schedule — and then measures reality against it.

```
APPROVED (date B) ──▶ [SCHEDULE ENGINE] ──▶ Day 1: ₹34,000 (₹20,000 cash + ₹14,000 online)
                                             Day 2: ₹34,000
                                             ...
                                             Day 15: ₹24,000   ← remainder lands here
                              Σ = exactly the maturity amount, always
```

Once the schedule exists, everything else is a projection of it:

- **Branch cash opening requirement** = Σ of tomorrow's cash legs across all live schedules.
- **Agent's "how much is left?"** = amount − Σ paid.
- **"Are we on time?"** = today vs the last installment date.
- **CMD's view** = the same numbers, unaggregated by branch.

---

## 2. What the software does

### 2.1 The instant calculator (the headline feature)

The Ops Head / Branch Manager types a **maturity amount** and picks **"give within N days"**.
Before anything is saved, the screen already shows the exact per-day withdrawal plan, live,
as they type. Change the amount → recalculates. Change days from 15 to 12 → recalculates.
Set a cash cap of ₹20,000/day → the cash and online columns re-split instantly.

The same pure function runs on the client (for the live preview) **and** on the server (when the
schedule is persisted at approval), so what the user was shown is bit-for-bit what gets stored.

### 2.2 Rounding rule

Every installment is a **round number**. The rounding step is configurable (default ₹1,000; set
per branch, overridable per case by Ops Head / CEO / CMD). The **remainder always lands on the
final installment** — exactly as the business already works.

But naïve rounding produces a lumpy schedule:

```
BAD  (round down, dump remainder on last day)
₹10,00,000 over 15 days @ ₹10,000 step
→ 14 × ₹60,000 + ₹1,60,000 on day 15   ← last day is 2.6× a normal day. Unpayable.
```

MaturityFlow distributes the rounding units instead:

```
GOOD (unit distribution, remainder on last day)
₹10,00,000 over 15 days @ ₹10,000 step
→ 10 × ₹70,000 + 5 × ₹60,000          ← every day is payable, Σ is exact
```

Full algorithm: [`docs/03-PAYOUT-ENGINE.md`](./03-PAYOUT-ENGINE.md).

### 2.3 Working days, not calendar days

"Within 15 days" is counted in **days the branch can actually pay**: Sundays, 2nd & 4th Saturdays
and an editable bank-holiday calendar are skipped. A schedule never places money on a day the
counter is shut.

### 2.4 The two dates are never conflated

`formSubmittedAt` and `approvedAt` are separate, both mandatory, both audited. **The schedule is
anchored to `approvedAt`** — the day the money became payable — and the SLA clock starts there.
Submission-to-approval lag is measured and reported on its own, because that lag is a second,
separate problem worth seeing.

### 2.5 Cash vs online, planned instead of improvised

Each installment is split into a **cash leg** and an **online leg** by an explicit per-case policy
(cash cap per day, or cash-only, or online-only). That makes tomorrow's branch cash requirement a
computed number rather than a surprise — which is the entire point of the **Cash Opening Planner**.

### 2.6 Reality is recorded against the plan

The cashier's Payout Desk lists exactly what is due today. Each installment can be paid in full,
partially, or missed. Actual amounts, mode, UTR/reference and who did it are recorded. If reality
drifts from plan, the **remaining** schedule is regenerated over the **remaining** working days so
the completion date is still honoured — never by silently changing history.

---

## 3. Roles

| Role | Scope | Can do |
|------|-------|--------|
| **CMD** | All branches | Everything. Edit any field, override any schedule, see full audit trail, manage users. |
| **CEO** | All branches | Everything except deleting audit records / system-level config. |
| **ADMIN** | All branches | User, branch, holiday and settings administration. No approval authority. |
| **OPS_HEAD** | All branches (or assigned set) | Approve / reject / return maturity forms. Set schedule parameters. The approval authority. |
| **BRANCH_MANAGER** | Own branch | Create & submit cases, view branch dashboards, plan branch cash, mark payouts. |
| **CASHIER** | Own branch | Payout Desk only: record cash/online disbursements against due installments. |
| **AGENT** | Own customers | Submit maturity forms + documents, track their own customers' payout progress. |
| **AUDITOR** | All branches, **read-only** | Every record and the immutable audit log. Cannot mutate anything. |

Enforcement is **server-side on every single mutation** (`src/lib/rbac.ts` + `assertCan()` guards).
The UI hides what you cannot do; the server refuses it regardless. Full matrix:
[`docs/04-RBAC.md`](./04-RBAC.md).

---

## 4. Non-negotiable correctness rules

This system moves real money. These are enforced in code, not by convention.

| ID | Invariant | Enforced by |
|----|-----------|-------------|
| **INV-1** | All money is stored and computed as **integer paise (`BigInt`)**. No floating point, ever. | `src/lib/money.ts`; DB columns are `BigInt`. |
| **INV-2** | `Σ(installment amounts) === maturity amount`, exactly, for every generated schedule. | Hard assertion inside the engine + fuzz tests over 100k random cases. |
| **INV-3** | `installment.amount === installment.cashLeg + installment.onlineLeg` for every row. | Engine assertion + DB check constraint. |
| **INV-4** | `Σ(paid) ≤ case.maturityAmount`. Over-payment is impossible. | Transactional guard in `recordPayout()` with row-level locking. |
| **INV-5** | Schedule start date `>= approvedAt`, never before. | Engine precondition. |
| **INV-6** | Every money-affecting mutation writes an append-only `AuditLog` row in the **same transaction**. | `withAudit()` wrapper; no direct writes allowed. |
| **INV-7** | Approval is idempotent — double-clicking "Approve" cannot create two schedules. | Unique constraint on `MaturityCase.id` + status guard inside the transaction. |
| **INV-8** | No installment is dated on a non-working day. | Working-day calendar in the engine. |

> Every one of these has a dedicated test. `npm test` must be green before deploy.

---

## 5. Screens

| Screen | Primary user | Purpose |
|--------|--------------|---------|
| **Dashboard** | Everyone (scoped) | Today's maturities, today's approvals, given vs remaining, cash vs online, live charts. |
| **New Maturity** | Agent / Branch Mgr | Intake form with the **live schedule calculator**. |
| **Approvals** | Ops Head | Queue of submitted forms, document review, approve/reject/return, schedule preview before commit. |
| **Cases** | All (scoped) | Searchable register; per-case timeline, schedule, payments, documents, audit. |
| **Payout Desk** | Cashier | Today's due installments; record cash/online/partial with reference numbers. |
| **Cash Planner** | Branch Mgr / Ops | Next 14 days of cash requirement per branch vs expected opening balance → **extra cash to arrange**. |
| **Agents** | Ops / Branch Mgr | Per-agent totals, live cases, on-time %, amount outstanding. |
| **Branches** | CEO / CMD / Ops | Per-branch rollup and comparison. |
| **Reports** | Ops / Auditor | Register views + CSV / XLSX export. |
| **Audit Log** | CMD / CEO / Auditor | Immutable, filterable trail of every action. |
| **Settings** | Admin / CMD | Branches, users, holidays, rounding defaults, SLA policy. |

---

## 6. Technology

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | **Next.js 15** (App Router, RSC, Server Actions) | One deployable unit; data-fetching on the server keeps the money logic off the client. |
| Language | **TypeScript, `strict`** | Type-level protection around `BigInt` money and role unions. |
| Database | **PostgreSQL 16** | Transactional integrity, `SERIALIZABLE`-capable, check constraints, cheap to self-host. |
| ORM | **Prisma 6** | Typed schema, honest migrations, `BigInt` support. |
| Auth | **Argon2-grade hashing (bcrypt) + JOSE JWT in httpOnly cookies + server-side session table** | Sessions are revocable — a fired employee is logged out instantly. |
| Styling | **Tailwind CSS v4 + custom liquid-glass token layer** | Design system in tokens, no runtime CSS-in-JS cost. |
| Motion | **Framer Motion** | Spring physics matching Apple's easing; respects `prefers-reduced-motion`. |
| Charts | **Recharts** | Composable, SSR-safe. |
| Validation | **Zod** | One schema validates client form and server action. |
| Tests | **Vitest** | Fast; the money engine is unit + fuzz tested. |
| Runtime | **Docker Compose (local) / any Node host (cloud)** | Runs on a branch server today, on Vercel + managed Postgres tomorrow, same code. |

Architecture detail: [`docs/01-ARCHITECTURE.md`](./01-ARCHITECTURE.md).

---

## 7. Deployment posture

Chosen: **local-first, cloud-ready.**

```
TODAY (on premises)                        TOMORROW (optional, zero code change)
┌────────────────────────┐                 ┌────────────────────────┐
│ Branch / HO server     │                 │ Vercel / Fly / Render  │
│  ├ Next.js (port 3000) │   same image →  │  └ Next.js             │
│  └ Postgres 16 (docker)│                 │ Supabase / Neon / RDS  │
└────────────────────────┘                 └────────────────────────┘
   branches reach it over the LAN/VPN         branches reach it over HTTPS
```

The only difference is the `DATABASE_URL` environment variable. Nothing in the application code
knows or cares which of the two it is running in. See [`docs/07-DEPLOYMENT.md`](./07-DEPLOYMENT.md).

---

## 8. What is deliberately *not* in v1

Stated openly so the scope is honest:

- No core-banking / CBS integration. Payouts are **recorded**, not executed. (Interface is isolated
  in `src/lib/integrations/` so a CBS or NEFT/RTGS adapter drops in later.)
- No SMS/WhatsApp customer notification (the notification model exists; the sender is a stub).
- No maker-checker on *payout recording* (approval already has it). Easy to add — the audit model
  already supports it.
- No offline mode. Branches need LAN/VPN reachability to the server.

---

## 9. How to judge whether it worked

| Metric | Before | Target |
|--------|--------|--------|
| % maturities fully paid inside the promised window | unknown / low | **> 95%** |
| Days from approval → final rupee paid | 18–30, unpredictable | **= promised N, predictable** |
| "How much is left?" answered by | phone call to branch | **agent's own screen, instantly** |
| Branch cash shortfall incidents | discovered at the counter | **forecast 14 days ahead** |
| Submission → approval lag | invisible | **measured and reported per approver** |
