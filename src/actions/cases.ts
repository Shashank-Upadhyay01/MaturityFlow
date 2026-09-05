'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { customers, maturityCases } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { parseRupeesToPaise } from '@/lib/money';
import { MIN_WINDOW_DAYS, windowDaysForPayoutCount } from '@/lib/payout-policy';
import { assertCan } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { persistInstalmentEdit, persistInstalmentLegs } from '@/services/schedule-service';
import { setInstalmentDueOn } from '@/services/admin-dates';
import {
  cancelCase,
  createCase,
  rejectCase,
  replanWithWindow,
  rescheduleCase,
  returnCase,
  setHold,
  submitCase,
} from '@/services/case-service';
import {
  loadCaseRefs,
  runBulk,
  MAX_BULK_ROWS,
  type BulkOutcome,
} from '@/services/register-bulk';
import { fail, ok, toActionError, type ActionResult } from './_result';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO, 'Use a valid date');
const money = z.string().min(1, 'Enter an amount');

export async function saveRegisterRowAction(
  caseId: string,
  patch: { windowDays?: number; todayRupees?: string },
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Row not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.override', c);

    const set: {
      windowDays?: number;
      todayApprovedPaise?: bigint;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (patch.windowDays != null) {
      if (
        !Number.isInteger(patch.windowDays) ||
        patch.windowDays < MIN_WINDOW_DAYS ||
        patch.windowDays > 60
      ) {
        return fail(`Days must be between ${MIN_WINDOW_DAYS} and 60`, 'VALIDATION');
      }
      set.windowDays = patch.windowDays;
    }
    if (patch.todayRupees != null) {
      try {
        set.todayApprovedPaise = parseRupeesToPaise(patch.todayRupees.trim() || '0');
      } catch {
        return fail('Enter a valid today amount', 'VALIDATION');
      }
    }

    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
      if (!row) throw new Error('Row not found');
      const remaining = row.maturityAmountPaise - row.paidCashPaise - row.paidOnlinePaise;
      if (set.todayApprovedPaise != null && set.todayApprovedPaise > remaining) {
        throw new Error('Today’s amount cannot be more than remaining.');
      }
      await tx.update(maturityCases).set(set).where(eq(maturityCases.id, caseId));
      await writeAudit(tx, session, {
        action: 'case.updated',
        entity: 'MaturityCase',
        entityId: caseId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: register row updated`,
        after: set,
        ...(await requestMeta()),
      });
    });

    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

function revalidateCase(id?: string) {
  revalidatePath('/dashboard');
  revalidatePath('/maturities');
  revalidatePath('/maturity-operations');
  revalidatePath('/payouts');
  revalidatePath('/cash-planner');
  if (id) revalidatePath(`/maturities/${id}`);
}

// ── Create ────────────────────────────────────────────────────────────────

const createSchema = z.object({
  branchId: z.string().min(1, 'Choose a branch'),
  agentId: z.string().min(1, 'Choose an agent'),
  customerId: z.string().min(1, 'Choose a customer'),
  maturityAmount: money,
  formSubmittedOn: isoDate,
  schemeName: z.string().optional().nullable(),
  policyNumber: z.string().optional().nullable(),
  instrumentMaturityOn: z.union([isoDate, z.literal('')]).optional(),
  windowDays: z.coerce
    .number()
    .int()
    .min(MIN_WINDOW_DAYS, `At least ${MIN_WINDOW_DAYS} days — the first 3 are processing`)
    .max(366),
  roundingPaise: z.string().min(1),
  distribution: z.enum(['FRONT_LOADED', 'BACK_LOADED', 'EVEN']),
  cashPolicy: z.enum(['CASH_ONLY', 'ONLINE_ONLY', 'CASH_CAP']),
  cashCapPerDay: z.string().optional().nullable(),
  startOnNextWorkingDay: z.union([z.literal('on'), z.literal('')]).optional(),
  notes: z.string().optional().nullable(),
  submitNow: z.union([z.literal('on'), z.literal('')]).optional(),
});

export async function createCaseAction(
  _prev: ActionResult<{ id: string; caseNumber: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; caseNumber: string }>> {
  try {
    const { session, actor } = await requireActor();
    const raw = Object.fromEntries(formData) as Record<string, string>;
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;

    if (d.submitNow === 'on' && !d.instrumentMaturityOn) {
      return fail('Add the maturity date before scheduling payouts', 'VALIDATION', {
        instrumentMaturityOn: 'Required when submitting and scheduling',
      });
    }

    assertCan(actor, 'case.create', { branchId: d.branchId, agentId: d.agentId });

    let amountPaise: bigint;
    try {
      amountPaise = parseRupeesToPaise(d.maturityAmount);
    } catch {
      return fail('Enter a valid maturity amount', 'VALIDATION', {
        maturityAmount: 'Digits only, up to 2 decimal places',
      });
    }
    if (amountPaise <= 0n) {
      return fail('The maturity amount must be more than zero', 'VALIDATION', {
        maturityAmount: 'Must be greater than zero',
      });
    }

    let cashCap: bigint | null = null;
    if (d.cashPolicy === 'CASH_CAP') {
      try {
        cashCap = parseRupeesToPaise(d.cashCapPerDay ?? '0');
      } catch {
        return fail('Enter a valid daily cash limit', 'VALIDATION', {
          cashCapPerDay: 'Digits only',
        });
      }
    }

    const res = await createCase(
      session,
      {
        branchId: d.branchId,
        agentId: d.agentId,
        customerId: d.customerId,
        maturityAmountPaise: amountPaise,
        formSubmittedOn: d.formSubmittedOn,
        schemeName: d.schemeName || null,
        policyNumber: d.policyNumber || null,
        instrumentMaturityOn: d.instrumentMaturityOn || null,
        windowDays: d.windowDays,
        roundingPaise: BigInt(d.roundingPaise),
        distribution: d.distribution,
        cashPolicy: d.cashPolicy,
        cashCapPerDayPaise: cashCap,
        startOnNextWorkingDay: d.startOnNextWorkingDay === 'on',
        notes: d.notes || null,
        submitNow: d.submitNow === 'on',
      },
      await requestMeta(),
    );

    revalidateCase(res.id);
    return ok(res);
  } catch (e) {
    return toActionError(e);
  }
}

// ── Quick customer creation from inside the intake form ───────────────────

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the customer name'),
  phone: z.string().trim().optional().nullable(),
  accountNumber: z.string().trim().optional().nullable(),
  branchId: z.string().min(1),
  agentId: z.string().min(1),
  payoutBank: z.string().optional().nullable(),
  payoutAccount: z.string().optional().nullable(),
  payoutIfsc: z.string().optional().nullable(),
});

export async function createCustomerAction(
  _prev: ActionResult<{ id: string; name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const { session, actor } = await requireActor();
    const parsed = customerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;
    assertCan(actor, 'customer.manage', { branchId: d.branchId, agentId: d.agentId });

    const id = newId('cus');
    await db.transaction(async (tx) => {
      await tx.insert(customers).values({
        id,
        name: d.name,
        phone: d.phone || null,
        accountNumber: d.accountNumber || null,
        branchId: d.branchId,
        agentId: d.agentId,
        payoutBank: d.payoutBank || null,
        payoutAccount: d.payoutAccount || null,
        payoutIfsc: d.payoutIfsc || null,
      });
      await writeAudit(tx, session, {
        action: 'customer.created',
        entity: 'Customer',
        entityId: id,
        branchId: d.branchId,
        summary: `Customer added: ${d.name}`,
        ...(await requestMeta()),
      });
    });

    revalidatePath('/maturities/new');
    return ok({ id, name: d.name });
  } catch (e) {
    return toActionError(e);
  }
}

// ── Workflow transitions ──────────────────────────────────────────────────

async function loadCaseScope(caseId: string) {
  const [c] = await db
    .select({ branchId: maturityCases.branchId, agentId: maturityCases.agentId, status: maturityCases.status })
    .from(maturityCases)
    .where(eq(maturityCases.id, caseId))
    .limit(1);
  return c;
}

export async function submitCaseAction(caseId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.submit', c);
    await submitCase(session, caseId, await requestMeta());
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function rejectCaseAction(caseId: string, reason: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!reason?.trim()) return fail('A reason is required to reject a case.', 'VALIDATION');
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.reject', c);
    await rejectCase(session, caseId, reason.trim(), await requestMeta());
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function returnCaseAction(caseId: string, reason: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!reason?.trim()) return fail('Say what needs correcting.', 'VALIDATION');
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.return', c);
    await returnCase(session, caseId, reason.trim(), await requestMeta());
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setHoldAction(
  caseId: string,
  hold: boolean,
  reason: string | null,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (hold && !reason?.trim()) return fail('A reason is required to hold a case.', 'VALIDATION');
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.hold', c);
    await setHold(session, caseId, hold, reason?.trim() ?? null, await requestMeta());
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function cancelCaseAction(caseId: string, reason: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    if (!reason?.trim()) return fail('A reason is required to cancel a case.', 'VALIDATION');
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.cancel', c);
    await cancelCase(session, caseId, reason.trim(), await requestMeta());
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function rescheduleCaseAction(
  caseId: string,
  reason: string,
): Promise<ActionResult<{ slaBreachUnavoidable: boolean; lastPayoutOn: string; instalments: number }>> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.reschedule', c);
    const res = await rescheduleCase(session, caseId, reason?.trim() || 'Re-planned', await requestMeta());
    revalidateCase(caseId);
    return ok({
      slaBreachUnavoidable: res.slaBreachUnavoidable,
      lastPayoutOn: res.lastPayoutOn,
      instalments: res.instalments,
    });
  } catch (e) {
    return toActionError(e);
  }
}

export async function replanWithWindowAction(
  caseId: string,
  windowDays: number,
  reason: string,
): Promise<ActionResult<{ slaBreachUnavoidable: boolean; lastPayoutOn: string; instalments: number; windowDays: number }>> {
  try {
    const { session, actor } = await requireActor();
    if (!Number.isInteger(windowDays) || windowDays < MIN_WINDOW_DAYS || windowDays > 60) {
      return fail(`Enter between ${MIN_WINDOW_DAYS} and 60 working days`, 'VALIDATION');
    }
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.reschedule', c);
    const res = await replanWithWindow(
      session,
      caseId,
      windowDays,
      reason?.trim() || `Window set to ${windowDays} working days`,
      await requestMeta(),
    );
    revalidateCase(caseId);
    return ok({
      slaBreachUnavoidable: res.slaBreachUnavoidable,
      lastPayoutOn: res.lastPayoutOn,
      instalments: res.instalments,
      windowDays: res.windowDays,
    });
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Commit the planning board's what-if to every case shown on it.
 *
 * The Plan tab has always been able to answer "what if this were split into 8 parts instead of
 * 12", for one case or for a whole band at once, and then had no way to say yes. The counts lived
 * in React state, the branch read them off the screen, and somebody re-typed each one on the case
 * page. This is that yes.
 *
 * Two things it deliberately does not do. It does not accept a window length from the browser:
 * the client sends a count of parts, and the window each case needs is derived here from that
 * case's own maturity amount, because the amount decides the cadence and the cadence decides how
 * many working days N parts occupy. And it takes no shortcut past `replanWithWindow` - every case
 * goes through the same locked, audited, single-case path the case page uses, one at a time. A
 * batch of forty is forty of those, not one clever UPDATE.
 *
 * Cases that cannot take the change - already paid off, cancelled, outside the actor's branch -
 * fail on their own and come back named. The rest still land.
 */
export async function applyPlanAction(
  plans: { caseId: string; parts: number }[],
  reason: string,
): Promise<ActionResult<BulkOutcome>> {
  try {
    const { session, actor } = await requireActor();

    const wanted = new Map<string, number>();
    for (const p of plans ?? []) {
      if (!p || typeof p.caseId !== 'string' || p.caseId.length === 0) continue;
      if (!Number.isInteger(p.parts) || p.parts < 1) {
        return fail('Number of parts must be a whole number of at least 1.', 'VALIDATION');
      }
      wanted.set(p.caseId, p.parts);
    }
    if (wanted.size === 0) return fail('Nothing to apply - no cases in the plan.', 'VALIDATION');
    if (wanted.size > MAX_BULK_ROWS) {
      return fail(`You can re-plan at most ${MAX_BULK_ROWS} cases at a time.`, 'VALIDATION');
    }

    const ids = [...wanted.keys()];
    const refs = await loadCaseRefs(ids);

    // The amount decides the cadence, and the cadence decides how long N parts take. Read it
    // here rather than trusting the figure the board happened to be showing.
    const amounts = new Map(
      (
        await db
          .select({ id: maturityCases.id, amount: maturityCases.maturityAmountPaise })
          .from(maturityCases)
          .where(inArray(maturityCases.id, ids))
      ).map((r) => [r.id, r.amount]),
    );

    const why = reason?.trim() || 'Re-planned from the planning board';
    const meta = await requestMeta();

    const outcome = await runBulk(ids, refs, async (id, ref) => {
      assertCan(actor, 'schedule.reschedule', ref);
      const parts = wanted.get(id);
      if (parts == null) throw new Error('No part count for this row');
      const amount = amounts.get(id);
      if (amount == null) throw new Error('Row no longer exists');
      const windowDays = windowDaysForPayoutCount(BigInt(amount), parts);
      if (windowDays > 60) {
        throw new Error(
          `${parts} parts would need a ${windowDays}-working-day window; 60 is the most allowed.`,
        );
      }
      await replanWithWindow(session, id, windowDays, `${why} (${parts} parts)`, meta);
    });

    revalidateCase();
    return ok(outcome);
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Set one day's amount; the server spreads the difference over the later unpaid days.
 *
 * The client sends parameters — which day, what it should be — and the server derives the rest
 * from rows it re-read under lock. It never accepts a set of amounts computed in a browser: that
 * was the previous shape of this action, and it put the client's arithmetic into the database.
 */
export async function setInstalmentAmountAction(
  caseId: string,
  instalmentId: string,
  amountRupees: string,
): Promise<ActionResult<{ changed: number }>> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.override', c);

    let newAmountPaise: bigint;
    try {
      newAmountPaise = parseRupeesToPaise(amountRupees);
    } catch {
      return fail('Enter a valid rupee amount', 'VALIDATION');
    }

    const out = await db.transaction(async (tx) => {
      // The CASE row first, then the instalments inside persistInstalmentEdit with
      // .for('update'). Lock order is always case -> instalment.
      const [row] = await tx
        .select()
        .from(maturityCases)
        .where(eq(maturityCases.id, caseId))
        .for('update')
        .limit(1);
      if (!row) throw new Error('Case not found');

      const res = await persistInstalmentEdit({
        tx,
        caseRow: row,
        instalmentId,
        newAmountPaise,
      });

      await writeAudit(tx, session, {
        action: 'schedule.adjusted',
        entity: 'MaturityCase',
        entityId: caseId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: one day set to ${amountRupees}, ${res.changed} day(s) re-balanced`,
        ...(await requestMeta()),
      });
      return res;
    });

    revalidateCase(caseId);
    return ok({ changed: out.changed });
  } catch (e) {
    return toActionError(e);
  }
}

/** Set the cash/online split on one scheduled day. Paid or not. */
export async function setInstalmentLegsAction(
  caseId: string,
  instalmentId: string,
  cashRupees: string,
  onlineRupees: string,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.override', c);
    let cashPaise: bigint;
    let onlinePaise: bigint;
    try {
      cashPaise = parseRupeesToPaise(cashRupees || '0');
      onlinePaise = parseRupeesToPaise(onlineRupees || '0');
    } catch {
      return fail('Enter valid rupee amounts', 'VALIDATION');
    }
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(maturityCases)
        .where(eq(maturityCases.id, caseId))
        .for('update')
        .limit(1);
      if (!row) throw new Error('Case not found');
      await persistInstalmentLegs({ tx, caseRow: row, instalmentId, cashPaise, onlinePaise });
      await writeAudit(tx, session, {
        action: 'schedule.adjusted',
        entity: 'MaturityCase',
        entityId: caseId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: cash/online split set to ${cashRupees} / ${onlineRupees}`,
        ...(await requestMeta()),
      });
    });
    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

/** Admin-only: move a schedule day, including one that has already been paid. */
export async function setInstalmentDueOnAction(
  instalmentId: string,
  dueOn: string,
): Promise<ActionResult> {
  try {
    const { session } = await requireActor();
    const out = await setInstalmentDueOn(session, instalmentId, dueOn);
    revalidateCase(out.caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
