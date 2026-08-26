# Removing Approval — Auto-Scheduling from the Maturity Date

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the `OPS_HEAD` role and the manual approval step, so a submitted maturity schedules itself: the first payout falls three calendar days after the instrument's maturity date, rolled forward to the next day the counter is open.

**Architecture:** The schedule stops being anchored to a human's approval date and becomes anchored to a date the customer already knows. `firstPayoutOn()` (already built and tested) computes it. Approval does not become automatic-approval-by-a-robot — the *step* goes away, and `submitCase()` grows the scheduling that `approveCase()` used to do. Neither `OPS_HEAD` nor the `APPROVED` status is deleted from its Postgres enum, because **Postgres has no `ALTER TYPE … DROP VALUE`** and historical audit rows still name them; both are retired *in the application* instead, which is the same stance this codebase already takes for register rows (cancel, never delete).

**Tech Stack:** TypeScript (strict), Vitest, Next.js App Router server actions, Drizzle ORM + Postgres 18, `bigint` paise only.

**Spec:** `docs/superpowers/specs/2026-08-24-payout-scheduling-overhaul-design.md` — note that the spec and `docs/adr/0003-schedule-anchored-to-approval.md` predate this reversal. Task 7 supersedes them; until it lands, treat them as stale on the anchor question only.

## Global Constraints

- **Money is `bigint` paise everywhere.** No `number`, no `float`, no `Decimal`.
- **`Σ(instalments) === maturityAmount`, exactly.** The runtime assertion in `generateSchedule` is never removed or weakened.
- **The money split does not change in this plan.** `payoutPlanFor(amount, windowDays)` keeps returning 12 daily / 6 alternate payouts for the default 15-day window. Only *where day one lands* changes. If a fuzz assertion about amounts fails, you have changed something you were not asked to change.
- **`payout-engine.ts` is not edited by this plan at all.** Not one line.
- **Every mutation still starts with `requireActor()` then `assertCan()`**, and every money-affecting mutation still writes an audit row in the same transaction.
- **Case row lock first, then re-read with `.for('update')`.** Lock order is always case → instalment/transaction.
- **Do not drop enum values.** `OPS_HEAD` stays in `roleEnum`; `APPROVED` stays in `caseStatusEnum` and remains the status a scheduled case holds. Retirement is: removed from the app's role tables, no longer assignable, no login path, existing user migrated.
- **Migrations are generated with `drizzle-kit generate`, never hand-written** (`CLAUDE.md` § Traps).
- **INV-5 still holds: `approved_on IS NULL OR approved_on >= form_submitted_on`.** This is a live CHECK constraint (`src/db/schema.ts:368`), and the new anchor is written into `approved_on`. It holds by construction — the anchor is never earlier than today and `formSubmittedOn` is never later than today — but a violation is the first thing to look at if the backfill rejects a row.
- Verification: `npm run typecheck`, `FUZZ_ITERATIONS=1000 npm test` (fast) or `npm test` (full 100k sweep before the final commit), `npm run test:db` after any change to `case-service.ts` or `payout-service.ts`.

## The two decisions this plan locks in

Both come from real data in the live register (81 cases, measured 2026-08-26), not from taste.

**1. A maturity date in the past does not schedule a payout in the past.**
The 78 cases sitting in `SUBMITTED` carry maturity dates from **2024-06-21 to 2026-12-07**. Anchoring naively on `maturityDate + 3` would hand a third of the register a first payout that has already been and gone, instantly overdue, with a deadline before today. So the anchor is `max(maturityDate + 3 calendar days, today)`, then rolled to the next open day. A case that matured last year starts paying now; a case maturing in December starts in December. `scheduleAnchorFor()` in Task 2 is the single definition.

**2. The window keeps its shape; only its start moves.**
Today the engine gets `anchorDate = approvedOn` plus `startOffsetWorkingDays: 3` (the processing days) and finds day one three *working* days later. Under auto-scheduling the three-day gap is already spent in *calendar* days by `firstPayoutOn()`, so passing the working-day offset as well would double-count it and push every first payout roughly a week out. The anchor therefore becomes the computed first-payout date and `startOffsetWorkingDays` becomes `0`, while `payoutPlanFor()` is left completely alone so the instalment count and the money split are untouched.

Consequence for the deadline: `deriveDeadline(anchor, windowDays, …)` currently measures from the approval day, and `windowDays` (15) is defined as *inclusive of the processing days*. With the anchor moved forward to day one of payouts, measuring 15 more working days would silently extend every promise by three days. The deadline becomes the schedule's own last payout date, which is what the SLA actually means and is already computed. Task 3 makes that change in one place.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `src/lib/payout-policy.ts` | Gains `scheduleAnchorFor()`. Stays pure, no I/O, no `Date.now()` — "today" is passed in. |
| `src/lib/rbac.ts` | `OPS_HEAD` removed from `ROLE_SCOPE`, `ROLE_WRITE_SCOPE`, `ROLE_LABEL`, `ROLE_SHORT`, `ROLE_PERMISSIONS`. `ASSIGNABLE_ROLES` added as the list the UI offers. |
| `src/db/schema.ts` | `activeRoleEnum` type helper excluding `OPS_HEAD`. Enums themselves unchanged. |
| `src/services/case-service.ts` | `submitCase()` schedules. `approveCase()` deleted. `ALLOWED_TRANSITIONS` loses the manual-review states as *targets*. |
| `src/services/schedule-service.ts` | `persistSchedule` anchors on the passed date with offset 0; deadline from the last payout. |
| `src/actions/cases.ts` | `approveCaseAction` deleted; `submitCaseAction` returns the schedule summary. |
| `src/app/(app)/approvals/` | Deleted. |
| `src/components/layout/nav-config.ts` | Approvals entry removed; `approvals` badge removed. |
| `scripts/backfill-auto-schedule.ts` | **New.** One-shot cutover for the 78 pending cases. Idempotent, audited. |
| `scripts/seed.ts` | `ops@bank.test` seeded as `ADMIN`. |

---

### Task 1: Retire `OPS_HEAD` from the permission matrix

Doing this first means every later task is typechecked against a world where the role is already gone — the compiler finds the call sites for you.

**Files:**
- Modify: `src/lib/rbac.ts`
- Modify: `src/db/schema.ts` (add `ActiveRole` type only)
- Test: `tests/rbac.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ASSIGNABLE_ROLES: readonly ActiveRole[]` — the roles a user may hold from now on.
  - `type ActiveRole = Exclude<Role, 'OPS_HEAD'>` (exported from `src/db/schema.ts`).
  - `ROLE_SCOPE`, `ROLE_WRITE_SCOPE`, `ROLE_LABEL`, `ROLE_SHORT`, `ROLE_PERMISSIONS` all re-typed `Record<ActiveRole, …>`.

- [ ] **Step 1: Write the failing test**

Add to `tests/rbac.test.ts`:

```ts
import { ASSIGNABLE_ROLES, ROLE_LABEL, ROLE_PERMISSIONS, ROLE_SCOPE, ROLE_WRITE_SCOPE } from '../src/lib/rbac';

describe('OPS_HEAD is retired', () => {
  it('is not assignable', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('OPS_HEAD');
  });

  it('appears in none of the role tables', () => {
    for (const table of [ROLE_SCOPE, ROLE_WRITE_SCOPE, ROLE_LABEL, ROLE_PERMISSIONS]) {
      expect(Object.keys(table)).not.toContain('OPS_HEAD');
    }
  });

  it('leaves every other role exactly as it was', () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(
      ['ADMIN', 'AGENT', 'AUDITOR', 'BRANCH_MANAGER', 'CASHIER', 'CEO', 'CMD'],
    );
  });

  it('still holds nobody above Admin', () => {
    // The existing invariant, restated against the narrowed table: Admin has everything,
    // and no other role holds a permission Admin lacks.
    for (const role of ASSIGNABLE_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(ROLE_PERMISSIONS.ADMIN.has(p)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/rbac.test.ts`
Expected: FAIL — `ASSIGNABLE_ROLES` is not exported.

- [ ] **Step 3: Add the `ActiveRole` type**

In `src/db/schema.ts`, directly below the existing `export type Role = …` (near line 702):

```ts
/**
 * The roles a user may actually hold.
 *
 * `OPS_HEAD` stays in `roleEnum` because Postgres cannot drop an enum value and audit rows
 * still name it. It is retired in the application instead: not assignable, not in the
 * permission matrix, no login path. See docs/adr/0005.
 */
export type ActiveRole = Exclude<Role, 'OPS_HEAD'>;
```

- [ ] **Step 4: Narrow the role tables**

In `src/lib/rbac.ts`: change the import to `import type { ActiveRole, Role } from '@/db/schema';`, delete the `OPS_HEAD:` line from each of `ROLE_SCOPE`, `ROLE_WRITE_SCOPE`, `ROLE_LABEL`, `ROLE_SHORT` and `ROLE_PERMISSIONS`, and retype each as `Record<ActiveRole, …>`. Then add, below `ROLE_SHORT`:

```ts
/**
 * The roles the user manager may assign. Order is the org chart, not the alphabet.
 */
export const ASSIGNABLE_ROLES = [
  'CMD', 'CEO', 'ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR',
] as const satisfies readonly ActiveRole[];
```

- [ ] **Step 5: Fix the call sites the compiler finds**

Run: `npm run typecheck`

Expect errors in roughly: `src/actions/register.ts`, `src/actions/users.ts`, `src/actions/admin.ts`, `src/services/payout-service.ts`, `src/app/(app)/settings/users/user-manager.tsx`, `src/app/(app)/settings/users/[id]/user-dossier.tsx`, `src/app/(app)/maturities/page.tsx`.

For each: if the site lists roles that may do something, drop `'OPS_HEAD'` from the list. If it renders a role picker, source it from `ASSIGNABLE_ROLES`. Where a value of type `Role` (from the DB, so it could still be a legacy `OPS_HEAD`) must index a narrowed table, normalise it once rather than casting at each use:

```ts
/** A legacy OPS_HEAD row reads as an Admin — the role it was migrated to. */
export function activeRole(role: Role): ActiveRole {
  return role === 'OPS_HEAD' ? 'ADMIN' : role;
}
```

Put `activeRole()` in `src/lib/rbac.ts` and export it. Never cast with `as ActiveRole`.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — expect clean.
Run: `npx vitest run tests/rbac.test.ts` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rbac.ts src/db/schema.ts tests/rbac.test.ts src/actions src/app src/services
git commit -m "refactor(rbac): retire OPS_HEAD from the permission matrix"
```

---

### Task 2: `scheduleAnchorFor()` — the anchor that never points at the past

**Files:**
- Modify: `src/lib/payout-policy.ts`
- Test: `tests/payout-policy.test.ts`

**Interfaces:**
- Consumes: `firstPayoutOn(maturityDate, calendar)` and `AUTO_APPROVAL_CALENDAR_DAYS` from this same module; `WorkingDayCalendar`, `ISODate` from `working-days.ts`.
- Produces: `scheduleAnchorFor(maturityDate: ISODate, today: ISODate, calendar: WorkingDayCalendar): ISODate`

- [ ] **Step 1: Write the failing test**

Append to `tests/payout-policy.test.ts`:

```ts
describe('scheduleAnchorFor', () => {
  const cal = makeCalendar();

  it('is the ordinary first-payout date when the maturity is in the future', () => {
    // Maturity 20 Sept 2026, today 1 Sept -> 23 Sept, an ordinary Wednesday.
    expect(scheduleAnchorFor('2026-09-20', '2026-09-01', cal)).toBe('2026-09-23');
  });

  it('never schedules into the past', () => {
    // Matured June 2024 and never paid. It starts now, not in 2024.
    const anchor = scheduleAnchorFor('2024-06-22', '2026-09-10', cal);
    expect(anchor >= '2026-09-10').toBe(true);
    expect(anchor).toBe('2026-09-10'); // a Thursday, already open
  });

  it('rolls a today that is itself closed', () => {
    // Today is Sun 6 Sept 2026; a long-matured case starts Mon 7th.
    expect(scheduleAnchorFor('2024-06-22', '2026-09-06', cal)).toBe('2026-09-07');
    // Today is 1 Sept, inside the month-start cooldown -> 4 Sept.
    expect(scheduleAnchorFor('2024-06-22', '2026-09-01', cal)).toBe('2026-09-04');
  });

  it('keeps the three-day promise for a maturity that is only just past', () => {
    // Matured yesterday: the customer is still owed their three days.
    expect(scheduleAnchorFor('2026-09-09', '2026-09-10', cal)).toBe('2026-09-14');
  });

  it('always lands on an open day', () => {
    for (let i = 0; i < 400; i += 11) {
      const maturity = addDays('2024-01-01', i);
      const anchor = scheduleAnchorFor(maturity, '2026-09-10', cal);
      expect(isWorkingDay(anchor, cal)).toBe(true);
      expect(anchor >= '2026-09-10').toBe(true);
    }
  });

  it('rejects a date it cannot read', () => {
    expect(() => scheduleAnchorFor('not-a-date', '2026-09-10', cal)).toThrow();
  });
});
```

Extend the existing import from `../src/lib/payout-policy` with `scheduleAnchorFor`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/payout-policy.test.ts`
Expected: FAIL — `scheduleAnchorFor is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/payout-policy.ts`, below `firstPayoutOn`:

```ts
/**
 * The day a case's schedule actually starts.
 *
 * `firstPayoutOn` answers "three days after maturity", which is the right answer only while the
 * maturity is ahead of us. The live register carries cases that matured as long ago as 2024 and
 * were never paid; anchoring those on their own maturity date would generate a schedule that was
 * overdue the moment it was written, with a deadline in the past. So the anchor is the later of
 * the promised date and today, rolled to the next open day.
 *
 * Pure: "today" is a parameter, never `Date.now()`.
 */
export function scheduleAnchorFor(
  maturityDate: ISODate,
  today: ISODate,
  calendar: WorkingDayCalendar,
): ISODate {
  const promised = firstPayoutOn(maturityDate, calendar);
  if (promised >= today) return promised;
  return nextWorkingDay(today, calendar);
}
```

`nextWorkingDay` returns its argument unchanged when that day is already open, so a case whose promised date has passed starts today when today is open, and on the next open day when it is not.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/payout-policy.test.ts` — expect PASS.
Run: `npm run typecheck` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payout-policy.ts tests/payout-policy.test.ts
git commit -m "feat(policy): an anchor that never schedules into the past"
```

---

### Task 3: Anchor the persisted schedule on the first payout day

**Files:**
- Modify: `src/services/schedule-service.ts:50-110` (`persistSchedule`), `:179`
- Test: `tests/schedule-cadence.test.ts`

**Interfaces:**
- Consumes: `scheduleAnchorFor` (Task 2).
- Produces: `persistSchedule` where `anchorDate` now means *the first payout day*, not the approval day.

- [ ] **Step 1: Write the failing test**

Add to `tests/schedule-cadence.test.ts`:

```ts
describe('the anchor is day one, not a processing start', () => {
  const cal = makeCalendar();

  it('pays on the anchor itself', () => {
    const res = generateSchedule({
      totalPaise: 12_000_000n,
      days: payoutPlanFor(12_000_000n, 15).payoutDays,
      roundingPaise: 100_000n,
      startDate: '2026-09-23',
      calendar: cal,
      distribution: 'FRONT_LOADED',
      cashPolicy: { kind: 'CASH_ONLY' },
      startOnNextWorkingDay: false,
      stride: 1,
      startOffsetWorkingDays: 0,
      policyMaxDays: payoutPlanFor(12_000_000n, 15).payoutDays,
    });
    expect(res.instalments[0].dueOn).toBe('2026-09-23');
    expect(res.instalments).toHaveLength(12);
  });

  it('still splits the money into twelve, unchanged', () => {
    const plan = payoutPlanFor(12_000_000n, 15);
    expect(plan.payoutDays).toBe(12);
    expect(plan.stride).toBe(1);
    expect(plan.processingDays).toBe(3); // the constant is untouched; we just stop applying it here
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/schedule-cadence.test.ts`
Expected: FAIL on the first assertion — with `startOffsetWorkingDays: 0` the current call path still passes `plan.processingDays`, so `dueOn` is three working days later.

- [ ] **Step 3: Change the two lines in `persistSchedule`**

At `src/services/schedule-service.ts:57`, replace the anchor comment and guard:

```ts
  // The anchor IS day one. `scheduleAnchorFor` has already spent the three-calendar-day gap and
  // rolled onto an open day, so applying the working-day processing offset here as well would
  // double-count it and push every first payout about a week out.
  const anchor = anchorDate ?? caseRow.approvedOn;
  if (!anchor) throw new Error('Cannot generate a schedule without an anchor date');
```

At line 75, change `startOffsetWorkingDays: plan.processingDays` to:

```ts
    startOffsetWorkingDays: 0,
```

At line 106, replace the deadline derivation:

```ts
      // The promise is the last day money actually moves. Measuring another `windowDays` from an
      // anchor that is already day one would quietly extend every case by the processing days.
      deadlineOn: result.instalments[result.instalments.length - 1].dueOn,
```

At line 179, the reschedule path's fallback deadline: replace `deriveDeadline(caseRow.approvedOn ?? today, …)` with the equivalent last-instalment read for the rescheduled set. Remove the now-unused `deriveDeadline` import if nothing else in the file uses it — `npm run typecheck` will tell you.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/schedule-cadence.test.ts tests/payout-engine.test.ts` — expect PASS.
Run: `FUZZ_ITERATIONS=1000 npm test` — expect all green. **If any money assertion fails, stop**; the split was supposed to be untouched.

- [ ] **Step 5: Commit**

```bash
git add src/services/schedule-service.ts tests/schedule-cadence.test.ts
git commit -m "refactor(schedule): the anchor is day one of payouts"
```

---

### Task 4: `submitCase()` schedules; `approveCase()` goes

This is the load-bearing task. It runs against a real database, so `npm run test:db` is not optional here.

**Files:**
- Modify: `src/services/case-service.ts:206-224` (`submitCase`), delete `:248-365` (`ApproveInput`, `approveCase`), `:35-46` (`ALLOWED_TRANSITIONS`)
- Modify: `src/actions/cases.ts` — delete `approveCaseAction` and `approveSchema`
- Test: `tests/integration/auto-schedule.test.ts` (new)

**Interfaces:**
- Consumes: `scheduleAnchorFor` (Task 2), `persistSchedule` (Task 3).
- Produces: `submitCase(actor, caseId, meta?)` returning
  `{ ok: true; caseNumber: string; instalments: number; firstPayoutOn: ISODate; lastPayoutOn: ISODate; warnings: string[] }`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/auto-schedule.test.ts`, following the setup already used by `tests/integration/concurrency.test.ts` (same DB bootstrap and teardown — copy its harness, do not invent a new one):

```ts
describe('submitting schedules the case', () => {
  it('moves straight to APPROVED with a full schedule', async () => {
    const { caseId } = await createCase({ maturityAmountPaise: 12_000_000n, instrumentMaturityOn: '2026-09-20' });
    const res = await submitCase(agent, caseId);

    expect(res.ok).toBe(true);
    expect(res.instalments).toBe(12);
    expect(res.firstPayoutOn).toBe('2026-09-23');

    const row = await getCase(caseId);
    expect(row.status).toBe('APPROVED');
    expect(row.approvedById).toBeNull();     // nobody approved it
    expect(row.approvedOn).toBe('2026-09-23'); // the anchor, kept for the SLA clock
  });

  it('writes both events and an audit row in the same transaction', async () => {
    const { caseId } = await createCase({ instrumentMaturityOn: '2026-09-20' });
    await submitCase(agent, caseId);
    const events = await getEvents(caseId);
    expect(events.map((e) => e.type)).toEqual(['SUBMITTED', 'SCHEDULE_GENERATED']);
    const audit = await getAudit(caseId);
    expect(audit.some((a) => a.action === 'case.submitted')).toBe(true);
  });

  it('is idempotent — a second submit is refused, not double-scheduled', async () => {
    const { caseId } = await createCase({ instrumentMaturityOn: '2026-09-20' });
    await submitCase(agent, caseId);
    await expect(submitCase(agent, caseId)).rejects.toThrow(/already/i);
    expect((await getInstalments(caseId)).length).toBe(12);
  });

  it('refuses a case with no maturity date rather than guessing', async () => {
    const { caseId } = await createCase({ instrumentMaturityOn: null });
    await expect(submitCase(agent, caseId)).rejects.toThrow(/maturity date/i);
  });

  it('starts a long-matured case today, not in the past', async () => {
    const { caseId } = await createCase({ instrumentMaturityOn: '2024-06-22' });
    const res = await submitCase(agent, caseId);
    expect(res.firstPayoutOn >= todayISO()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:db`
Expected: FAIL — `submitCase` returns `{ ok: true }` only and leaves the case `SUBMITTED`.

- [ ] **Step 3: Narrow `ALLOWED_TRANSITIONS` first**

Do this before the rewrite, or the new `submitCase` will throw `INVALID_TRANSITION` on a `DRAFT` case the moment you run it — `DRAFT → APPROVED` is not currently a legal move.

`SUBMITTED` and `UNDER_REVIEW` stay in the table as *sources* only, because 78 live rows still sit in `SUBMITTED` until Task 6 drains them:

```ts
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  // No longer a destination — retained as a source until the backfill drains the last one.
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'CANCELLED'],
  RETURNED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};
```

- [ ] **Step 4: Rewrite `submitCase`**

Replace the body of `submitCase` in `src/services/case-service.ts`:

```ts
/**
 * Submitting a maturity is now the whole workflow.
 *
 * There is no Ops Head to approve it. The schedule is generated here, anchored to a date the
 * customer already knows — their maturity date plus three calendar days — rather than to the
 * moment a member of staff happened to click a button. The case lands in APPROVED because that
 * is what APPROVED has always meant downstream: payable. Nobody approved it, so `approvedById`
 * stays null and the audit row says so.
 */
export async function submitCase(
  actor: SessionUser,
  caseId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);

    if (c.status === 'APPROVED' || c.status === 'IN_PROGRESS' || c.status === 'COMPLETED') {
      throw new WorkflowError('This case has already been submitted and scheduled.', 'ALREADY_SCHEDULED');
    }
    assertTransition(c.status, 'APPROVED');

    if (!c.instrumentMaturityOn) {
      throw new WorkflowError(
        `${c.caseNumber} has no maturity date, so its first payout cannot be worked out. ` +
          'Add the maturity date and submit again.',
        'NO_MATURITY_DATE',
      );
    }

    const policy = await getBranchPolicy(c.branchId, tx);
    const anchor = scheduleAnchorFor(c.instrumentMaturityOn, todayISO(), policy.calendar);

    await tx
      .update(maturityCases)
      .set({
        status: 'APPROVED',
        submittedAt: new Date(),
        approvedOn: anchor,
        approvedAt: new Date(),
        approvedById: null,
        returnReason: null,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, caseId));

    const updated = { ...c, approvedOn: anchor, status: 'APPROVED' as const };

    const schedule = await persistSchedule({
      tx,
      caseRow: updated,
      calendar: policy.calendar,
      anchorDate: anchor,
      branchDailyCashComfortPaise: policy.dailyCashComfortPaise,
    });

    await logEvent(tx, caseId, 'SUBMITTED', actor.id, { from: c.status, to: 'APPROVED' });
    await logEvent(tx, caseId, 'SCHEDULE_GENERATED', actor.id, {
      note:
        `${schedule.effectiveDays} instalments, ${schedule.firstPayoutDate} → ${schedule.lastPayoutDate}, ` +
        `${formatPaise(schedule.totalCashPaise)} cash + ${formatPaise(schedule.totalOnlinePaise)} online`,
    });

    await writeAudit(tx, actor, {
      action: 'case.submitted',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary:
        `${c.caseNumber} submitted and auto-scheduled from maturity ${c.instrumentMaturityOn} — ` +
        `${formatPaise(c.maturityAmountPaise)} over ${schedule.effectiveDays} days, ` +
        `${schedule.firstPayoutDate} → ${schedule.lastPayoutDate}`,
      before: { status: c.status },
      after: {
        status: 'APPROVED',
        anchor,
        instalments: schedule.effectiveDays,
        firstPayoutOn: schedule.firstPayoutDate,
        lastPayoutOn: schedule.lastPayoutDate,
      },
      ...meta,
    });

    return {
      ok: true as const,
      caseNumber: c.caseNumber,
      instalments: schedule.effectiveDays,
      firstPayoutOn: schedule.firstPayoutDate,
      lastPayoutOn: schedule.lastPayoutDate,
      warnings: schedule.warnings,
    };
  });
}
```

- [ ] **Step 5: Delete `approveCase` and its action**

Delete `ApproveInput` and `approveCase` from `src/services/case-service.ts`. Delete `approveSchema` and `approveCaseAction` from `src/actions/cases.ts`, and drop `approveCase` from that file's import list. Leave `rejectCase` and `returnCase` alone — a case can still be rejected or returned, which is a different thing from not being approved yet.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — expect errors only in the UI files Task 5 deletes. Note them; do not fix them here.
Run: `npm run test:db` — expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/case-service.ts src/actions/cases.ts tests/integration/auto-schedule.test.ts
git commit -m "feat(cases): submitting a maturity schedules it"
```

---

### Task 5: Take the approvals screen out of the app

**Files:**
- Delete: `src/app/(app)/approvals/page.tsx`, `src/app/(app)/approvals/approval-queue.tsx`
- Modify: `src/components/layout/nav-config.ts`, `src/app/(app)/maturities/[id]/case-actions.tsx`, `src/app/(app)/dashboard/page.tsx`
- Test: `tests/rbac.test.ts` (nav coverage assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: a `NAV` with no approvals entry and no `'approvals'` badge kind.

- [ ] **Step 1: Write the failing test**

Add to `tests/rbac.test.ts`:

```ts
describe('the approvals screen is gone', () => {
  it('has no nav entry', () => {
    const hrefs = NAV.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain('/approvals');
  });

  it('and nothing still asks for the approvals badge', () => {
    const badges = NAV.flatMap((s) => s.items.map((i) => i.badge)).filter(Boolean);
    expect(badges).not.toContain('approvals');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/rbac.test.ts`
Expected: FAIL — `/approvals` is still in `NAV`.

- [ ] **Step 3: Delete the screen**

```bash
git rm -r "src/app/(app)/approvals"
```

- [ ] **Step 4: Clean the nav**

In `src/components/layout/nav-config.ts`, remove the `/approvals` item and narrow the badge union to `badge?: 'dueToday' | 'overdue';`. Then remove the `approvals` key from `getNavBadges` in `src/services/queries.ts` and delete the query that fed it.

- [ ] **Step 5: Clean the case detail and dashboard**

In `src/app/(app)/maturities/[id]/case-actions.tsx`, delete the Approve control and its form. In `src/app/(app)/dashboard/page.tsx`, the "awaiting approval" tile now counts nothing that a human can act on — relabel it "Awaiting schedule" and keep it only until Task 6's backfill runs, then delete it in that task's commit.

- [ ] **Step 6: Verify**

Run: `npm run typecheck` — expect clean.
Run: `FUZZ_ITERATIONS=1000 npm test` — expect PASS.
Run: `npm run build && npm run start`, then `node scripts/shot.mjs /maturities /tmp/reg.png admin@bank.test` and check the nav has no Approvals link, in **both** light and dark mode.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(nav): remove the approvals screen"
```

---

### Task 6: Backfill the 78 cases waiting for an approval that will never come

**Files:**
- Create: `scripts/backfill-auto-schedule.ts`
- Modify: `scripts/seed.ts` (`ops@bank.test` → `ADMIN`)

**Interfaces:**
- Consumes: `submitCase` (Task 4).
- Produces: a one-shot, idempotent, audited cutover.

- [ ] **Step 1: Write the script**

It must be a **loop over the audited single-row path**, never one bulk `UPDATE` — the same rule the register's bulk actions follow. Each row takes its own case lock and writes its own audit line, each failure is collected rather than aborting the batch.

```ts
/**
 * One-shot cutover: schedule every case still waiting on a human.
 *
 * Idempotent — it re-reads status per row and skips anything already scheduled, so it is safe
 * to run twice. Failures are collected, not thrown: "78 rows, two of which have no maturity
 * date" is the normal case.
 */
async function main() {
  const actor = await systemActor(); // an ADMIN; the audit trail must name who ran the cutover
  const pending = await db
    .select({ id: maturityCases.id, caseNumber: maturityCases.caseNumber })
    .from(maturityCases)
    .where(inArray(maturityCases.status, ['SUBMITTED', 'UNDER_REVIEW']));

  const failed: { caseNumber: string; reason: string }[] = [];
  let scheduled = 0;

  for (const row of pending) {
    try {
      const res = await submitCase(actor, row.id, { ip: null, userAgent: 'backfill-auto-schedule' });
      scheduled++;
      console.log(`  ${row.caseNumber}: ${res.instalments} instalments, ${res.firstPayoutOn} → ${res.lastPayoutOn}`);
    } catch (e) {
      failed.push({ caseNumber: row.caseNumber, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log(`\nScheduled ${scheduled} of ${pending.length}.`);
  for (const f of failed) console.log(`  FAILED ${f.caseNumber}: ${f.reason}`);
  process.exit(failed.length ? 1 : 0);
}
```

- [ ] **Step 2: Dry-run against a scratch database first**

Never run it first against the register. Restore a copy, point `DATABASE_URL` at the copy, run it, and check three things: every row moved to `APPROVED`; `Σ(instalments) === maturityAmount` for a sampled case; no first payout date is before today.

```bash
psql -c "SELECT status, COUNT(*) FROM maturity_cases GROUP BY status"
psql -c "SELECT MIN(due_on) FROM instalments"   # must be >= today
```

- [ ] **Step 3: Run it for real, after a backup**

```bash
pg_dump --format=custom --file=backup-before-cutover.dump "$DATABASE_URL"
npx tsx scripts/backfill-auto-schedule.ts
```

Expect: `Scheduled 78 of 78.` The one case with no maturity date is `CANCELLED` and is not in the pending set, so it should not appear.

- [ ] **Step 4: Migrate the retired account**

```sql
UPDATE users SET role = 'ADMIN' WHERE role = 'OPS_HEAD';
```

Then in `scripts/seed.ts` line 87, change `role: 'OPS_HEAD' as const` to `role: 'ADMIN' as const` and the name to `'Operations Head (retired role — now Admin)'`, so a reseeded demo matches.

- [ ] **Step 5: Verify**

```bash
psql -c "SELECT role, COUNT(*) FROM users GROUP BY role"          # no OPS_HEAD
psql -c "SELECT status, COUNT(*) FROM maturity_cases GROUP BY status"  # no SUBMITTED/UNDER_REVIEW
npm run test:db
node scripts/smoke.mjs
```

- [ ] **Step 6: Delete the now-dead "awaiting approval" tile**

With the pending set drained, remove the tile from `src/app/(app)/dashboard/page.tsx` and the `awaitingApproval` aggregates from `src/services/queries.ts` (lines ~116, ~275, ~672, ~984 and the `['SUBMITTED','UNDER_REVIEW']` filters at ~340 and ~984).

- [ ] **Step 7: Commit**

```bash
git add scripts/backfill-auto-schedule.ts scripts/seed.ts src/app src/services
git commit -m "chore(cutover): schedule the pending register and retire the ops account"
```

---

### Task 7: Make the documentation stop saying the opposite

The repo currently instructs the next reader to anchor on approval. Leaving that in place is how this gets undone by accident.

**Files:**
- Create: `docs/adr/0005-schedule-anchored-to-maturity.md`
- Modify: `docs/adr/0003-schedule-anchored-to-approval.md` (mark superseded), `CLAUDE.md`, `docs/03-PAYOUT-ENGINE.md`, `docs/04-RBAC.md`, `docs/00-DESIGN-OVERVIEW.md`

- [ ] **Step 1: Write ADR-0005**

Record: the decision, that the anchor is `max(maturity + 3 calendar days, today)` rolled forward, why calendar rather than working days, why `APPROVED` and `OPS_HEAD` survive in their enums, and that `approvedById IS NULL` is how an auto-scheduled case is told apart from a historically approved one.

- [ ] **Step 2: Mark ADR-0003 superseded**

Add at the top: `> **Superseded by [ADR-0005](0005-schedule-anchored-to-maturity.md) on 2026-08-26.** The schedule is no longer anchored to approval; approval no longer exists.` Do not delete the file — the reasoning stays useful.

- [ ] **Step 3: Rewrite CLAUDE.md non-negotiable #6**

It currently reads that the schedule and SLA clock anchor to `approvedOn`. Replace with:

```markdown
6. **The schedule anchors to the customer's maturity date, not to any staff action.**
   `scheduleAnchorFor()` is the single definition: maturity + 3 CALENDAR days, never earlier
   than today, rolled to the next open day. `formSubmittedOn` is when the agent handed the form
   in and is not an anchor. `approvedOn` survives as the column holding that anchor and as the
   SLA clock's start; `approvedById IS NULL` marks a case the system scheduled rather than a
   person approved. There is no approval step and no Ops Head — see docs/adr/0005.
```

- [ ] **Step 4: Update the RBAC and engine docs**

In `docs/04-RBAC.md`, remove `OPS_HEAD` from the role table and note it is retired-not-deleted, with the reason (Postgres cannot drop an enum value). In `docs/03-PAYOUT-ENGINE.md`, update the window model: the anchor is day one, `startOffsetWorkingDays` is 0 from the service, and the deadline is the last instalment's date. Add a worked example for a case that matured in 2024.

- [ ] **Step 5: Mark the superseded phase plans**

Add a one-line superseded banner to the top of `docs/superpowers/plans/2026-08-24-payout-scheduling-phase-1-engine.md` and `-phase-2-editing.md` pointing here, so a future executor does not resume them into a world that no longer has approval.

- [ ] **Step 6: Full verification, then commit**

```bash
npm run typecheck
npm test                 # the full 100k fuzz sweep, not the fast one
npm run test:db
npm run build
node scripts/smoke.mjs
git add -A
git commit -m "docs: the schedule anchors to maturity, not approval"
```

---

## What this plan deliberately does not do

- **It does not touch `payout-engine.ts`.** The money arithmetic is unchanged; only the date the first instalment lands on moves.
- **It does not build the Register missed/taken tab.** That is the fourth part of the brainstorm and is independent of this one — it needs no migration and no RBAC change. It gets its own plan.
- **It does not drop `OPS_HEAD` or `APPROVED` from their Postgres enums.** Postgres has no `ALTER TYPE … DROP VALUE`; doing it properly means recreating the type and rewriting every dependent column, which risks history for no user-visible gain.
- **It does not remove `rejectCase` or `returnCase`.** Not-yet-approved and rejected are different states, and rejection is still a thing a manager does.
