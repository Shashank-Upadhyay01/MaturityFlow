# Roles & Permissions

## Roles

`CMD · CEO · ADMIN · OPS_HEAD · BRANCH_MANAGER · CASHIER · AGENT · AUDITOR`

## Scope

Every role carries a data scope, applied at the query layer:

| Scope | Roles | Effect |
|---|---|---|
| `ALL` | CMD, CEO, ADMIN, OPS_HEAD, AUDITOR | Every branch. |
| `BRANCH` | BRANCH_MANAGER, CASHIER | `WHERE branchId = session.branchId`. |
| `OWN` | AGENT | `WHERE agentId = session.agentId`. |

## Permission matrix

| Permission | CMD | CEO | ADMIN | OPS_HEAD | BR_MGR | CASHIER | AGENT | AUDITOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `case.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `case.create` | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | – |
| `case.submit` | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | – |
| `case.edit` | ✓ | ✓ | – | ✓ | ✓¹ | – | ✓¹ | – |
| `case.editApproved` | ✓ | ✓ | – | – | – | – | – | – |
| `case.approve` | ✓ | ✓ | – | ✓ | – | – | – | – |
| `case.reject` | ✓ | ✓ | – | ✓ | – | – | – | – |
| `case.return` | ✓ | ✓ | – | ✓ | – | – | – | – |
| `case.hold` | ✓ | ✓ | – | ✓ | ✓ | – | – | – |
| `case.cancel` | ✓ | ✓ | – | ✓ | – | – | – | – |
| `schedule.preview` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `schedule.override` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `schedule.reschedule` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| `payout.record` | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | – |
| `payout.reverse` | ✓ | ✓ | – | ✓ | – | – | – | – |
| `cash.plan` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `cash.setOpening` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `agent.view` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓² | ✓ |
| `agent.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `customer.manage` | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `branch.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `branch.manage` | – | – | ✓ | – | – | – | – | – |
| `user.manage` | – | – | ✓ | – | – | – | – | – |
| `holiday.manage` | – | – | ✓ | – | – | – | – | – |
| `settings.manage` | – | – | ✓ | – | – | – | – | – |
| `report.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓² | ✓ |
| `report.export` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| `data.import` | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – |
| `audit.view` | ✓ | ✓ | ✓ | ✓ | – | – | – | ✓ |

¹ Only while the case is `DRAFT`, `SUBMITTED` or `RETURNED` — never after approval.
² Restricted to their own records by the `OWN` scope.

**AUDITOR holds no write permission of any kind** — enforced by an explicit deny-list in
`assertCan()`, so a future permission added by mistake still cannot grant an auditor write access.

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
