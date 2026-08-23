# Architecture

## 1. Shape

Single deployable Next.js 15 application. Server Components read data; Server Actions write it.
The browser never talks to the database and never computes an authoritative rupee.

```
┌──────────────────────────── Browser ────────────────────────────┐
│  React 19 Client Components                                     │
│  • liquid-glass UI, Framer Motion                               │
│  • LIVE schedule preview  ← calls the SAME pure engine module    │
│    (preview only — never authoritative)                         │
└───────────────┬─────────────────────────────────────────────────┘
                │  Server Actions (POST, CSRF-safe by design)
┌───────────────▼─────────────────────────────────────────────────┐
│  Next.js server runtime (Node)                                  │
│                                                                 │
│  actions/*.ts    → 1. authenticate  (session cookie → user)     │
│                    2. authorise     (assertCan → RBAC)          │
│                    3. validate      (Zod)                       │
│                    4. execute       (inside prisma.$transaction) │
│                    5. audit         (same transaction)          │
│                    6. revalidate    (cache tags)                │
│                                                                 │
│  lib/payout-engine.ts  ← authoritative money math (pure)        │
│  lib/rbac.ts           ← permission matrix                      │
│  lib/audit.ts          ← append-only trail                      │
└───────────────┬─────────────────────────────────────────────────┘
                │ Prisma 6
┌───────────────▼─────────────────────────────────────────────────┐
│  PostgreSQL 16 — BigInt money columns, CHECK constraints,        │
│  unique guards, append-only audit table                          │
└─────────────────────────────────────────────────────────────────┘
```

## 2. The one rule that matters

> **The client's calculator is a preview. The server recomputes the schedule from scratch at
> approval time and persists *that*.**

A tampered browser cannot create a schedule that doesn't sum to the maturity amount, because the
server never trusts a client-supplied installment array — it only accepts the *parameters*
(amount, days, rounding, cash policy) and derives the rest itself. Both sides import the identical
pure module, so an honest client always sees exactly what the server will produce.

## 3. Directory map

```
src/
├── app/
│   ├── (auth)/login/              public
│   └── (app)/                     authenticated shell (sidebar, command palette)
│       ├── dashboard/             role-aware landing
│       ├── maturities/            register, [id] detail, new (live calculator)
│       ├── approvals/             Ops Head queue
│       ├── payouts/               Cashier desk
│       ├── cash-planner/          14-day cash requirement forecast
│       ├── agents/  branches/     rollups
│       ├── reports/  audit/       registers + exports
│       └── settings/              users, branches, holidays, policy
│   └── api/                       health, export streams, document upload
├── actions/                       ALL mutations. Guarded, validated, transactional, audited.
├── components/
│   ├── ui/                        glass primitives (Card, Button, Field, Table, Sheet, …)
│   ├── charts/                    Recharts wrappers
│   └── domain/                    ScheduleTable, CasePipeline, CashGauge, …
├── lib/
│   ├── money.ts                   BigInt paise, Indian formatting
│   ├── working-days.ts            weekend policy + holiday calendar
│   ├── payout-engine.ts           ★ the schedule algorithm
│   ├── auth/                      password hashing, JWT sessions, session store
│   ├── rbac.ts                    roles → permissions → branch scoping
│   ├── audit.ts                   withAudit() transactional wrapper
│   ├── db.ts                      Prisma singleton
│   └── serialize.ts               BigInt-safe boundary between server and client
└── types/
```

## 4. Data access rules

1. **No component queries the DB directly.** Reads go through `src/lib/queries/*` which apply
   branch scoping from the session. A Branch Manager physically cannot select another branch's rows.
2. **No action writes without `assertCan()`** as its first statement after session lookup.
3. **No money mutation outside `prisma.$transaction`.** Payout recording takes a `FOR UPDATE` lock
   on the case row so two cashiers cannot double-pay the same installment.
4. **BigInt never crosses to the client raw.** `serialize.ts` converts to strings at the boundary;
   the client re-parses to `BigInt` for its preview math.

## 5. Performance & scalability

- Server Components + Postgres indexes on every filter path
  (`branchId`, `status`, `approvedAt`, `dueDate`, `agentId`).
- Dashboard aggregates are single grouped SQL queries, not N+1 loops.
- Cache tags per branch (`revalidateTag('branch:'+id)`) so one branch's write doesn't invalidate
  another's dashboard.
- Cursor pagination on the register — the case table is designed to survive 10⁶ rows.
- The engine is O(days) with `days ≤ 60`; a live preview costs microseconds.
- Stateless app tier: run N replicas behind a load balancer, Postgres holds all state.

## 6. Concurrency — many people, one ledger

Several branches use this at the same time, so "two people acting on the same case at the same
instant" is the normal case, not the edge case.

**One rule governs it:** any code that writes a case's instalments or transactions takes the
**case row lock first**, then re-reads the row it is about to change with `.for('update')`.

```
tx BEGIN
  SELECT … FROM maturity_cases      WHERE id = ?  FOR UPDATE   ← 1. always the case first
  SELECT … FROM payout_instalments  WHERE id = ?  FOR UPDATE   ← 2. then the row being changed
  validate → insert transaction → update instalment → update case totals → write audit
tx COMMIT
```

The order matters twice over:

- **Correctness.** Reading the instalment *before* the case lock is not enough. Every waiting
  transaction would already hold a snapshot taken when `paid = 0`, so each would validate
  against stale data and the same day's instalment could be paid several times over — while
  the case total still looked correct. This was a real defect, caught by
  `tests/integration/concurrency.test.ts` and fixed by moving the read inside the lock.
- **Liveness.** Because the order is always case → child row, two payouts on the same case
  queue in the same sequence and cannot deadlock.

Proven, not assumed — `npm run test:db` asserts that:

| Scenario | Guarantee |
|---|---|
| Two cashiers pay the same instalment simultaneously | Exactly one succeeds; the other is refused |
| Twelve simultaneous payments on one instalment | Total paid never exceeds the maturity amount |
| Every instalment paid at once (end-of-window rush) | Case totals reconcile exactly with the transaction log |
| Two approvers approve the same case at once | Exactly one schedule, `scheduleVersion = 1`, Σ still exact |
| 25 cases created in parallel at one branch | No duplicate case numbers |

Beyond that: `INV-4` is also a Postgres `CHECK` constraint, so even a hand-written `UPDATE`
cannot overpay a case; the connection pool defaults to 20; and the app tier is stateless, so
running several instances behind a load balancer needs no coordination — Postgres holds all
the state and all the locks.

## 7. Security

| Concern | Handling |
|---|---|
| Passwords | bcrypt, cost 12. Never logged, never returned. |
| Sessions | JWT (HS256, `jose`) in an httpOnly, SameSite=Lax, Secure-in-prod cookie **plus** a server-side `Session` row → instant revocation. |
| Authorisation | Server-side on every action; UI hiding is cosmetic only. |
| Branch isolation | Injected into every query at the data layer, not the caller. |
| Injection | Prisma parameterised queries only. |
| Audit | Append-only; no update/delete path exists in the code. |
| Forced password change | `mustChangePassword` flag on seeded accounts. |
| Idempotency | Status guards inside row-locked transactions defeat double-submit. |
| Uploaded documents | Stored outside the web root; storage keys generated server-side; served only through an authenticated route that re-checks access to the parent case. Only PDF/JPG/PNG/WEBP/HEIC/TIFF, 10 MB max — SVG is deliberately excluded because it can carry script. |
