# Domain Model

Full schema: [`src/db/schema.ts`](../src/db/schema.ts). Migrations: [`drizzle/`](../drizzle).

## The shape of the thing

```
Branch ─┬─ User ──────── Session
        ├─ Agent ─┬───── Customer
        │         │           │
        │         └───────────┴──── MaturityCase ─┬── PayoutInstalment ──┐
        ├─ Holiday                    (the case)  │   (the plan)         │
        └─ BranchCashPosition                     ├── PayoutTransaction ─┘
                                                  │   (what really happened)
                                                  ├── CaseDocument
                                                  └── CaseEvent (the human timeline)

AuditLog ──── append-only, references everything, owned by nothing
```

## MaturityCase — the centre of the system

| Group | Fields | Why it matters |
|---|---|---|
| Identity | `caseNumber` (`BR01/2026/000123`), `branchId`, `agentId`, `customerId` | The number a customer quotes on the phone. Generated from a per-branch, per-year counter. |
| Money | `maturityAmountPaise` | **BigInt paise.** The only amount that matters; everything else is derived. |
| **The two dates** | `formSubmittedOn`, `approvedOn` | Deliberately separate columns, both mandatory in their phase. A CHECK constraint forbids `approvedOn < formSubmittedOn`. |
| Schedule parameters | `windowDays`, `roundingPaise`, `distribution`, `cashPolicy`, `cashCapPerDayPaise`, `startOnNextWorkingDay` | The **only** schedule inputs a client may supply. The instalments themselves are always derived server-side. |
| Derived | `scheduleVersion`, `firstPayoutOn`, `deadlineOn` | Written by the server at approval. `deadlineOn` is the promise. |
| Ledger | `paidCashPaise`, `paidOnlinePaise` | Running totals maintained inside the same transaction as every payment, guarded by a CHECK that they can never exceed `maturityAmountPaise`. |

### Status machine

```
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──► APPROVED ──► IN_PROGRESS ──► COMPLETED
  │           │  ▲            │              │             │
  │           │  └─ RETURNED ─┘              └──► ON_HOLD ─┘
  │           ├──────────────► REJECTED  (terminal)
  └───────────┴──────────────► CANCELLED (terminal, and only while nothing is paid)
```

Transitions are declared once in `ALLOWED_TRANSITIONS` (`src/services/case-service.ts`) and
enforced on every mutation. There is no code path that sets `status` directly.

## PayoutInstalment — the plan

One row per payout day. `(caseId, scheduleVersion, seq)` is unique.

Rescheduling never edits history:

```
version 1:  [PAID] [PAID] [PARTIAL] [PENDING] [PENDING] [PENDING]
                                        │
                              re-plan   ▼
version 2:  [PAID] [PAID] [PAID*]   [PENDING] [PENDING]      ← new rows, new dates
                              ▲
              *frozen at what was actually paid; the unpaid rows became SUPERSEDED
```

CHECK constraints on this table:

- `amountPaise > 0`
- `cashLegPaise + onlineLegPaise = amountPaise` (**INV-3**)
- legs and paid amounts are non-negative

## PayoutTransaction — what really happened

Every disbursement, including partials. Reversals are **additive**: the row stays and is flagged
with `reversedAt` / `reversedById` / `reversalReason`. The ledger is never rewritten.

CHECK constraints:

- `cashPaise + onlinePaise = totalPaise`
- `totalPaise > 0`
- `onlinePaise = 0 OR reference IS NOT NULL` — an online leg without a UTR is not auditable, so
  the **database** refuses it, not just the form.

## AuditLog

Append-only. Written inside the same transaction as the change it describes (**INV-6**). No
`UPDATE` or `DELETE` statement against this table exists anywhere in the repository.

Each row carries actor identity and role *as they were at the time*, a human summary, and
`before` / `after` JSON snapshots with money rendered as decimal strings.

## Working days

```ts
WorkingDayCalendar = {
  weekend: { sundaysOff: boolean; saturdayRule: 'NONE' | 'ALL' | 'SECOND_FOURTH' },
  holidays: Set<'YYYY-MM-DD'>,
}
```

Assembled per branch by `getBranchPolicy()` from the branch's own weekend rule plus every holiday
that applies to it (branch-specific **or** bank-wide), padded with the fixed national holidays
(26 Jan, 1 May, 15 Aug, 2 Oct, 25 Dec) so a fresh install is already safe.

All date arithmetic runs in UTC on `YYYY-MM-DD` strings, so a server in one timezone and a browser
in another can never disagree about which day it is.

## Money

Every amount is `bigint` **paise** — in the database (`BIGINT`), in the engine, in the services.
The only place a rupee becomes a string is `formatPaise()`, and the only place it becomes a
`number` is a chart axis. `src/lib/serialize.ts` converts `bigint` to a decimal string at the
Server→Client boundary and back with `BigInt(...)` on the other side.
