import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import {
  agents,
  branchCashPositions,
  branches,
  caseEvents,
  customers,
  maturityCases,
  payoutTransactions,
  registerDays,
} from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { formatCaseNumber, newId } from '@/lib/id';
import { DEFAULT_CASH_CAP_PAISE } from '@/lib/org-settings';
import { loadOrgSettings } from '@/services/org-settings';
import { parseRupeesToPaise } from '@/lib/money';
import { bulkTodayAmount, type BulkTodayMode } from '@/lib/register-view';
import { parseRegisterDate } from '@/lib/excel-register';
import { todayISO } from '@/lib/working-days';
import { sql } from 'drizzle-orm';
import { caseCounters } from '@/db/schema';

export function recommendSplit(todayPaise: bigint, remainingPaise: bigint, cap = DEFAULT_CASH_CAP_PAISE) {
  const need = todayPaise < remainingPaise ? todayPaise : remainingPaise;
  const cash = need < cap ? need : cap;
  return { cash, online: need - cash, total: need };
}

async function defaultCashCap(): Promise<bigint> {
  const org = await loadOrgSettings();
  return org.cashCapPaise > 0n ? org.cashCapPaise : DEFAULT_CASH_CAP_PAISE;
}

async function agentIdFor(branchId: string, name: string): Promise<string> {
  const trimmed = name.trim() || 'Unassigned';
  const existing = await db.select().from(agents).where(eq(agents.branchId, branchId));
  const hit = existing.find((a) => a.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (hit) return hit.id;
  const id = newId('agt');
  await db.insert(agents).values({
    id,
    code: `AG${String(existing.length + 1).padStart(3, '0')}`,
    name: trimmed,
    branchId,
  });
  return id;
}

/** Hard ceiling on one "add rows" click. Guards against a typo like 10000 in the count box. */
export const MAX_BLANK_ROWS_PER_CALL = 100;

/**
 * Reserve `count` consecutive case numbers in one atomic bump.
 *
 * Calling nextCaseNumber() N times would be N round-trips and would interleave with another
 * clerk adding rows at the same moment, so one person's ten rows would come back numbered
 * 0041, 0043, 0045… Bumping once by N and slicing the range keeps each batch contiguous and
 * still cannot collide, because the increment itself is a single atomic UPDATE.
 */
async function reserveCaseNumbers(tx: Tx, branchCode: string, year: number, count: number) {
  const key = `${branchCode}|${year}`;
  const [row] = await tx
    .insert(caseCounters)
    .values({ key, value: count })
    .onConflictDoUpdate({
      target: caseCounters.key,
      set: { value: sql`${caseCounters.value} + ${count}` },
    })
    .returning({ value: caseCounters.value });
  const last = row.value;
  const first = last - count + 1;
  return Array.from({ length: count }, (_, i) => formatCaseNumber(branchCode, year, first + i));
}

/**
 * Add `count` blank rows to a branch's register in a single transaction.
 *
 * All-or-nothing on purpose: a half-written batch would leave the clerk counting rows to work
 * out what actually landed. The customer stubs are created inside the same transaction as the
 * cases — creating them outside would strand an orphan customer whenever the case insert failed.
 */
export async function createBlankRegisterRows(
  actor: SessionUser,
  branchId: string,
  count: number,
): Promise<string[]> {
  const n = Math.max(1, Math.min(MAX_BLANK_ROWS_PER_CALL, Math.floor(count) || 1));
  const [branch] = await db.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) throw new Error('Branch not found');
  const today = todayISO();
  const year = Number(today.slice(0, 4));
  const agentId = await agentIdFor(branchId, 'Unassigned');
  const cashCap = await defaultCashCap();

  return db.transaction(async (tx) => {
    const numbers = await reserveCaseNumbers(tx, branch.code, year, n);
    const caseIds: string[] = [];
    const customerRows = [];
    const caseRows = [];
    const eventRows = [];

    for (let i = 0; i < n; i += 1) {
      const customerId = newId('cus');
      const caseId = newId('case');
      caseIds.push(caseId);
      customerRows.push({ id: customerId, name: 'New customer', branchId, agentId });
      caseRows.push({
        id: caseId,
        caseNumber: numbers[i],
        branchId,
        agentId,
        customerId,
        maturityAmountPaise: parseRupeesToPaise('1'),
        formSubmittedOn: today,
        status: 'DRAFT' as const,
        windowDays: branch.defaultWindowDays,
        roundingPaise: branch.defaultRoundingPaise,
        cashPolicy: 'CASH_CAP' as const,
        cashCapPerDayPaise: cashCap,
        createdById: actor.id,
      });
      eventRows.push({
        id: newId('evt'),
        caseId,
        type: 'CREATED' as const,
        toStatus: 'DRAFT' as const,
        actorId: actor.id,
      });
    }

    await tx.insert(customers).values(customerRows);
    await tx.insert(maturityCases).values(caseRows);
    await tx.insert(caseEvents).values(eventRows);

    // One audit line for the batch, not n of them — the register is the detail.
    await writeAudit(tx, actor, {
      action: 'case.created',
      entity: 'MaturityCase',
      entityId: caseIds[0],
      branchId,
      summary:
        n === 1
          ? `${numbers[0]}: blank register row`
          : `${n} blank register rows (${numbers[0]} – ${numbers[n - 1]})`,
    });

    return caseIds;
  });
}

export async function createBlankRegisterRow(actor: SessionUser, branchId: string) {
  const [id] = await createBlankRegisterRows(actor, branchId, 1);
  return id;
}

export async function updateRegisterRow(
  actor: SessionUser,
  caseId: string,
  patch: {
    accountNumber?: string;
    customerName?: string;
    agentName?: string;
    instrumentMaturityOn?: string | null;
    formSubmittedOn?: string;
    paymentOn?: string | null;
    maturityRupees?: string;
    paidRupees?: string;
    windowDays?: number;
    todayRupees?: string;
    todayCashRupees?: string;
    todayOnlineRupees?: string;
  },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
    if (!row) throw new Error('Row not found');

    const [customer] = await tx.select().from(customers).where(eq(customers.id, row.customerId)).limit(1);
    const setCase: Record<string, unknown> = { updatedAt: new Date() };

    if (patch.customerName != null || patch.accountNumber != null) {
      await tx
        .update(customers)
        .set({
          ...(patch.customerName != null ? { name: patch.customerName.trim() || customer.name } : {}),
          ...(patch.accountNumber != null ? { accountNumber: patch.accountNumber.trim() || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(customers.id, row.customerId));
    }
    if (patch.agentName != null) {
      const agentId = await agentIdFor(row.branchId, patch.agentName);
      setCase.agentId = agentId;
      await tx.update(customers).set({ agentId, updatedAt: new Date() }).where(eq(customers.id, row.customerId));
    }

    const parseDate = (s: string | null | undefined) => {
      if (s == null || s === '') return null;
      const iso = parseRegisterDate(s);
      if (!iso) throw new Error(`Invalid date: ${s}`);
      return iso;
    };

    if (patch.instrumentMaturityOn !== undefined) {
      setCase.instrumentMaturityOn = parseDate(patch.instrumentMaturityOn);
    }
    if (patch.formSubmittedOn != null) {
      const d = parseDate(patch.formSubmittedOn);
      if (!d) throw new Error('Form submission date is required');
      setCase.formSubmittedOn = d;
    }
    if (patch.paymentOn !== undefined) {
      setCase.paymentOn = parseDate(patch.paymentOn);
    }
    if (patch.windowDays != null) {
      if (!Number.isInteger(patch.windowDays) || patch.windowDays < 1 || patch.windowDays > 60) {
        throw new Error('Days must be 1–60');
      }
      setCase.windowDays = patch.windowDays;
    }

    let amount = row.maturityAmountPaise;
    if (patch.maturityRupees != null) {
      amount = parseRupeesToPaise(patch.maturityRupees.trim() || '0');
      if (amount <= 0n) throw new Error('Maturity amount must be greater than zero');
      setCase.maturityAmountPaise = amount;
    }

    const remainingNow = () =>
      amount - ((setCase.paidCashPaise as bigint | undefined) ?? row.paidCashPaise) - row.paidOnlinePaise;

    if (patch.paidRupees != null) {
      const paid = parseRupeesToPaise(patch.paidRupees.trim() || '0');
      if (paid < 0n) throw new Error('Paid cannot be negative');
      if (paid > amount) throw new Error('Paid cannot exceed maturity amount');
      setCase.paidCashPaise = paid;
      setCase.paidOnlinePaise = 0n;
      setCase.status = paid >= amount ? 'COMPLETED' : row.status === 'COMPLETED' ? 'IN_PROGRESS' : row.status;
      setCase.completedAt = paid >= amount ? new Date() : null;
    }

    const remaining = amount - ((setCase.paidCashPaise as bigint | undefined) ?? row.paidCashPaise) - ((setCase.paidOnlinePaise as bigint | undefined) ?? row.paidOnlinePaise);

    if (patch.todayRupees != null) {
      let todayAmt = parseRupeesToPaise(patch.todayRupees.trim() || '0');
      if (todayAmt > remaining) todayAmt = remaining;
      const split = recommendSplit(todayAmt, remaining, row.cashCapPerDayPaise ?? (await defaultCashCap()));
      setCase.todayApprovedPaise = split.total;
      setCase.todayCashPaise = split.cash;
      setCase.todayOnlinePaise = split.online;
    }
    if (patch.todayCashRupees != null || patch.todayOnlineRupees != null) {
      const cash = patch.todayCashRupees != null ? parseRupeesToPaise(patch.todayCashRupees.trim() || '0') : row.todayCashPaise;
      const online = patch.todayOnlineRupees != null ? parseRupeesToPaise(patch.todayOnlineRupees.trim() || '0') : row.todayOnlinePaise;
      const total = cash + online;
      if (total > remainingNow()) throw new Error('Today cash + online cannot exceed remaining');
      setCase.todayCashPaise = cash;
      setCase.todayOnlinePaise = online;
      setCase.todayApprovedPaise = total;
    }

    await tx.update(maturityCases).set(setCase).where(eq(maturityCases.id, caseId));
    await writeAudit(tx, actor, {
      action: 'case.updated',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: row.branchId,
      summary: `${row.caseNumber}: register fields updated`,
    });
  });
}

/**
 * Set today's approved amount on one row, derived rather than typed.
 *
 * This is what a bulk "set today's amount" does to each ticked row. It exists separately from
 * `updateRegisterRow` because the input is a *rule* ("recommended per day", "the full remaining")
 * and not a number: the number has to come from the row's own state, read under the row lock, at
 * the moment of the write. Computing it in the browser from the last page render and sending the
 * result would approve yesterday's figure for a case somebody has been paid against since.
 *
 * The rule itself is `bulkTodayAmount()` in register-view.ts — pure, unit-tested, and the same
 * function the toolbar uses to show the clerk the total before they commit to it.
 */
export async function setTodayAmount(
  actor: SessionUser,
  caseId: string,
  mode: BulkTodayMode,
  amountPaise?: bigint,
) {
  const cap = await defaultCashCap();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(maturityCases)
      .where(eq(maturityCases.id, caseId))
      .for('update')
      .limit(1);
    if (!row) throw new Error('Row not found');
    const remaining = row.maturityAmountPaise - row.paidCashPaise - row.paidOnlinePaise;
    if (remaining <= 0n && mode !== 'clear') {
      throw new Error('Nothing left to pay on this row');
    }
    const total = bulkTodayAmount(mode, {
      remaining,
      windowDays: row.windowDays,
      amount: amountPaise,
    });
    const split = recommendSplit(total, remaining, row.cashCapPerDayPaise ?? cap);
    await tx
      .update(maturityCases)
      .set({
        todayApprovedPaise: split.total,
        todayCashPaise: split.cash,
        todayOnlinePaise: split.online,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, caseId));
    await writeAudit(tx, actor, {
      action: 'case.updated',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: row.branchId,
      summary: `${row.caseNumber}: today set to ${split.total.toString()} paise (${mode})`,
    });
    return split.total;
  });
}

export async function setFormSubmitted(actor: SessionUser, caseId: string, submitted: boolean) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
    if (!row) throw new Error('Row not found');
    if (submitted) {
      if (row.status === 'DRAFT' || row.status === 'RETURNED') {
        await tx
          .update(maturityCases)
          .set({
            status: 'SUBMITTED',
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(maturityCases.id, caseId));
        await tx.insert(caseEvents).values({
          id: newId('evt'),
          caseId,
          type: 'SUBMITTED',
          fromStatus: row.status,
          toStatus: 'SUBMITTED',
          actorId: actor.id,
        });
      }
    } else {
      await tx
        .update(maturityCases)
        .set({ status: 'DRAFT', submittedAt: null, updatedAt: new Date() })
        .where(eq(maturityCases.id, caseId));
    }
    await writeAudit(tx, actor, {
      action: submitted ? 'case.submitted' : 'case.updated',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: row.branchId,
      summary: `${row.caseNumber}: form ${submitted ? 'submitted' : 'unsubmitted'}`,
    });
  });
}

export async function setApproved(actor: SessionUser, caseId: string, approved: boolean) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
    if (!row) throw new Error('Row not found');
    const today = todayISO();
    if (approved) {
      const paid = row.paidCashPaise + row.paidOnlinePaise;
      const remaining = row.maturityAmountPaise - paid;
      await tx
        .update(maturityCases)
        .set({
          status: remaining <= 0n ? 'COMPLETED' : paid > 0n ? 'IN_PROGRESS' : 'APPROVED',
          approvedOn: row.approvedOn ?? today,
          approvedAt: new Date(),
          approvedById: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(maturityCases.id, caseId));
      await tx.insert(caseEvents).values({
        id: newId('evt'),
        caseId,
        type: 'APPROVED',
        fromStatus: row.status,
        toStatus: remaining <= 0n ? 'COMPLETED' : 'APPROVED',
        actorId: actor.id,
      });
    } else {
      await tx
        .update(maturityCases)
        .set({
          status: 'SUBMITTED',
          approvedOn: null,
          approvedAt: null,
          approvedById: null,
          updatedAt: new Date(),
        })
        .where(eq(maturityCases.id, caseId));
    }
    await writeAudit(tx, actor, {
      action: approved ? 'case.approved' : 'case.updated',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: row.branchId,
      summary: `${row.caseNumber}: ${approved ? 'approved' : 'approval cleared'}`,
    });
  });
}

export async function markGiven(
  actor: SessionUser,
  caseId: string,
  mode: 'CASH' | 'ONLINE' | 'SPLIT',
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
    if (!row) throw new Error('Row not found');
    const remaining = row.maturityAmountPaise - row.paidCashPaise - row.paidOnlinePaise;
    if (remaining <= 0n) throw new Error('Nothing left to pay');
    let cash = 0n;
    let online = 0n;
    if (mode === 'CASH') cash = row.todayCashPaise > 0n ? row.todayCashPaise : row.todayApprovedPaise;
    else if (mode === 'ONLINE') online = row.todayOnlinePaise > 0n ? row.todayOnlinePaise : row.todayApprovedPaise;
    else {
      cash = row.todayCashPaise;
      online = row.todayOnlinePaise;
      if (cash + online === 0n) {
        const s = recommendSplit(row.todayApprovedPaise, remaining, row.cashCapPerDayPaise ?? (await defaultCashCap()));
        cash = s.cash;
        online = s.online;
      }
    }
    if (cash + online === 0n) throw new Error('Set today’s amount first');
    if (cash + online > remaining) {
      const s = recommendSplit(remaining, remaining, row.cashCapPerDayPaise ?? (await defaultCashCap()));
      cash = mode === 'ONLINE' ? 0n : s.cash;
      online = mode === 'CASH' ? 0n : remaining - cash;
      if (mode === 'ONLINE') online = remaining;
    }
    const today = todayISO();
    await tx.insert(payoutTransactions).values({
      id: newId('txn'),
      caseId,
      instalmentId: null,
      branchId: row.branchId,
      cashPaise: cash,
      onlinePaise: online,
      totalPaise: cash + online,
      valueDate: today,
      remarks: `Register: given as ${mode.toLowerCase()}`,
      recordedById: actor.id,
      reference: online > 0n ? 'ONLINE' : null,
    });
    const paidCash = row.paidCashPaise + cash;
    const paidOnline = row.paidOnlinePaise + online;
    const left = row.maturityAmountPaise - paidCash - paidOnline;
    await tx
      .update(maturityCases)
      .set({
        paidCashPaise: paidCash,
        paidOnlinePaise: paidOnline,
        todayApprovedPaise: 0n,
        todayCashPaise: 0n,
        todayOnlinePaise: 0n,
        status: left <= 0n ? 'COMPLETED' : 'IN_PROGRESS',
        completedAt: left <= 0n ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(maturityCases.id, caseId));
    await tx.insert(caseEvents).values({
      id: newId('evt'),
      caseId,
      type: 'PAYMENT_RECORDED',
      actorId: actor.id,
      note: `Given ${mode}`,
    });
    await writeAudit(tx, actor, {
      action: 'payout.recorded',
      entity: 'MaturityCase',
      entityId: caseId,
      branchId: row.branchId,
      summary: `${row.caseNumber}: given ${mode}`,
    });
    return { remaining: left };
  });
}

export async function setDayCash(
  actor: SessionUser,
  branchId: string,
  date: string,
  cashInHandRupees: string,
  onlinePlannedRupees: string,
) {
  const cash = parseRupeesToPaise(cashInHandRupees.trim() || '0');
  const online = parseRupeesToPaise(onlinePlannedRupees.trim() || '0');
  await db.transaction(async (tx) => {
    await tx
      .insert(branchCashPositions)
      .values({
        id: newId('cp'),
        branchId,
        date,
        openingCashPaise: cash,
        plannedOnlinePaise: online,
        notedById: actor.id,
      })
      .onConflictDoUpdate({
        target: [branchCashPositions.branchId, branchCashPositions.date],
        set: {
          openingCashPaise: cash,
          plannedOnlinePaise: online,
          notedById: actor.id,
          updatedAt: new Date(),
        },
      });
    await writeAudit(tx, actor, {
      action: 'cash.opening_set',
      entity: 'BranchCashPosition',
      entityId: `${branchId}|${date}`,
      branchId,
      summary: `Cash in hand ${cash.toString()} paise, online planned ${online.toString()} paise`,
    });
  });
}

export async function requestCloseDay(actor: SessionUser, branchId: string, date: string) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(registerDays)
      .where(and(eq(registerDays.branchId, branchId), eq(registerDays.date, date)))
      .limit(1);
    if (existing?.status === 'CLOSED') throw new Error('This day is already closed');
    if (existing) {
      await tx
        .update(registerDays)
        .set({ status: 'CLOSE_REQUESTED', requestedById: actor.id, requestedAt: new Date() })
        .where(eq(registerDays.id, existing.id));
    } else {
      await tx.insert(registerDays).values({
        id: newId('rday'),
        branchId,
        date,
        status: 'CLOSE_REQUESTED',
        requestedById: actor.id,
        requestedAt: new Date(),
      });
    }
    await writeAudit(tx, actor, {
      action: 'register.day_close_requested',
      entity: 'RegisterDay',
      entityId: `${branchId}|${date}`,
      branchId,
      summary: `Close requested for ${date}`,
    });
  });
}

export async function confirmCloseDay(actor: SessionUser, branchId: string, date: string, approve: boolean) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(registerDays)
      .where(and(eq(registerDays.branchId, branchId), eq(registerDays.date, date)))
      .for('update')
      .limit(1);
    if (!existing) throw new Error('No close request for this day');
    if (approve) {
      if (existing.status === 'CLOSED') throw new Error('Already closed');
      await tx
        .update(registerDays)
        .set({
          status: 'CLOSED',
          approvedById: actor.id,
          approvedAt: new Date(),
        })
        .where(eq(registerDays.id, existing.id));
      await tx
        .update(maturityCases)
        .set({
          todayApprovedPaise: 0n,
          todayCashPaise: 0n,
          todayOnlinePaise: 0n,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(maturityCases.branchId, branchId),
            sql`${maturityCases.status} IN ('APPROVED','IN_PROGRESS','SUBMITTED','DRAFT')`,
          ),
        );
      await writeAudit(tx, actor, {
        action: 'register.day_closed',
        entity: 'RegisterDay',
        entityId: `${branchId}|${date}`,
        branchId,
        summary: `Day ${date} closed`,
      });
    } else {
      await tx
        .update(registerDays)
        .set({ status: 'OPEN', requestedById: null, requestedAt: null })
        .where(eq(registerDays.id, existing.id));
      await writeAudit(tx, actor, {
        action: 'register.day_reopened',
        entity: 'RegisterDay',
        entityId: `${branchId}|${date}`,
        branchId,
        summary: `Close request for ${date} rejected`,
      });
    }
  });
}

export async function reopenDay(actor: SessionUser, branchId: string, date: string) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(registerDays)
      .where(and(eq(registerDays.branchId, branchId), eq(registerDays.date, date)))
      .for('update')
      .limit(1);
    if (!existing) throw new Error('Day record not found');
    await tx.update(registerDays).set({ status: 'OPEN', approvedById: null, approvedAt: null }).where(eq(registerDays.id, existing.id));
    await writeAudit(tx, actor, {
      action: 'register.day_reopened',
      entity: 'RegisterDay',
      entityId: `${branchId}|${date}`,
      branchId,
      summary: `Day ${date} reopened`,
    });
  });
}
