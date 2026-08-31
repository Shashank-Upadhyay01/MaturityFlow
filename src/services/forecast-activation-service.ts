import 'server-only';

import { createHash } from 'node:crypto';
import { and, asc, eq, gte, inArray, like, lt, ne } from 'drizzle-orm';

import { db } from '@/db';
import {
  agents,
  branches,
  caseEvents,
  customers,
  maturityCases,
  maturityForecasts,
  payoutInstalments,
} from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { toActor, type SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import {
  AUGUST_2026_PAYOUT_START,
  AUGUST_2026_WINDOW_DAYS,
  august2026PaymentPolicy,
} from '@/lib/maturity-payment-plan';
import { formatPaise } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { todayISO } from '@/lib/working-days';
import { createCase } from '@/services/case-service';
import { getBranchPolicy } from '@/services/calendar-service';
import { loadOrgSettings } from '@/services/org-settings';
import { persistSchedule } from '@/services/schedule-service';

function monthAfter(month: string): string {
  const [year, value] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, value, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function importedAgentCode(branchCode: string, name: string): string {
  const suffix = createHash('sha256')
    .update(`${branchCode}|${name.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `F-${branchCode}-${suffix}`;
}

async function ensureAgent(
  actor: SessionUser,
  branch: { id: string; code: string },
  name: string,
): Promise<{ id: string; created: boolean }> {
  const cleanName = name.trim() || 'Unassigned forecast agent';
  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.branchId, branch.id), eq(agents.name, cleanName)))
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  return db.transaction(async (tx) => {
    const id = newId('agt');
    const code = importedAgentCode(branch.code, cleanName);
    await tx.insert(agents).values({ id, code, name: cleanName, branchId: branch.id });
    await writeAudit(tx, actor, {
      action: 'agent.created',
      entity: 'Agent',
      entityId: id,
      branchId: branch.id,
      summary: `Forecast activation added agent: ${cleanName} (${code})`,
      userAgent: 'operator-script/activate-maturity-forecast',
    });
    return { id, created: true };
  });
}

async function ensureCustomer(
  actor: SessionUser,
  input: {
    branchId: string;
    agentId: string;
    name: string;
    accountNumber: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const condition = input.accountNumber
    ? and(eq(customers.branchId, input.branchId), eq(customers.accountNumber, input.accountNumber))
    : and(eq(customers.branchId, input.branchId), eq(customers.name, input.name));
  const [existing] = await db.select({ id: customers.id }).from(customers).where(condition).limit(1);
  if (existing) return { id: existing.id, created: false };

  return db.transaction(async (tx) => {
    const id = newId('cus');
    await tx.insert(customers).values({
      id,
      name: input.name,
      accountNumber: input.accountNumber,
      branchId: input.branchId,
      agentId: input.agentId,
    });
    await writeAudit(tx, actor, {
      action: 'customer.created',
      entity: 'Customer',
      entityId: id,
      branchId: input.branchId,
      summary: `Forecast activation added customer: ${input.name}`,
      userAgent: 'operator-script/activate-maturity-forecast',
    });
    return { id, created: true };
  });
}

export interface ForecastActivationResult {
  forecasts: number;
  casesCreated: number;
  casesSkipped: number;
  agentsCreated: number;
  customersCreated: number;
  failed: { customerName: string; message: string }[];
}

/**
 * Promote an explicitly selected forecast month into real scheduled cases for end-to-end testing.
 *
 * Forecast import itself remains non-operational. This separate, deliberate step fans out through
 * `createCase({ submitNow: true })`, so every case gets the normal audit row, exact schedule and
 * downstream cash-planner behaviour. Re-running is idempotent by customer, maturity date and amount.
 */
export async function activateForecastMonthForTesting(
  actor: SessionUser,
  branchId: string,
  month: string,
): Promise<ForecastActivationResult> {
  const auth = toActor(actor);
  assertCan(auth, 'data.import', { branchId });
  assertCan(auth, 'agent.manage', { branchId });
  assertCan(auth, 'customer.manage', { branchId });
  assertCan(auth, 'case.create', { branchId });
  assertCan(auth, 'case.submit', { branchId });

  const [branch] = await db
    .select({ id: branches.id, code: branches.code })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.isActive, true)))
    .limit(1);
  if (!branch) throw new Error('Active branch not found');

  const rows = await db
    .select()
    .from(maturityForecasts)
    .where(
      and(
        eq(maturityForecasts.branchId, branchId),
        gte(maturityForecasts.maturityOn, `${month}-01`),
        lt(maturityForecasts.maturityOn, `${monthAfter(month)}-01`),
      ),
    )
    .orderBy(asc(maturityForecasts.maturityOn), asc(maturityForecasts.customerName));

  const policy = await getBranchPolicy(branchId);
  const org = await loadOrgSettings();
  const submittedOn = todayISO();
  const result: ForecastActivationResult = {
    forecasts: rows.length,
    casesCreated: 0,
    casesSkipped: 0,
    agentsCreated: 0,
    customersCreated: 0,
    failed: [],
  };

  for (const row of rows) {
    try {
      const agent = await ensureAgent(actor, branch, row.agentName ?? 'Unassigned forecast agent');
      if (agent.created) result.agentsCreated += 1;
      const customer = await ensureCustomer(actor, {
        branchId,
        agentId: agent.id,
        name: row.customerName,
        accountNumber: row.accountNumber,
      });
      if (customer.created) result.customersCreated += 1;

      const [duplicate] = await db
        .select({ id: maturityCases.id })
        .from(maturityCases)
        .where(
          and(
            eq(maturityCases.customerId, customer.id),
            eq(maturityCases.instrumentMaturityOn, row.maturityOn),
            eq(maturityCases.maturityAmountPaise, row.currentMaturityPaise),
            ne(maturityCases.status, 'CANCELLED'),
          ),
        )
        .limit(1);
      if (duplicate) {
        result.casesSkipped += 1;
        continue;
      }

      await createCase(
        actor,
        {
          branchId,
          agentId: agent.id,
          customerId: customer.id,
          maturityAmountPaise: row.currentMaturityPaise,
          formSubmittedOn: submittedOn,
          schemeName: row.planName ?? row.productName,
          policyNumber: row.accountNumber,
          instrumentMaturityOn: row.maturityOn,
          windowDays: policy.defaultWindowDays,
          roundingPaise: policy.defaultRoundingPaise,
          distribution: 'FRONT_LOADED',
          cashPolicy: 'CASH_CAP',
          cashCapPerDayPaise: org.cashCapPaise,
          startOnNextWorkingDay: false,
          notes: `Activated from forecast ${row.id} for end-to-end testing. No historical form date was invented; submitted on ${submittedOn}.`,
          submitNow: true,
        },
        { userAgent: 'operator-script/activate-maturity-forecast' },
      );
      result.casesCreated += 1;
    } catch (error) {
      result.failed.push({
        customerName: row.customerName,
        message: error instanceof Error ? error.message : 'Unknown activation error',
      });
    }
  }

  return result;
}

export interface August2026ReplanResult {
  casesFound: number;
  casesReplanned: number;
  casesSkipped: number;
  totalPaise: bigint;
  firstPayoutOn: string | null;
  lastPayoutOn: string | null;
  failed: { caseNumber: string; message: string }[];
}

/**
 * Apply the explicitly authorised 1–12 September payout window to activated August 2026 cases.
 *
 * This is intentionally narrow and idempotent. Each case is its own locked, audited transaction;
 * one bad row does not prevent the other cases being safely replanned.
 */
export async function replanActivatedAugust2026(
  actor: SessionUser,
  branchId: string,
): Promise<August2026ReplanResult> {
  const auth = toActor(actor);
  assertCan(auth, 'case.submit', { branchId });

  const candidates = await db
    .select({ id: maturityCases.id, caseNumber: maturityCases.caseNumber })
    .from(maturityCases)
    .where(and(
      eq(maturityCases.branchId, branchId),
      gte(maturityCases.instrumentMaturityOn, '2026-08-01'),
      lt(maturityCases.instrumentMaturityOn, '2026-09-01'),
      like(maturityCases.notes, 'Activated from forecast %'),
      ne(maturityCases.status, 'CANCELLED'),
    ))
    .orderBy(asc(maturityCases.caseNumber));

  const result: August2026ReplanResult = {
    casesFound: candidates.length,
    casesReplanned: 0,
    casesSkipped: 0,
    totalPaise: 0n,
    firstPayoutOn: null,
    lastPayoutOn: null,
    failed: [],
  };

  for (const candidate of candidates) {
    try {
      const outcome = await db.transaction(async (tx) => {
        // Lock order is non-negotiable: case first, then its instalments.
        const [caseRow] = await tx
          .select()
          .from(maturityCases)
          .where(eq(maturityCases.id, candidate.id))
          .for('update')
          .limit(1);
        if (!caseRow) throw new Error('Case no longer exists.');

        const current = await tx
          .select()
          .from(payoutInstalments)
          .where(and(
            eq(payoutInstalments.caseId, caseRow.id),
            eq(payoutInstalments.scheduleVersion, caseRow.scheduleVersion),
            ne(payoutInstalments.status, 'SUPERSEDED'),
          ))
          .for('update');

        if (
          caseRow.paidCashPaise + caseRow.paidOnlinePaise > 0n ||
          current.some((row) => row.paidCashPaise + row.paidOnlinePaise > 0n)
        ) {
          throw new Error('Payouts have already started; this case was not changed.');
        }

        if (
          caseRow.firstPayoutOn === AUGUST_2026_PAYOUT_START &&
          caseRow.windowDays === AUGUST_2026_WINDOW_DAYS
        ) {
          return { skipped: true as const, amountPaise: caseRow.maturityAmountPaise };
        }

        const branchPolicy = await getBranchPolicy(branchId, tx);
        const special = august2026PaymentPolicy({
          calendar: branchPolicy.calendar,
          windowDays: branchPolicy.defaultWindowDays,
          roundingPaise: caseRow.roundingPaise,
          cashPolicy: caseRow.cashPolicy === 'CASH_CAP'
            ? { kind: 'CASH_CAP', cashCapPerDayPaise: caseRow.cashCapPerDayPaise ?? 0n }
            : { kind: caseRow.cashPolicy },
          dailyCashComfortPaise: branchPolicy.dailyCashComfortPaise,
        });

        if (current.length > 0) {
          await tx
            .update(payoutInstalments)
            .set({ status: 'SUPERSEDED', supersededAt: new Date(), updatedAt: new Date() })
            .where(inArray(payoutInstalments.id, current.map((row) => row.id)));
        }

        const replannedCase = {
          ...caseRow,
          approvedOn: AUGUST_2026_PAYOUT_START,
          windowDays: AUGUST_2026_WINDOW_DAYS,
        };
        await tx
          .update(maturityCases)
          .set({
            approvedOn: AUGUST_2026_PAYOUT_START,
            windowDays: AUGUST_2026_WINDOW_DAYS,
            updatedAt: new Date(),
          })
          .where(eq(maturityCases.id, caseRow.id));

        const schedule = await persistSchedule({
          tx,
          caseRow: replannedCase,
          calendar: special.calendar,
          anchorDate: AUGUST_2026_PAYOUT_START,
          branchDailyCashComfortPaise: branchPolicy.dailyCashComfortPaise,
        });

        await tx.insert(caseEvents).values({
          id: newId('evt'),
          caseId: caseRow.id,
          type: 'SCHEDULE_GENERATED',
          actorId: actor.id,
          note: `August 2026 authorised payout window: ${schedule.firstPayoutDate} → ${schedule.lastPayoutDate}.`,
        });
        await writeAudit(tx, actor, {
          action: 'schedule.rescheduled',
          entity: 'MaturityCase',
          entityId: caseRow.id,
          branchId,
          summary: `${caseRow.caseNumber} replanned into the authorised August cohort window; ${formatPaise(caseRow.maturityAmountPaise)} remains exact`,
          before: {
            scheduleVersion: caseRow.scheduleVersion,
            firstPayoutOn: caseRow.firstPayoutOn,
            deadlineOn: caseRow.deadlineOn,
            windowDays: caseRow.windowDays,
          },
          after: {
            scheduleVersion: caseRow.scheduleVersion + 1,
            firstPayoutOn: schedule.firstPayoutDate,
            deadlineOn: schedule.lastPayoutDate,
            windowDays: AUGUST_2026_WINDOW_DAYS,
          },
          userAgent: 'operator-script/replan-august-2026',
        });

        return {
          skipped: false as const,
          amountPaise: caseRow.maturityAmountPaise,
          firstPayoutOn: schedule.firstPayoutDate,
          lastPayoutOn: schedule.lastPayoutDate,
        };
      });

      result.totalPaise += outcome.amountPaise;
      if (outcome.skipped) {
        result.casesSkipped += 1;
      } else {
        result.casesReplanned += 1;
        result.firstPayoutOn = result.firstPayoutOn === null || outcome.firstPayoutOn < result.firstPayoutOn
          ? outcome.firstPayoutOn
          : result.firstPayoutOn;
        result.lastPayoutOn = result.lastPayoutOn === null || outcome.lastPayoutOn > result.lastPayoutOn
          ? outcome.lastPayoutOn
          : result.lastPayoutOn;
      }
    } catch (error) {
      result.failed.push({
        caseNumber: candidate.caseNumber,
        message: error instanceof Error ? error.message : 'Unknown replanning error',
      });
    }
  }

  return result;
}
