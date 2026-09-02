# Roles & Permissions

## Roles

`CMD · CEO · ADMIN · BRANCH_MANAGER · CASHIER · AGENT · AUDITOR`

`OPS_HEAD` was retired on 2026-08-26 along with the approval step it existed for
([ADR 0005](adr/0005-schedule-anchored-to-maturity.md)). The value remains in the `role` Postgres
enum — Postgres has no `ALTER TYPE … DROP VALUE`, and audit rows still name it — but it is not
assignable, holds no permissions, and `activeRole()` reads a stored one as the `ADMIN` its
account was migrated to.

## Scope

Every role carries a data scope, applied at the query layer:

| Scope | Roles | Effect |
|---|---|---|
| Read `ALL` | CMD, CEO, ADMIN, BRANCH_MANAGER, CASHIER, AGENT, AUDITOR | Every branch. |
| Write `ALL` | CMD, CEO, ADMIN, AUDITOR | May change any branch. |
| Write `BRANCH` | BRANCH_MANAGER, CASHIER | `WHERE branchId = session.branchId`. |
| Write `OWN` | AGENT | `WHERE agentId = session.agentId`. |

## Permission matrix

| Permission | CMD | CEO | ADMIN | BR_MGR | CASHIER | AGENT | AUDITOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `case.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `case.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `case.submit` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `case.edit` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `case.editApproved` | ✓ | ✓ | ✓ | – | – | – | – |
| `case.approve` | ✓ | ✓ | ✓ | – | – | – | – |
| `case.reject` | ✓ | ✓ | ✓ | – | – | – | – |
| `case.return` | ✓ | ✓ | ✓ | – | – | – | – |
| `case.hold` | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `case.cancel` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `schedule.preview` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `schedule.override` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `schedule.reschedule` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `payout.record` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `payout.reverse` | ✓ | ✓ | ✓ | – | – | – | – |
| `cash.plan` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `cash.setOpening` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `cashbook.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `cashbook.edit` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `cashbook.close` | ✓ | ✓ | ✓ | – | – | – | – |
| `agent.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `agent.manage` | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `customer.manage` | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `branch.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `branch.manage` | – | – | ✓ | – | – | – | – |
| `user.manage` | – | – | ✓ | – | – | – | – |
| `holiday.manage` | – | – | ✓ | – | – | – | – |
| `settings.manage` | – | – | ✓ | – | – | – | – |
| `updates.manage` | – | – | ✓ | – | – | – | – |
| `bug.manage` | – | – | ✓ | – | – | – | – |
| `report.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `report.export` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `data.import` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `audit.view` | ✓ | ✓ | ✓ | – | – | – | ✓ |
| `deposit.insights` | ✓ | ✓ | ✓ | – | – | – | – |

Totals: CMD 29 · CEO 29 · ADMIN 35 · BRANCH_MANAGER 21 · CASHIER 16 · AGENT 8 · AUDITOR 9 of 35

*Generated from `src/lib/rbac.ts`. Regenerate rather than hand-edit — this table had drifted from
the code before it was last rebuilt.*

**ADMIN holds every permission.** The account that has to be able to see and do anything any
other role can. For this role alone the maker-checker separation that `case.approve` normally
provides does not apply: an Admin can approve a case and then pay it out. Every such action still
writes an audit row in the same transaction, which is what keeps it reviewable after the fact.

**AUDITOR holds no write permission of any kind** — enforced by an explicit deny-list in
`assertCan()`, so a permission added by mistake later still cannot grant an auditor write access.
Its `ALL` write scope above is therefore never reached.

**Reading and writing are different scopes.** Admin, CEO, CMD and Auditor read the compiled bank;
Branch Manager and Cashier read their assigned branch; Agent reads their own portfolio.
`inScope()` still picks independently between `ROLE_SCOPE` and `ROLE_WRITE_SCOPE` by asking
whether the permission is a write. See `13-COMPILED-BRANCH-IMPORT.md`.

**AGENT and AUDITOR cannot type in the Register** whatever permissions they hold — see
`REGISTER_READ_ONLY_ROLES` and `assertCanTypeRegister()`.

## Implementation

```ts
// every server action, without exception
const session = await requireSession();
assertCan(session, 'case.approve', { branchId: c.branchId });   // throws ForbiddenError
```

`assertCan` checks three things in order:
1. the role holds the permission,
2. the role's scope contains the target row,
3. the role is not on the global deny-list for that permission class.
