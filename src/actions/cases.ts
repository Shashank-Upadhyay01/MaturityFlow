'use server';

import { and, eq, ne } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { customers, maturityCases, payoutInstalments } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { parseRupeesToPaise } from '@/lib/money';
import { MIN_WINDOW_DAYS } from '@/lib/payout-policy';
import { assertCan } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import {
  approveCase,
  cancelCase,
  createCase,
  rejectCase,
  replanWithWindow,
  rescheduleCase,
  returnCase,
  setHold,
  submitCase,
} from '@/services/case-service';
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
        return fail('Days must be between 1 and 60', 'VALIDATION');
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
  revalidatePath('/approvals');
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

const approveSchema = z.object({
  caseId: z.string().min(1),
  approvedOn: isoDate,
  windowDays: z.coerce.number().int().min(MIN_WINDOW_DAYS).max(366),
  roundingPaise: z.string().min(1),
  distribution: z.enum(['FRONT_LOADED', 'BACK_LOADED', 'EVEN']),
  cashPolicy: z.enum(['CASH_ONLY', 'ONLINE_ONLY', 'CASH_CAP']),
  cashCapPerDay: z.string().optional().nullable(),
  startOnNextWorkingDay: z.union([z.literal('on'), z.literal('')]).optional(),
  note: z.string().optional().nullable(),
});

export async function approveCaseAction(
  _prev: ActionResult<{ caseNumber: string; instalments: number; lastPayoutOn: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ caseNumber: string; instalments: number; lastPayoutOn: string }>> {
  try {
    const { session, actor } = await requireActor();
    const parsed = approveSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;

    const c = await loadCaseScope(d.caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'case.approve', c);

    let cashCap: bigint | null = null;
    if (d.cashPolicy === 'CASH_CAP') {
      try {
        cashCap = parseRupeesToPaise(d.cashCapPerDay ?? '0');
      } catch {
        return fail('Enter a valid daily cash limit', 'VALIDATION', { cashCapPerDay: 'Digits only' });
      }
    }

    const res = await approveCase(
      session,
      {
        caseId: d.caseId,
        approvedOn: d.approvedOn,
        windowDays: d.windowDays,
        roundingPaise: BigInt(d.roundingPaise),
        distribution: d.distribution,
        cashPolicy: d.cashPolicy,
        cashCapPerDayPaise: cashCap,
        startOnNextWorkingDay: d.startOnNextWorkingDay === 'on',
        note: d.note || null,
      },
      await requestMeta(),
    );

    revalidateCase(d.caseId);
    return ok({
      caseNumber: res.caseNumber,
      instalments: res.instalments,
      lastPayoutOn: res.lastPayoutOn,
    });
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
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 60) {
      return fail('Enter between 1 and 60 working days', 'VALIDATION');
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

/** Move rupees between unpaid days. The remaining total cannot change. */
export async function adjustUnpaidInstalmentsAction(
  caseId: string,
  changes: { id: string; amountRupees: string }[],
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const c = await loadCaseScope(caseId);
    if (!c) return fail('Case not found', 'NOT_FOUND');
    assertCan(actor, 'schedule.override', c);

    const parsed: { id: string; amount: bigint }[] = [];
    for (const ch of changes) {
      try {
        parsed.push({ id: ch.id, amount: parseRupeesToPaise(ch.amountRupees) });
      } catch {
        return fail('Every adjusted amount must be a valid rupee figure', 'VALIDATION');
      }
    }

    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
      if (!row) throw new Error('Case not found');
      const insts = await tx
        .select()
        .from(payoutInstalments)
        .where(and(eq(payoutInstalments.caseId, caseId), ne(payoutInstalments.status, 'SUPERSEDED')));

      const byId = new Map(insts.map((i) => [i.id, i]));
      let unpaidWas = 0n;
      let unpaidNow = 0n;
      for (const i of insts) {
        const outstanding = i.amountPaise - i.paidCashPaise - i.paidOnlinePaise;
        if (outstanding <= 0n) continue;
        unpaidWas += outstanding;
        const next = parsed.find((p) => p.id === i.id);
        const newAmt = next ? next.amount : i.amountPaise;
        if (newAmt < i.paidCashPaise + i.paidOnlinePaise) {
          throw new Error('Cannot set a day below what has already been paid.');
        }
        unpaidNow += newAmt - i.paidCashPaise - i.paidOnlinePaise;
      }
      if (unpaidNow !== unpaidWas) {
        throw new Error(
          `Unpaid days must still add up to the remaining amount. Difference: ${(unpaidNow - unpaidWas).toString()} paise.`,
        );
      }

      for (const ch of parsed) {
        const i = byId.get(ch.id);
        if (!i) continue;
        if (i.status === 'PAID') continue;
        const paid = i.paidCashPaise + i.paidOnlinePaise;
        const cash = i.cashLegPaise;
        const online = ch.amount > cash ? ch.amount - cash : 0n;
        const cashLeg = ch.amount - online;
        await tx
          .update(payoutInstalments)
          .set({
            amountPaise: ch.amount,
            cashLegPaise: cashLeg,
            onlineLegPaise: online,
            updatedAt: new Date(),
          })
          .where(eq(payoutInstalments.id, ch.id));
        void paid;
      }

      await writeAudit(tx, session, {
        action: 'schedule.adjusted',
        entity: 'MaturityCase',
        entityId: caseId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: unpaid daily amounts adjusted`,
        ...(await requestMeta()),
      });
    });

    revalidateCase(caseId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
