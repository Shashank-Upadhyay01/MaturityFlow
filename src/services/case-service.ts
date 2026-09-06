import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import {
  agents,
  branches,
  caseCounters,
  caseEvents,
  customers,
  maturityCases,
  type CaseEventType,
  type CaseStatus,
  type MaturityCase,
} from '@/db/schema';
import { writeAudit, type AuditAction } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import { formatCaseNumber, newId } from '@/lib/id';
import { nextWorkingDay, todayISO, type WorkingDayCalendar } from '@/lib/working-days';
import { scheduleAnchorFor } from '@/lib/payout-policy';
import { getBranchPolicy } from './calendar-service';
import { persistSchedule, persistReschedule, persistReplanWindow } from './schedule-service';

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/** Which transitions the workflow permits. Anything not listed here is refused. */
/**
 * There is no approval step, so a submitted case goes straight to APPROVED — the status that has
 * always meant "payable" downstream. SUBMITTED and UNDER_REVIEW survive as *sources* only: no code
 * path moves a case into them any more, but rows written before the cutover still sit there and
 * must be able to leave.
 */
const ALLOWED_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  DRAFT: ['APPROVED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'],
  RETURNED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED', 'COMPLETED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canTransition(from: CaseStatus, to: CaseStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

function assertTransition(from: CaseStatus, to: CaseStatus) {
  if (!canTransition(from, to)) {
    throw new WorkflowError(
      `A case that is "${from}" cannot move to "${to}".`,
      'INVALID_TRANSITION',
    );
  }
}

async function nextCaseNumber(tx: Tx, branchCode: string, year: number): Promise<string> {
  const key = `${branchCode}|${year}`;
  const [row] = await tx
    .insert(caseCounters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({
      target: caseCounters.key,
      set: { value: sql`${caseCounters.value} + 1` },
    })
    .returning({ value: caseCounters.value });
  return formatCaseNumber(branchCode, year, row.value);
}

async function logEvent(
  tx: Tx,
  caseId: string,
  type: CaseEventType,
  actorId: string | null,
  opts: { from?: CaseStatus; to?: CaseStatus; note?: string } = {},
) {
  await tx.insert(caseEvents).values({
    id: newId('evt'),
    caseId,
    type,
    fromStatus: opts.from ?? null,
    toStatus: opts.to ?? null,
    note: opts.note ?? null,
    actorId,
  });
}

/** Load a case for update, taking a row lock so concurrent approvals/payouts serialise. */
async function lockCase(tx: Tx, caseId: string): Promise<MaturityCase> {
  const [row] = await tx
    .select()
    .from(maturityCases)
    .where(eq(maturityCases.id, caseId))
    .for('update')
    .limit(1);
  if (!row) throw new WorkflowError('Case not found', 'NOT_FOUND');
  return row;
}

// ── Create ────────────────────────────────────────────────────────────────

export interface CreateCaseInput {
  branchId: string;
  agentId: string;
  customerId: string;
  maturityAmountPaise: bigint;
  formSubmittedOn: string;
  schemeName?: string | null;
  policyNumber?: string | null;
  instrumentMaturityOn?: string | null;
  windowDays: number;
  roundingPaise: bigint;
  distribution: MaturityCase['distribution'];
  cashPolicy: MaturityCase['cashPolicy'];
  cashCapPerDayPaise?: bigint | null;
  startOnNextWorkingDay?: boolean;
  notes?: string | null;
  submitNow?: boolean;
}

export async function createCase(
  actor: SessionUser,
  input: CreateCaseInput,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ id: string; caseNumber: string }> {
  return db.transaction(async (tx) => {
    const [branch] = await tx
      .select({ code: branches.code, id: branches.id })
      .from(branches)
      .where(eq(branches.id, input.branchId))
      .limit(1);
    if (!branch) throw new WorkflowError('Branch not found', 'NOT_FOUND');

    const [agent] = await tx
      .select({ id: agents.id, branchId: agents.branchId })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) throw new WorkflowError('Agent not found', 'NOT_FOUND');
    if (agent.branchId !== input.branchId) {
      throw new WorkflowError('That agent does not belong to the selected branch', 'MISMATCH');
    }

    const [customer] = await tx
      .select({ id: customers.id, branchId: customers.branchId, name: customers.name })
      .from(customers)
      .where(eq(customers.id, input.customerId))
      .limit(1);
    if (!customer) throw new WorkflowError('Customer not found', 'NOT_FOUND');

    const year = Number(input.formSubmittedOn.slice(0, 4));
    const caseNumber = await nextCaseNumber(tx, branch.code, year);
    const id = newId('case');
    // `submitNow` means scheduled, not parked: there is no queue to park in any more.
    const status: CaseStatus = input.submitNow ? 'APPROVED' : 'DRAFT';

    await tx.insert(maturityCases).values({
      id,
      caseNumber,
      branchId: input.branchId,
      agentId: input.agentId,
      customerId: input.customerId,
      maturityAmountPaise: input.maturityAmountPaise,
      schemeName: input.schemeName ?? null,
      policyNumber: input.policyNumber ?? null,
      instrumentMaturityOn: input.instrumentMaturityOn ?? null,
      formSubmittedOn: input.formSubmittedOn,
      submittedAt: input.submitNow ? new Date() : null,
      status,
      windowDays: input.windowDays,
      roundingPaise: input.roundingPaise,
      distribution: input.distribution,
      cashPolicy: input.cashPolicy,
      cashCapPerDayPaise: input.cashPolicy === 'CASH_CAP' ? (input.cashCapPerDayPaise ?? 0n) : null,
      startOnNextWorkingDay: input.startOnNextWorkingDay ?? false,
      notes: input.notes ?? null,
      createdById: actor.id,
    });

    await logEvent(tx, id, 'CREATED', actor.id, { to: status });
    if (input.submitNow) await logEvent(tx, id, 'SUBMITTED', actor.id, { to: 'APPROVED' });

    await writeAudit(tx, actor, {
      action: input.submitNow ? 'case.submitted' : 'case.created',
      entity: 'MaturityCase',
      entityId: id,
      branchId: input.branchId,
      summary: `${caseNumber} — ${customer.name}, ${formatPaise(input.maturityAmountPaise)} over ${input.windowDays} working days`,
      after: {
        caseNumber,
        maturityAmountPaise: input.maturityAmountPaise,
        windowDays: input.windowDays,
        status,
      },
      ...meta,
    });

    // Created *and* submitted in one go: schedule it here rather than leaving it in a status that
    // nothing will ever pick up. Same helper as `submitCase`, so the anchor cannot drift between
    // the two doors into the same state.
    if (input.submitNow) {
      const [row] = await tx
        .select()
        .from(maturityCases)
        .where(eq(maturityCases.id, id))
        .limit(1);
      const policy = await getBranchPolicy(input.branchId, tx);
      const anchor = anchorForCase(row, policy.calendar);
      await tx
        .update(maturityCases)
        .set({ approvedOn: anchor, approvedAt: new Date(), approvedById: null, updatedAt: new Date() })
        .where(eq(maturityCases.id, id));
      await scheduleCaseInTx(tx, actor, row, anchor);
    }

    return { id, caseNumber };
  });
}

// ── Submit — the moment the money becomes payable ─────────────────────────

/**
 * Generate and persist a case's schedule, inside a transaction that already holds its row lock.
 *
 * Shared by `submitCase` and by `createCase({ submitNow: true })` so there is exactly one place
 * that decides when money becomes payable. Two paths would be two chances to get the anchor
 * wrong, and only one of them would be covered by the tests.
 *
 * The caller is responsible for the status update and for its own audit row; this writes the
 * instalments and the SCHEDULE_GENERATED event.
 */
async function scheduleCaseInTx(
  tx: Tx,
  actor: Pick<SessionUser, 'id'>,
  caseRow: MaturityCase,
  anchor: string,
  remainingPaise?: bigint,
) {
  const policy = await getBranchPolicy(caseRow.branchId, tx);
  const schedule = await persistSchedule({
    tx,
    caseRow: { ...caseRow, approvedOn: anchor, status: 'APPROVED' as const },
    calendar: policy.calendar,
    anchorDate: anchor,
    branchDailyCashComfortPaise: policy.dailyCashComfortPaise,
    remainingPaise,
  });

  await logEvent(tx, caseRow.id, 'SCHEDULE_GENERATED', actor.id, {
    note:
      `${schedule.effectiveDays} instalments, ${schedule.firstPayoutDate} → ${schedule.lastPayoutDate}, ` +
      `${formatPaise(schedule.totalCashPaise)} cash + ${formatPaise(schedule.totalOnlinePaise)} online`,
  });

  return schedule;
}

/**
 * Approve and schedule a case that already exists inside this transaction.
 *
 * The same two steps `submitCase` performs, without opening a transaction of its own, so a bulk
 * caller — the Excel import — can schedule hundreds of rows inside the one transaction that
 * created them. Calling `submitCase` per row instead would open a nested transaction on a second
 * connection while the outer one still holds those case locks: that is a deadlock, not a slow
 * import.
 *
 * `approvedById` stays null for the same reason it does in `submitCase` — nobody approved this,
 * the schedule was derived — and that null is how an auto-scheduled case is told apart later.
 */
export async function approveAndScheduleInTx(
  tx: Tx,
  actor: Pick<SessionUser, 'id'>,
  caseRow: MaturityCase,
  calendar: WorkingDayCalendar,
  /**
   * What is left to pay, when the row arrives with payments already made against it. Left unset
   * by every caller approving a fresh case, where the whole amount is still outstanding.
   */
  remainingPaise?: bigint,
) {
  const anchor = anchorForCase(caseRow, calendar);
  await tx
    .update(maturityCases)
    .set({
      status: 'APPROVED',
      approvedOn: anchor,
      approvedAt: new Date(),
      approvedById: null,
      updatedAt: new Date(),
    })
    .where(eq(maturityCases.id, caseRow.id));
  const schedule = await scheduleCaseInTx(tx, actor, caseRow, anchor, remainingPaise);
  return { anchor, schedule };
}

/**
 * Work out where a case's schedule starts, or say why it cannot.
 *
 * The anchor comes from the customer's own maturity date, so a case without one cannot be
 * scheduled at all. Refusing is the only honest answer — guessing a date here would put real
 * money on a day nobody agreed to.
 */
function anchorForCase(caseRow: MaturityCase, calendar: WorkingDayCalendar): string {
  /*
    A payment date the branch supplied wins outright.

    It is the date written on the form and the date the customer was given, so the schedule
    starts there — that is what the Payment Date column has always claimed to mean. Imports used
    to ignore it and re-derive the start from the maturity date, so a register carrying payment
    dates of the 9th, 10th and 11th generated every one of its first payouts on the 7th, and the
    counter would have paid people a week before they were told to come.

    Rolled onto the next open day only when that exact date is closed, because the counter cannot
    pay on a Sunday or a declared holiday. Deliberately NOT clamped forward to today: a window the
    branch dated last week really is late, and the missed columns exist to say so rather than to
    have the date quietly moved.
  */
  if (caseRow.paymentOn) return nextWorkingDay(caseRow.paymentOn, calendar);

  if (!caseRow.instrumentMaturityOn) {
    throw new WorkflowError(
      `${caseRow.caseNumber} has no maturity date and no payment date, so its first payout cannot ` +
        'be worked out. Add one of them and submit again.',
      'NO_MATURITY_DATE',
    );
  }
  return scheduleAnchorFor(caseRow.instrumentMaturityOn, todayISO(), calendar);
}

// ── Submit / return ───────────────────────────────────────────────────────

/**
 * Submitting a maturity is now the whole workflow.
 *
 * There is no Ops Head to approve it. The schedule is generated here, anchored to a date the
 * customer already knows — their maturity date plus three calendar days — rather than to the
 * moment a member of staff happened to click a button. The case lands in APPROVED because that
 * is what APPROVED has always meant downstream: payable. Nobody approved it, so `approvedById`
 * stays null, and that null is how an auto-scheduled case is told apart from a historically
 * approved one.
 */
export async function submitCase(
  actor: SessionUser,
  caseId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);

    // Idempotent. A second click finds the case already scheduled and stops.
    if (c.status === 'APPROVED' || c.status === 'IN_PROGRESS' || c.status === 'COMPLETED') {
      throw new WorkflowError(
        'This case has already been submitted and scheduled.',
        'ALREADY_SCHEDULED',
      );
    }
    assertTransition(c.status, 'APPROVED');

    const policy = await getBranchPolicy(c.branchId, tx);
    const anchor = anchorForCase(c, policy.calendar);

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

    await logEvent(tx, caseId, 'SUBMITTED', actor.id, { from: c.status, to: 'APPROVED' });
    const schedule = await scheduleCaseInTx(tx, actor, c, anchor);

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

export async function returnCase(actor: SessionUser, caseId: string, reason: string, meta = {}) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    assertTransition(c.status, 'RETURNED');
    await tx
      .update(maturityCases)
      .set({ status: 'RETURNED', returnReason: reason, updatedAt: new Date() })
      .where(eq(maturityCases.id, caseId));
    await logEvent(tx, caseId, 'RETURNED', actor.id, { from: c.status, to: 'RETURNED', note: reason });
    await writeAudit(tx, actor, {
      action: 'case.returned',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary: `${c.caseNumber} returned to agent: ${reason}`,
      ...meta,
    });
    return { ok: true as const };
  });
}

export async function rejectCase(actor: SessionUser, caseId: string, reason: string, meta = {}) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    assertTransition(c.status, 'REJECTED');
    await tx
      .update(maturityCases)
      .set({ status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason, updatedAt: new Date() })
      .where(eq(maturityCases.id, caseId));
    await logEvent(tx, caseId, 'REJECTED', actor.id, { from: c.status, to: 'REJECTED', note: reason });
    await writeAudit(tx, actor, {
      action: 'case.rejected',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary: `${c.caseNumber} rejected: ${reason}`,
      ...meta,
    });
    return { ok: true as const };
  });
}

export async function setHold(
  actor: SessionUser,
  caseId: string,
  hold: boolean,
  reason: string | null,
  meta = {},
) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    const to: CaseStatus = hold
      ? 'ON_HOLD'
      : c.paidCashPaise + c.paidOnlinePaise > 0n
        ? 'IN_PROGRESS'
        : 'APPROVED';
    assertTransition(c.status, to);
    await tx
      .update(maturityCases)
      .set({ status: to, holdReason: hold ? reason : null, updatedAt: new Date() })
      .where(eq(maturityCases.id, caseId));
    await logEvent(tx, caseId, hold ? 'PUT_ON_HOLD' : 'RESUMED', actor.id, {
      from: c.status,
      to,
      note: reason ?? undefined,
    });
    await writeAudit(tx, actor, {
      action: hold ? 'case.held' : 'case.resumed',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary: hold ? `${c.caseNumber} put on hold: ${reason}` : `${c.caseNumber} resumed`,
      ...meta,
    });
    return { ok: true as const };
  });
}

export async function cancelCase(actor: SessionUser, caseId: string, reason: string, meta = {}) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (c.paidCashPaise + c.paidOnlinePaise > 0n) {
      throw new WorkflowError(
        'This case has money already paid out and cannot be cancelled. Put it on hold instead.',
        'HAS_PAYMENTS',
      );
    }
    assertTransition(c.status, 'CANCELLED');
    await tx
      .update(maturityCases)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), notes: reason, updatedAt: new Date() })
      .where(eq(maturityCases.id, caseId));
    await logEvent(tx, caseId, 'CANCELLED', actor.id, { from: c.status, to: 'CANCELLED', note: reason });
    await writeAudit(tx, actor, {
      action: 'case.cancelled',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary: `${c.caseNumber} cancelled: ${reason}`,
      ...meta,
    });
    return { ok: true as const };
  });
}

/** Re-plan the unpaid remainder over the days that are left. */
export async function rescheduleCase(actor: SessionUser, caseId: string, reason: string, meta = {}) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (!['APPROVED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status)) {
      throw new WorkflowError('Only an approved, in-progress or held case can be rescheduled.', 'NOT_SCHEDULABLE');
    }
    const policy = await getBranchPolicy(c.branchId, tx);
    const out = await persistReschedule({
      tx,
      caseRow: c,
      calendar: policy.calendar,
      branchDailyCashComfortPaise: policy.dailyCashComfortPaise,
    });
    if (!out) throw new WorkflowError('Nothing left to reschedule — this case is fully paid.', 'NOTHING_DUE');

    await logEvent(tx, caseId, 'RESCHEDULED', actor.id, {
      note: `${out.result.installments.length} instalments to ${out.result.lastPayoutDate}. ${reason}`,
    });
    await writeAudit(tx, actor, {
      action: 'schedule.rescheduled',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary:
        `${c.caseNumber} rescheduled — ${formatPaise(out.result.totalPaise)} over ` +
        `${out.result.installments.length} days to ${out.result.lastPayoutDate}. ${reason}`,
      after: {
        slaBreachUnavoidable: out.result.slaBreachUnavoidable,
        lastPayoutOn: out.result.lastPayoutDate,
      },
      ...meta,
    });
    return {
      ok: true as const,
      slaBreachUnavoidable: out.result.slaBreachUnavoidable,
      lastPayoutOn: out.result.lastPayoutDate,
      instalments: out.result.installments.length,
    };
  });
}

/** Type a new day-count; remaining money is rebuilt from today over that many working days. */
export async function replanWithWindow(
  actor: SessionUser,
  caseId: string,
  windowDays: number,
  reason: string,
  meta = {},
) {
  return db.transaction(async (tx) => {
    const c = await lockCase(tx, caseId);
    if (!['APPROVED', 'IN_PROGRESS', 'ON_HOLD'].includes(c.status)) {
      throw new WorkflowError('Only an approved, in-progress or held case can be re-planned.', 'NOT_SCHEDULABLE');
    }
    const policy = await getBranchPolicy(c.branchId, tx);
    const out = await persistReplanWindow({
      tx,
      caseRow: c,
      calendar: policy.calendar,
      windowDays,
      fromDate: todayISO(),
      branchDailyCashComfortPaise: policy.dailyCashComfortPaise,
    });
    if (!out) throw new WorkflowError('Nothing left to re-plan — this case is fully paid.', 'NOTHING_DUE');

    await logEvent(tx, caseId, 'RESCHEDULED', actor.id, {
      note: `Window set to ${windowDays} working days. ${out.result.installments.length} instalments to ${out.result.lastPayoutDate}. ${reason}`,
    });
    await writeAudit(tx, actor, {
      action: 'schedule.rescheduled',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: c.branchId,
      summary:
        `${c.caseNumber} re-planned over ${windowDays} working days — ` +
        `${formatPaise(out.result.totalPaise)} to ${out.result.lastPayoutDate}. ${reason}`,
      after: {
        windowDays,
        lastPayoutOn: out.result.lastPayoutDate,
        instalments: out.result.installments.length,
      },
      ...meta,
    });
    return {
      ok: true as const,
      slaBreachUnavoidable: out.result.slaBreachUnavoidable,
      lastPayoutOn: out.result.lastPayoutDate,
      instalments: out.result.installments.length,
      windowDays,
    };
  });
}

export const AUDIT_FOR_STATUS: Partial<Record<CaseStatus, AuditAction>> = {
  SUBMITTED: 'case.submitted',
  APPROVED: 'case.approved',
  REJECTED: 'case.rejected',
  RETURNED: 'case.returned',
  ON_HOLD: 'case.held',
  CANCELLED: 'case.cancelled',
  COMPLETED: 'case.completed',
};

export { and, eq };
