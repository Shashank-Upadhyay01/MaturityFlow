# Server Actions & Endpoints

There is no REST layer. Mutations are **Server Actions**; reads happen inside Server Components.
Every action follows the same five steps, in this order, without exception:

```ts
const { session, actor } = await requireActor();   // 1. authenticate
assertCan(actor, 'case.approve', { branchId });    // 2. authorise (throws)
const parsed = schema.safeParse(formData);         // 3. validate (Zod)
await db.transaction(async (tx) => { … });         // 4. execute + audit, atomically
revalidatePath('/dashboard');                      // 5. refresh caches
```

Errors are normalised by `toActionError()` (`src/actions/_result.ts`) into a message a branch clerk
can act on. Stack traces never reach the browser; a CHECK-constraint violation becomes a plain
sentence ("That payment would exceed the maturity amount.").

## Result shape

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };
```

## `src/actions/auth.ts`

| Action | Permission | Notes |
|---|---|---|
| `loginAction` | public | Generic failure message either way; 6 failures → 15-minute lock; every attempt audited. |
| `logoutAction` | session | Revokes the server-side session row, then clears the cookie. |
| `changePasswordAction` | session | Verifies the old password, enforces the policy, **revokes every other session**. |

## `src/actions/cases.ts`

| Action | Permission | Notes |
|---|---|---|
| `createCaseAction` | `case.create` | Accepts schedule **parameters** only. Saves as DRAFT or SUBMITTED. |
| `createCustomerAction` | `customer.manage` | Inline customer creation from the intake form. |
| `submitCaseAction` | `case.submit` | DRAFT/RETURNED → SUBMITTED. |
| `approveCaseAction` | `case.approve` | **The pivotal action.** Locks the case row, refuses if already approved (INV-7), refuses `approvedOn < formSubmittedOn` (INV-5), then generates and persists the schedule server-side. |
| `rejectCaseAction` / `returnCaseAction` | `case.reject` / `case.return` | Reason mandatory. |
| `setHoldAction` | `case.hold` | Pause/resume; resuming restores APPROVED or IN_PROGRESS correctly. |
| `cancelCaseAction` | `case.cancel` | Refused outright if any money has been paid. |
| `rescheduleCaseAction` | `schedule.reschedule` | Re-plans the unpaid remainder; returns `slaBreachUnavoidable`. |

## `src/actions/payouts.ts`

| Action | Permission | Notes |
|---|---|---|
| `recordPayoutAction` | `payout.record` | `SELECT … FOR UPDATE` on the case, so two cashiers cannot double-spend the same balance. Validates against INV-4 in code **and** at the database. Only roles holding `schedule.override` may exceed a planned daily amount. |
| `reversePayoutAction` | `payout.reverse` | Flags the transaction, unwinds the running totals, keeps the row. |

## `src/actions/cashbook.ts`

| Action | Permission | Notes |
|---|---|---|
| `saveCashbookDayAction` | `cashbook.edit` | Optimistic-version save for manual portal figures, denomination count and day note. |
| `addCashbookEntryAction` / `updateCashbookEntryAction` / `voidCashbookEntryAction` | `cashbook.edit` | Category + channel movement; parent day is locked before the entry is re-read. Rows are voided, never deleted. |
| `addCashbookCommitmentAction` / `updateCashbookCommitmentAction` / `voidCashbookCommitmentAction` | `cashbook.edit` | Named Given Cash, Due Amount or Pending Withdrawal. Person/customer name is mandatory. |
| `setCashbookCommitmentSettledAction` | `cashbook.edit` | Settles/reopens an outstanding named item, including a carried item whose source day is closed; does not rewrite the close snapshot. |
| `requestCashbookCloseAction` | `cashbook.edit` | OPEN → CLOSE_REQUESTED. Requires activity and a reason when cash difference is non-zero. |
| `confirmCashbookCloseAction` | `cashbook.close` | Confirms a server-recomputed, string-only close snapshot or returns the day to OPEN. |
| `reopenCashbookDayAction` | `cashbook.close` | CLOSED → OPEN with mandatory reason and revision/audit history. |

## `src/actions/documents.ts`

| Action | Permission | Notes |
|---|---|---|
| `uploadCaseDocumentAction` | `case.edit` (scoped to the case) | Up to 10 files, 10 MB each, PDF/JPG/PNG/WEBP/HEIC/TIFF only. The storage key is generated server-side — a browser-supplied filename never builds a path. Each file's SHA-256 is recorded in the audit trail. |
| `verifyCaseDocumentAction` | `case.approve` | The KYC sign-off, recorded per file with who and when. |

> A `'use server'` module may only export **async functions** — every export is rewritten into a
> server-action reference. Constants a component needs to *read* (`DOCUMENT_KINDS`,
> `DOCUMENT_KIND_LABEL`) therefore live in `src/lib/documents.ts`, not in the action file.

## `src/actions/admin.ts`

| Action | Permission |
|---|---|
| `setCashOpeningAction` | `cash.setOpening` |
| `addHolidayAction` / `deleteHolidayAction` | `holiday.manage` |
| `createAgentAction` | `agent.manage` |
| `upsertBranchAction` | `branch.manage` |
| `createUserAction` | `user.manage` |
| `setUserActiveAction` | `user.manage` — deactivating revokes live sessions immediately |
| `resetUserPasswordAction` | `user.manage` — forces a change at next sign-in |

## HTTP endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/health` | public | `{ status, database, latencyMs }`. 503 when Postgres is unreachable. For the Docker healthcheck and uptime monitors. |
| `GET /api/export/cases?format=csv\|xlsx&from&to` | `report.export` | Branch-scoped case register. CSV is UTF-8 BOM'd so Excel opens it correctly; XLSX is a real workbook with a frozen header, number formats and an autofilter. The export itself is audited. |
| `GET /api/export/cashbook?branchId&date&format=csv\|xlsx` | `cashbook.view` + `report.export` | No-store daily cashbook export. Workbook contains Summary, Entries, Named items and Cash count; CSV carries the same sections. |
| `GET /api/export/cashbook/image?branchId&date` | `cashbook.view` | No-store PNG summary for native sharing. Deliberately omits named-person details. |
| `GET /api/documents/:id` | `case.view` on the **parent case** | Streams an attached document. The storage key is looked up from the row, never taken from the request, and access is re-checked against the case's branch/agent — a branch manager cannot fetch another branch's KYC scan by guessing an id. `Cache-Control: private, no-store` + `nosniff`. |

## Reading data

Queries live in `src/services/queries.ts` and every list funnels through `caseScope(actor)`:

```ts
ALL    → no filter
BRANCH → WHERE branchId = session.branchId
OWN    → WHERE agentId  = session.agentId
```

Scoping is applied at the data layer, not by the caller, so a page cannot forget it.
