import 'server-only';

import { cache } from 'react';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  like,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import {
  agents,
  auditLog,
  branchCashPositions,
  branches,
  cashbookCommitments,
  cashbookDays,
  cashbookEntries,
  caseDocuments,
  caseEvents,
  customers,
  maturityCases,
  payoutInstalments,
  payoutTransactions,
  registerDays,
  sessions,
  users,
  type CashbookCommitment,
  type CashbookCommitmentKind,
  type CashbookDay,
  type CashbookDayStatus,
  type CashbookEntry,
  type CaseStatus,
} from '@/db/schema';
import type { Actor } from '@/lib/rbac';
import { ROLE_SCOPE, ROLE_WRITE_SCOPE, activeRole } from '@/lib/rbac';
import { buildRunway, type RunwayCase } from '@/lib/cash-runway';
import {
  CASHBOOK_COMMITMENT_KINDS,
  CASHBOOK_ENTRY_CATEGORIES,
  EMPTY_CASHBOOK_DAY_FIGURES,
  calculateDailyCashbook,
  type CashbookDayFigures,
  type DailyCashbookTotals,
} from '@/lib/daily-cashbook';
import { DEFAULT_CASH_CAP_PAISE } from '@/lib/org-settings';
import { LARGE_CASE_THRESHOLD_PAISE } from '@/lib/payout-policy';
import { addDays, collectWorkingDays, todayISO } from '@/lib/working-days';
import { getBranchPolicy } from './calendar-service';
import { loadOrgSettings } from './org-settings';

/**
 * The single place branch/agent scoping is applied. Callers cannot forget it, because
 * every list query in the app funnels through these helpers.
 */
export function caseScope(actor: Actor): SQL | undefined {
  switch (ROLE_SCOPE[activeRole(actor.role)]) {
    case 'ALL':
      return undefined;
    case 'BRANCH':
      return eq(maturityCases.branchId, actor.branchId ?? '__none__');
    case 'OWN':
      return eq(maturityCases.agentId, actor.agentId ?? '__none__');
  }
}

const LIVE: CaseStatus[] = ['APPROVED', 'IN_PROGRESS'];
const OPEN: CaseStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RETURNED',
  'APPROVED',
  'IN_PROGRESS',
  'ON_HOLD',
];

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardStats {
  todaySubmittedCount: number;
  todaySubmittedPaise: bigint;
  todayApprovedCount: number;
  todayApprovedPaise: bigint;
  liveCaseCount: number;
  liveOutstandingPaise: bigint;
  totalGivenPaise: bigint;
  totalRemainingPaise: bigint;
  dueTodayPaise: bigint;
  dueTodayCashPaise: bigint;
  dueTodayOnlinePaise: bigint;
  dueTodayCount: number;
  paidTodayPaise: bigint;
  paidTodayCashPaise: bigint;
  paidTodayOnlinePaise: bigint;
  overdueCount: number;
  overduePaise: bigint;
  breachRiskCount: number;
}

const big = (v: unknown): bigint => (v == null ? 0n : BigInt(v as string));

async function loadDashboardStats(actor: Actor, date: string): Promise<DashboardStats> {
  const scope = caseScope(actor);
  const and_ = (...xs: (SQL | undefined)[]) => and(...(xs.filter(Boolean) as SQL[]));

  // One connection at a time. Parallel tiles against a cloud pooler were
  // starving later pages (cash planner / payouts) of connections.
  const [cases] = await db
    .select({
      todaySubmittedCount: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.formSubmittedOn} = ${date})::int`,
      todaySubmittedPaise: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}) FILTER (WHERE ${maturityCases.formSubmittedOn} = ${date}), 0)`,
      todayApprovedCount: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.approvedOn} = ${date})::int`,
      todayApprovedPaise: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}) FILTER (WHERE ${maturityCases.approvedOn} = ${date}), 0)`,
      liveN: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS'))::int`,
      liveTotal: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS')), 0)`,
      livePaid: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise}) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS')), 0)`,
      breachN: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS') AND ${maturityCases.deadlineOn} < ${date} AND ${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise} < ${maturityCases.maturityAmountPaise})::int`,
    })
    .from(maturityCases)
    .where(scope ?? sql`true`);

  const [dueToday] = await db
    .select({
      n: count(),
      total: sql<string>`COALESCE(SUM(${payoutInstalments.amountPaise} - ${payoutInstalments.paidCashPaise} - ${payoutInstalments.paidOnlinePaise}),0)`,
      cash: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.cashLegPaise} - ${payoutInstalments.paidCashPaise}, 0)),0)`,
      online: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.onlineLegPaise} - ${payoutInstalments.paidOnlinePaise}, 0)),0)`,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and_(
        eq(payoutInstalments.dueOn, date),
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
        inArray(maturityCases.status, LIVE),
        scope,
      ),
    );

  const [paidToday] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${payoutTransactions.totalPaise}),0)`,
      cash: sql<string>`COALESCE(SUM(${payoutTransactions.cashPaise}),0)`,
      online: sql<string>`COALESCE(SUM(${payoutTransactions.onlinePaise}),0)`,
    })
    .from(payoutTransactions)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutTransactions.caseId))
    .where(
      and_(
        eq(payoutTransactions.valueDate, date),
        sql`${payoutTransactions.reversedAt} IS NULL`,
        scope,
      ),
    );

  const [overdue] = await db
    .select({
      n: count(),
      sum: sql<string>`COALESCE(SUM(${payoutInstalments.amountPaise} - ${payoutInstalments.paidCashPaise} - ${payoutInstalments.paidOnlinePaise}),0)`,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and_(
        sql`${payoutInstalments.dueOn} < ${date}`,
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL', 'MISSED']),
        inArray(maturityCases.status, LIVE),
        scope,
      ),
    );

  const liveTotal = big(cases.liveTotal);
  const livePaid = big(cases.livePaid);

  return {
    todaySubmittedCount: Number(cases.todaySubmittedCount),
    todaySubmittedPaise: big(cases.todaySubmittedPaise),
    todayApprovedCount: Number(cases.todayApprovedCount),
    todayApprovedPaise: big(cases.todayApprovedPaise),
    liveCaseCount: Number(cases.liveN),
    liveOutstandingPaise: liveTotal - livePaid,
    totalGivenPaise: livePaid,
    totalRemainingPaise: liveTotal - livePaid,
    dueTodayPaise: big(dueToday.total),
    dueTodayCashPaise: big(dueToday.cash),
    dueTodayOnlinePaise: big(dueToday.online),
    dueTodayCount: Number(dueToday.n),
    paidTodayPaise: big(paidToday.total),
    paidTodayCashPaise: big(paidToday.cash),
    paidTodayOnlinePaise: big(paidToday.online),
    overdueCount: Number(overdue.n),
    overduePaise: big(overdue.sum),
    breachRiskCount: Number(cases.breachN),
  };
}

/**
 * Deduped per request so the app shell and the dashboard page do not each hit the
 * database for the same numbers (that was making every sign-in feel broken).
 */
const cachedDashboardStats = cache(
  async (
    userId: string,
    role: Actor['role'],
    branchId: string | null,
    agentId: string | null,
    date: string,
  ) => loadDashboardStats({ id: userId, role, branchId, agentId, name: '' }, date),
);

export function getDashboardStats(actor: Actor, date = todayISO()): Promise<DashboardStats> {
  return cachedDashboardStats(actor.id, actor.role, actor.branchId, actor.agentId, date);
}

/** Statuses on the register sheet. Rejected / cancelled rows are not in the book. */
/**
 * The outer case, written out, for correlating a subquery back to it.
 *
 * `${maturityCases.id}` cannot be used inside a correlated subquery. Drizzle decides whether to
 * qualify a column by looking at the *outer* query: with a join it emits
 * `"maturity_cases"."id"`, without one it emits a bare `"id"`. Inside
 * `SELECT ... FROM payout_instalments i`, a bare `"id"` resolves to the INSTALMENT's own id, so
 * `i.case_id = "id"` is never true, the subquery returns NULL for every row, and the figure
 * silently falls back to whatever the COALESCE names next. No error, no warning — just a wrong
 * number on the screen the branch funds its drawer from. It cost an afternoon; do not undo it.
 */
const CASE_ID = sql.raw('maturity_cases.id');

const REGISTER_VIEW: CaseStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RETURNED',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
];

export interface RegisterSummary {
  rowCount: number;
  remainingCount: number;
  maturityPaise: bigint;
  givenPaise: bigint;
  givenCashPaise: bigint;
  givenOnlinePaise: bigint;
  remainingPaise: bigint;
  todayApprovedPaise: bigint;
  todayCashPaise: bigint;
  todayOnlinePaise: bigint;
  paidTodayPaise: bigint;
  paidTodayCashPaise: bigint;
  paidTodayOnlinePaise: bigint;
  paidTodayCount: number;
  overdueCount: number;
  overduePaise: bigint;
}

/**
 * The Summary page reads the register, not the instalment schedule.
 * Remaining = amount − paid, same as the sheet header.
 */
export async function getRegisterSummary(
  actor: Actor,
  date = todayISO(),
): Promise<RegisterSummary> {
  const scope = caseScope(actor);
  const and_ = (...xs: (SQL | undefined)[]) => and(...(xs.filter(Boolean) as SQL[]));
  const remainingSql = sql`${maturityCases.maturityAmountPaise} - ${maturityCases.paidCashPaise} - ${maturityCases.paidOnlinePaise}`;

  const [book] = await db
    .select({
      rowCount: sql<number>`COUNT(*)::int`,
      remainingCount: sql<number>`COUNT(*) FILTER (WHERE ${remainingSql} > 0)::int`,
      maturity: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}), 0)`,
      given: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise}), 0)`,
      givenCash: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise}), 0)`,
      givenOnline: sql<string>`COALESCE(SUM(${maturityCases.paidOnlinePaise}), 0)`,
      remaining: sql<string>`COALESCE(SUM(GREATEST(${remainingSql}, 0)), 0)`,
      /*
        What the branch still has to hand over today, summed the same way the Register sheet
        prints it — see `todayPlannedPaise` in register-view.ts.

        The schedule is asked first and the typed `today_approved_paise` only answers for a row
        that has no schedule yet. Before this, the tile summed the typed column while the sheet
        showed the schedule, so the dashboard and the page it summarises disagreed about the
        one figure the branch opens its drawer on.

        Already-paid days drop out via the GREATEST(…, 0): money that has gone out is no longer
        cash anybody needs to find.
      */
      todayApproved: sql<string>`COALESCE(SUM(COALESCE((
        SELECT SUM(GREATEST(i.amount_paise - i.paid_cash_paise - i.paid_online_paise, 0))
        FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID}
          AND i.due_on = ${date}
          AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
      ), ${maturityCases.todayApprovedPaise})), 0)`,
      todayCash: sql<string>`COALESCE(SUM(COALESCE((
        SELECT SUM(LEAST(
          GREATEST(i.cash_leg_paise, 0),
          GREATEST(i.amount_paise - i.paid_cash_paise - i.paid_online_paise, 0)
        ))
        FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID}
          AND i.due_on = ${date}
          AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
      ), ${maturityCases.todayCashPaise})), 0)`,
      todayOnline: sql<string>`COALESCE(SUM(COALESCE((
        SELECT SUM(GREATEST(
          GREATEST(i.amount_paise - i.paid_cash_paise - i.paid_online_paise, 0)
            - LEAST(
                GREATEST(i.cash_leg_paise, 0),
                GREATEST(i.amount_paise - i.paid_cash_paise - i.paid_online_paise, 0)
              ),
          0
        ))
        FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID}
          AND i.due_on = ${date}
          AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
      ), ${maturityCases.todayOnlinePaise})), 0)`,
      overdueCount: sql<number>`COUNT(*) FILTER (
        WHERE ${remainingSql} > 0
          AND COALESCE(${maturityCases.deadlineOn}, ${maturityCases.paymentOn}) < ${date}
      )::int`,
      overduePaise: sql<string>`COALESCE(SUM(GREATEST(${remainingSql}, 0)) FILTER (
        WHERE ${remainingSql} > 0
          AND COALESCE(${maturityCases.deadlineOn}, ${maturityCases.paymentOn}) < ${date}
      ), 0)`,
    })
    .from(maturityCases)
    .where(and_(inArray(maturityCases.status, REGISTER_VIEW), scope));

  const [paidToday] = await db
    .select({
      n: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${payoutTransactions.totalPaise}), 0)`,
      cash: sql<string>`COALESCE(SUM(${payoutTransactions.cashPaise}), 0)`,
      online: sql<string>`COALESCE(SUM(${payoutTransactions.onlinePaise}), 0)`,
    })
    .from(payoutTransactions)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutTransactions.caseId))
    .where(
      and_(
        eq(payoutTransactions.valueDate, date),
        sql`${payoutTransactions.reversedAt} IS NULL`,
        inArray(maturityCases.status, REGISTER_VIEW),
        scope,
      ),
    );

  return {
    rowCount: Number(book?.rowCount ?? 0),
    remainingCount: Number(book?.remainingCount ?? 0),
    maturityPaise: big(book?.maturity),
    givenPaise: big(book?.given),
    givenCashPaise: big(book?.givenCash),
    givenOnlinePaise: big(book?.givenOnline),
    remainingPaise: big(book?.remaining),
    todayApprovedPaise: big(book?.todayApproved),
    todayCashPaise: big(book?.todayCash),
    todayOnlinePaise: big(book?.todayOnline),
    paidTodayPaise: big(paidToday?.total),
    paidTodayCashPaise: big(paidToday?.cash),
    paidTodayOnlinePaise: big(paidToday?.online),
    paidTodayCount: Number(paidToday?.n ?? 0),
    overdueCount: Number(book?.overdueCount ?? 0),
    overduePaise: big(book?.overduePaise),
  };
}

/** Navigation badges only — two light counts, not the full dashboard. */
export async function getNavBadges(
  actor: Actor,
  date = todayISO(),
): Promise<{ dueToday: number; overdue: number }> {
  const scope = caseScope(actor);
  const and_ = (...xs: (SQL | undefined)[]) => and(...(xs.filter(Boolean) as SQL[]));

  const [due] = await db
    .select({
      dueToday: sql<number>`COUNT(*) FILTER (WHERE ${payoutInstalments.dueOn} = ${date} AND ${payoutInstalments.status} IN ('PENDING','PARTIAL'))::int`,
      overdue: sql<number>`COUNT(*) FILTER (WHERE ${payoutInstalments.dueOn} < ${date} AND ${payoutInstalments.status} IN ('PENDING','PARTIAL','MISSED'))::int`,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(and_(inArray(maturityCases.status, LIVE), scope));

  return {
    dueToday: Number(due?.dueToday ?? 0),
    overdue: Number(due?.overdue ?? 0),
  };
}

/** 14-day forward view of what must be paid, for the chart on the dashboard. */
export async function getUpcomingLoad(actor: Actor, days = 14, from = todayISO()) {
  const scope = caseScope(actor);
  const to = addDays(from, days);
  const rows = await db
    .select({
      date: payoutInstalments.dueOn,
      cash: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.cashLegPaise} - ${payoutInstalments.paidCashPaise},0)),0)`,
      online: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.onlineLegPaise} - ${payoutInstalments.paidOnlinePaise},0)),0)`,
      n: count(),
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and(
        gte(payoutInstalments.dueOn, from),
        lte(payoutInstalments.dueOn, to),
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
        inArray(maturityCases.status, LIVE),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(payoutInstalments.dueOn)
    .orderBy(asc(payoutInstalments.dueOn));

  return rows.map((r) => ({
    date: r.date,
    cashPaise: big(r.cash),
    onlinePaise: big(r.online),
    count: r.n,
  }));
}

// ── Case register ─────────────────────────────────────────────────────────

export interface CaseFilters {
  status?: CaseStatus[];
  branchId?: string;
  agentId?: string;
  q?: string;
  from?: string;
  to?: string;
  onlyOverdue?: boolean;
  limit?: number;
  offset?: number;
}

export async function listCases(actor: Actor, f: CaseFilters = {}) {
  const conds: SQL[] = [];
  const scope = caseScope(actor);
  if (scope) conds.push(scope);
  if (f.status?.length) conds.push(inArray(maturityCases.status, f.status));
  if (f.branchId) conds.push(eq(maturityCases.branchId, f.branchId));
  if (f.agentId) conds.push(eq(maturityCases.agentId, f.agentId));
  if (f.from) conds.push(gte(maturityCases.formSubmittedOn, f.from));
  if (f.to) conds.push(lte(maturityCases.formSubmittedOn, f.to));
  if (f.onlyOverdue) {
    conds.push(sql`${maturityCases.deadlineOn} < ${todayISO()}`);
    conds.push(inArray(maturityCases.status, LIVE));
  }
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    conds.push(
      or(
        sql`${maturityCases.caseNumber} ILIKE ${like}`,
        sql`${customers.name} ILIKE ${like}`,
        sql`${customers.phone} ILIKE ${like}`,
        sql`${agents.name} ILIKE ${like}`,
        sql`${maturityCases.policyNumber} ILIKE ${like}`,
      )!,
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      formSubmittedOn: maturityCases.formSubmittedOn,
      approvedOn: maturityCases.approvedOn,
      deadlineOn: maturityCases.deadlineOn,
      windowDays: maturityCases.windowDays,
      customerName: customers.name,
      customerPhone: customers.phone,
      agentName: agents.name,
      agentId: agents.id,
      branchName: branches.name,
      branchCode: branches.code,
      branchId: branches.id,
      createdAt: maturityCases.createdAt,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(where)
    .orderBy(desc(maturityCases.createdAt))
    .limit(f.limit ?? 50)
    .offset(f.offset ?? 0);

  const [{ n }] = await db
    .select({ n: count() })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .where(where);

  return { rows, total: n };
}

/** Full branch register — the Excel sheet, every row. */
/**
 * The register, joined to the schedule the system generated for each case.
 *
 * Before auto-scheduling this list knew nothing about instalments: `todayApprovedPaise` was a
 * figure a clerk typed in by hand. Now every live case carries a day-by-day plan, so the sheet
 * reads that plan rather than asking someone to retype it — what is due today, whether it has
 * been taken, and what was missed on earlier days.
 *
 * The two correlated subqueries are per-case and hit `inst_case_status_idx` / `inst_due_status_idx`;
 * they replace what would otherwise be a second round trip per row from the component.
 */
export async function listRegister(actor: Actor, date = todayISO()) {
  const scope = caseScope(actor);

  /**
   * One expression per field of today's instalment, rather than a join: a case can hold rows from
   * an older schedule version, so each has to pick the live one deterministically.
   */
  const todayInst = (expr: ReturnType<typeof sql.raw>) => sql`(
    SELECT ${expr} FROM payout_instalments i
    WHERE i.case_id = ${CASE_ID}
      AND i.due_on = ${date}
      AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
    ORDER BY i.schedule_version DESC LIMIT 1
  )`;

  return db
    .select({
      /** The instalment today's Taken / Missed buttons act on. Null when nothing is due today. */
      todayInstalmentId: sql<string | null>`${todayInst(sql.raw('i.id'))}`,
      todayDuePaise: sql<string>`COALESCE(${todayInst(sql.raw('i.amount_paise::text'))}, '0')`,
      todayPaidPaise: sql<string>`COALESCE(${todayInst(sql.raw('(i.paid_cash_paise + i.paid_online_paise)::text'))}, '0')`,
      todayStatus: sql<string | null>`${todayInst(sql.raw('i.status::text'))}`,
      /**
       * The legs the engine planned for today, so the sheet can show the split it is about to
       * pay rather than one a clerk typed. INV-3 guarantees they reconcile to the amount.
       */
      todayCashDuePaise: sql<string>`COALESCE(${todayInst(sql.raw('i.cash_leg_paise::text'))}, '0')`,
      todayOnlineDuePaise: sql<string>`COALESCE(${todayInst(sql.raw('i.online_leg_paise::text'))}, '0')`,
      paidTodayPaise: sql<string>`COALESCE((
        SELECT SUM(t.total_paise)::text FROM payout_transactions t
        WHERE t.case_id = ${CASE_ID} AND t.value_date = ${date} AND t.reversed_at IS NULL
      ), '0')`,
      paidTodayCashPaise: sql<string>`COALESCE((
        SELECT SUM(t.cash_paise)::text FROM payout_transactions t
        WHERE t.case_id = ${CASE_ID} AND t.value_date = ${date} AND t.reversed_at IS NULL
      ), '0')`,
      paidTodayOnlinePaise: sql<string>`COALESCE((
        SELECT SUM(t.online_paise)::text FROM payout_transactions t
        WHERE t.case_id = ${CASE_ID} AND t.value_date = ${date} AND t.reversed_at IS NULL
      ), '0')`,
      payoutDays: sql<unknown>`COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'dueOn', i.due_on::text,
            'id', i.id,
            'amountPaise', i.amount_paise::text,
            'cashPaise', i.cash_leg_paise::text,
            'onlinePaise', i.online_leg_paise::text,
            'paidPaise', (i.paid_cash_paise + i.paid_online_paise)::text,
            'status', i.status::text
          ) ORDER BY i.due_on, i.seq
        )
        FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID} AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
      ), '[]'::jsonb)`,
      /**
       * Whether this case has a live schedule at all.
       *
       * Not the same question as "is anything due today": a maturity below ₹1 lakh pays on
       * alternate days, so it is fully scheduled and has nothing due on half of them. This is
       * what the Sched. column reports.
       */
      liveInstalmentCount: sql<number>`(
        SELECT COUNT(*)::int FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID} AND i.status NOT IN ('SUPERSEDED', 'CANCELLED')
      )`,
      /** Earlier days that were never paid — the red half of the sheet. */
      overdueCount: sql<number>`(
        SELECT COUNT(*)::int FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID} AND i.due_on < ${date}
          AND i.status IN ('PENDING', 'PARTIAL', 'MISSED')
      )`,
      overduePaise: sql<string>`(
        SELECT COALESCE(SUM(i.amount_paise - i.paid_cash_paise - i.paid_online_paise), 0)::text
        FROM payout_instalments i
        WHERE i.case_id = ${CASE_ID} AND i.due_on < ${date}
          AND i.status IN ('PENDING', 'PARTIAL', 'MISSED')
      )`,
      id: maturityCases.id,
      accountNumber: customers.accountNumber,
      customerName: customers.name,
      instrumentMaturityOn: maturityCases.instrumentMaturityOn,
      formSubmittedOn: maturityCases.formSubmittedOn,
      paymentOn: maturityCases.paymentOn,
      firstPayoutOn: maturityCases.firstPayoutOn,
      opsReviewedOn: maturityCases.opsReviewedOn,
      opsReviewedAt: maturityCases.opsReviewedAt,
      opsReviewedById: maturityCases.opsReviewedById,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      todayApprovedPaise: maturityCases.todayApprovedPaise,
      todayCashPaise: maturityCases.todayCashPaise,
      todayOnlinePaise: maturityCases.todayOnlinePaise,
      cashCapPerDayPaise: maturityCases.cashCapPerDayPaise,
      windowDays: maturityCases.windowDays,
      agentName: agents.name,
      agentId: agents.id,
      status: maturityCases.status,
      submittedAt: maturityCases.submittedAt,
      approvedOn: maturityCases.approvedOn,
      branchId: maturityCases.branchId,
      branchName: branches.name,
      dailyCashComfortPaise: branches.dailyCashComfortPaise,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(
        inArray(maturityCases.status, [
          'DRAFT',
          'SUBMITTED',
          'UNDER_REVIEW',
          'RETURNED',
          'APPROVED',
          'IN_PROGRESS',
          'COMPLETED',
          'ON_HOLD',
        ]),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(maturityCases.approvedOn), asc(customers.name));
}

export async function getRegisterDesk(branchId: string, date: string) {
  const [cash] = await db
    .select()
    .from(branchCashPositions)
    .where(and(eq(branchCashPositions.branchId, branchId), eq(branchCashPositions.date, date)))
    .limit(1);
  const [day] = await db
    .select()
    .from(registerDays)
    .where(and(eq(registerDays.branchId, branchId), eq(registerDays.date, date)))
    .limit(1);
  const [paidToday] = await db
    .select({
      n: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${payoutTransactions.totalPaise}),0)`,
      cash: sql<string>`COALESCE(SUM(${payoutTransactions.cashPaise}),0)`,
      online: sql<string>`COALESCE(SUM(${payoutTransactions.onlinePaise}),0)`,
    })
    .from(payoutTransactions)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutTransactions.caseId))
    .where(
      and(
        eq(maturityCases.branchId, branchId),
        eq(payoutTransactions.valueDate, date),
        sql`${payoutTransactions.reversedAt} IS NULL`,
      ),
    );
  return {
    cashInHandPaise: cash?.openingCashPaise ?? 0n,
    plannedOnlinePaise: cash?.plannedOnlinePaise ?? 0n,
    dayStatus: day?.status ?? 'OPEN',
    withdrawalsToday: paidToday?.n ?? 0,
    paidTodayPaise: big(paidToday?.total),
    paidTodayCashPaise: big(paidToday?.cash),
    paidTodayOnlinePaise: big(paidToday?.online),
  };
}

// ── Daily cashbook ───────────────────────────────────────────────────────

export interface CashbookBranchRef {
  id: string;
  code: string;
  name: string;
  city: string | null;
  isActive: boolean;
  comfortPaise: bigint;
}

/** A named item together with the business date on which it first entered the book. */
export interface CashbookCommitmentView extends CashbookCommitment {
  sourceDate: string;
  carried: boolean;
}

export interface CashbookCommitmentKindTotals {
  /** Items entered on the selected day's sheet, whether or not they were later settled. */
  openedTodayPaise: bigint;
  /** Still-outstanding items whose source day is earlier than the selected day. */
  carriedPaise: bigint;
  /** All items still outstanding at the end of the selected day. */
  outstandingPaise: bigint;
}

export type CashbookCommitmentTotals = Record<
  CashbookCommitmentKind,
  CashbookCommitmentKindTotals
>;

export interface CashbookPayoutComparison {
  transactionCount: number;
  payoutTotalPaise: bigint;
  payoutCashPaise: bigint;
  payoutOnlinePaise: bigint;
  cashbookWithdrawalPaise: bigint;
  /** Cashbook withdrawal minus payout cash. Negative means payout cash is missing from the book. */
  withdrawalVsPayoutCashPaise: bigint;
  payoutCashMissingFromCashbookPaise: bigint;
  otherCashWithdrawalsPaise: bigint;
}

export interface CashbookPlannedOpening {
  amountPaise: bigint;
  plannedOnlinePaise: bigint;
  source: 'EXACT' | 'CARRIED_FORWARD' | 'NONE';
  sourceDate: string | null;
  note: string | null;
  updatedAt: Date | null;
}

export interface CashbookDayView {
  branch: CashbookBranchRef;
  date: string;
  day: CashbookDay | null;
  figures: CashbookDayFigures;
  /** Rows active at the end of this business date. */
  entries: CashbookEntry[];
  /** Named items opened on this date. These, and only these, feed the legacy day totals. */
  currentCommitments: CashbookCommitmentView[];
  /** Prior-day items still outstanding at the end of this date. */
  carriedCommitments: CashbookCommitmentView[];
  /** Current plus carried items still outstanding at the end of this date. */
  outstandingCommitments: CashbookCommitmentView[];
  commitmentTotals: CashbookCommitmentTotals;
  totals: DailyCashbookTotals;
  totalsSource: 'LIVE' | 'CLOSE_SNAPSHOT';
  payoutComparison: CashbookPayoutComparison;
  plannedOpening: CashbookPlannedOpening;
  plannedOpeningPaise: bigint;
  /** Actual opening-balance entries minus the planner's opening figure. */
  openingVsPlanPaise: bigint;
}

export interface CashbookSummaryRow {
  branch: CashbookBranchRef;
  date: string;
  day: CashbookDay | null;
  figures: CashbookDayFigures;
  totals: DailyCashbookTotals;
  totalsSource: 'LIVE' | 'CLOSE_SNAPSHOT';
  commitmentTotals: CashbookCommitmentTotals;
  currentCommitmentCount: number;
  carriedCommitmentCount: number;
  outstandingCommitmentCount: number;
  payoutComparison: CashbookPayoutComparison;
  plannedOpening: CashbookPlannedOpening;
  plannedOpeningPaise: bigint;
  openingVsPlanPaise: bigint;
}

export interface CashbookSummaryTotals
  extends Omit<DailyCashbookTotals, 'state'> {
  /** MIXED prevents one branch's excess from making another branch's shortage disappear. */
  state: DailyCashbookTotals['state'] | 'MIXED';
  oldPortalTotalPaise: bigint;
  fixedDepositPaise: bigint;
  newBusinessPaise: bigint;
  membershipCollectionPaise: bigint;
  oldLoanPaise: bigint;
  payoutTransactionCount: number;
  payoutTotalPaise: bigint;
  payoutCashPaise: bigint;
  payoutOnlinePaise: bigint;
  withdrawalVsPayoutCashPaise: bigint;
  payoutCashMissingFromCashbookPaise: bigint;
  otherCashWithdrawalsPaise: bigint;
  plannedOpeningPaise: bigint;
  openingVsPlanPaise: bigint;
  /** Gross figures; unlike the net difference, neither can mask the other. */
  shortagePaise: bigint;
  excessPaise: bigint;
  commitmentTotals: CashbookCommitmentTotals;
}

export interface CashbookSummary {
  date: string;
  rows: CashbookSummaryRow[];
  totals: CashbookSummaryTotals;
  statusCounts: Record<CashbookDayStatus | 'NOT_STARTED', number>;
  reconciliationCounts: Record<DailyCashbookTotals['state'], number>;
}

function cashbookBranchScope(actor: Actor): SQL | undefined {
  switch (ROLE_SCOPE[activeRole(actor.role)]) {
    case 'ALL':
      return undefined;
    // A cashbook has no agent dimension. OWN therefore narrows to the actor's branch, exactly
    // like a branch-scoped read; roles without cashbook.view are rejected before this query.
    case 'BRANCH':
    case 'OWN':
      return eq(branches.id, actor.branchId ?? '__none__');
  }
}

function cashbookFigures(day: CashbookDay | null): CashbookDayFigures {
  if (!day) return { ...EMPTY_CASHBOOK_DAY_FIGURES };
  return {
    oldPortalTotalPaise: day.oldPortalTotalPaise,
    fixedDepositPaise: day.fixedDepositPaise,
    newBusinessPaise: day.newBusinessPaise,
    membershipCollectionPaise: day.membershipCollectionPaise,
    oldLoanPaise: day.oldLoanPaise,
    note500Count: day.note500Count,
    note200Count: day.note200Count,
    note100Count: day.note100Count,
    note50Count: day.note50Count,
    note20Count: day.note20Count,
    note10Count: day.note10Count,
    coinsPaise: day.coinsPaise,
  };
}

function emptyCommitmentTotals(): CashbookCommitmentTotals {
  return Object.fromEntries(
    CASHBOOK_COMMITMENT_KINDS.map((kind) => [
      kind,
      { openedTodayPaise: 0n, carriedPaise: 0n, outstandingPaise: 0n },
    ]),
  ) as CashbookCommitmentTotals;
}

function totalCommitments(
  current: readonly CashbookCommitmentView[],
  carried: readonly CashbookCommitmentView[],
  outstanding: readonly CashbookCommitmentView[],
): CashbookCommitmentTotals {
  const totals = emptyCommitmentTotals();
  for (const item of current) totals[item.kind].openedTodayPaise += item.amountPaise;
  for (const item of carried) totals[item.kind].carriedPaise += item.amountPaise;
  for (const item of outstanding) totals[item.kind].outstandingPaise += item.amountPaise;
  return totals;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A CLOSED day is an approved accounting record. Prefer its immutable string-only close
 * snapshot to re-deriving history from named items that may be settled on a later date.
 */
function totalsFromCloseSnapshot(day: CashbookDay | null): DailyCashbookTotals | null {
  if (day?.status !== 'CLOSED') return null;
  const snapshot = recordOf(day.closeSnapshot);
  const totals = recordOf(snapshot?.totals);
  const categoryRows = recordOf(totals?.byCategory);
  if (!totals || !categoryRows) return null;

  try {
    const money = (key: string): bigint => {
      const value = totals[key];
      if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error('bad snapshot');
      return BigInt(value);
    };
    const byCategory = Object.fromEntries(
      CASHBOOK_ENTRY_CATEGORIES.map((category) => {
        const value = categoryRows[category];
        if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error('bad snapshot');
        return [category, BigInt(value)];
      }),
    ) as DailyCashbookTotals['byCategory'];
    const state = totals.state;
    if (!['EMPTY', 'BALANCED', 'SHORT', 'EXCESS'].includes(String(state))) {
      throw new Error('bad snapshot');
    }
    if (typeof totals.hasActivity !== 'boolean') throw new Error('bad snapshot');

    const warnings = Array.isArray(totals.warnings)
      ? totals.warnings.filter((warning): warning is 'NEGATIVE_EXPECTED_CASH' =>
          warning === 'NEGATIVE_EXPECTED_CASH',
        )
      : [];
    return {
      byCategory,
      receivingPaise: money('receivingPaise'),
      byAccountPaise: money('byAccountPaise'),
      openingBalancePaise: money('openingBalancePaise'),
      totalAmountPaise: money('totalAmountPaise'),
      deductionsPaise: money('deductionsPaise'),
      expectedPhysicalCashPaise: money('expectedPhysicalCashPaise'),
      countedCashPaise: money('countedCashPaise'),
      cashDifferencePaise: money('cashDifferencePaise'),
      portalBreakdownPaise: money('portalBreakdownPaise'),
      portalVariancePaise: money('portalVariancePaise'),
      givenCashPaise: money('givenCashPaise'),
      dueAmountPaise: money('dueAmountPaise'),
      pendingWithdrawalPaise: money('pendingWithdrawalPaise'),
      hasActivity: totals.hasActivity,
      state: state as DailyCashbookTotals['state'],
      warnings,
    };
  } catch {
    return null;
  }
}

function payoutComparison(
  totals: DailyCashbookTotals,
  payout: { n: number; totalPaise: bigint; cashPaise: bigint; onlinePaise: bigint },
): CashbookPayoutComparison {
  const cashbookWithdrawalPaise = totals.byCategory.WITHDRAWAL;
  const variance = cashbookWithdrawalPaise - payout.cashPaise;
  return {
    transactionCount: payout.n,
    payoutTotalPaise: payout.totalPaise,
    payoutCashPaise: payout.cashPaise,
    payoutOnlinePaise: payout.onlinePaise,
    cashbookWithdrawalPaise,
    withdrawalVsPayoutCashPaise: variance,
    payoutCashMissingFromCashbookPaise: variance < 0n ? -variance : 0n,
    otherCashWithdrawalsPaise: variance > 0n ? variance : 0n,
  };
}

type CashbookLoadedRow = CashbookDayView;

async function loadCashbookRows(
  branchRows: readonly CashbookBranchRef[],
  date: string,
): Promise<CashbookLoadedRow[]> {
  if (branchRows.length === 0) return [];
  const branchIds = branchRows.map((branch) => branch.id);
  const activeAtEndOfDay = (column: SQLWrapper): SQL =>
    or(
      isNull(column),
      sql`(${column} AT TIME ZONE 'Asia/Kolkata')::date > ${date}`,
    )!;

  // Kept sequential deliberately. These are batched across every visible branch, and one
  // connection per request behaves much better behind a small managed-Postgres pooler.
  const dayRows = await db
    .select()
    .from(cashbookDays)
    .where(and(inArray(cashbookDays.branchId, branchIds), eq(cashbookDays.date, date)));

  const entryRows = await db
    .select({ branchId: cashbookDays.branchId, entry: cashbookEntries })
    .from(cashbookEntries)
    .innerJoin(cashbookDays, eq(cashbookDays.id, cashbookEntries.cashbookDayId))
    .where(
      and(
        inArray(cashbookDays.branchId, branchIds),
        eq(cashbookDays.date, date),
        activeAtEndOfDay(cashbookEntries.voidedAt),
      ),
    )
    .orderBy(asc(cashbookEntries.category), asc(cashbookEntries.createdAt));

  const currentRows = await db
    .select({ branchId: cashbookDays.branchId, sourceDate: cashbookDays.date, item: cashbookCommitments })
    .from(cashbookCommitments)
    .innerJoin(cashbookDays, eq(cashbookDays.id, cashbookCommitments.cashbookDayId))
    .where(
      and(
        inArray(cashbookDays.branchId, branchIds),
        eq(cashbookDays.date, date),
        activeAtEndOfDay(cashbookCommitments.voidedAt),
      ),
    )
    .orderBy(asc(cashbookCommitments.kind), asc(cashbookCommitments.createdAt));

  const outstandingRows = await db
    .select({ branchId: cashbookDays.branchId, sourceDate: cashbookDays.date, item: cashbookCommitments })
    .from(cashbookCommitments)
    .innerJoin(cashbookDays, eq(cashbookDays.id, cashbookCommitments.cashbookDayId))
    .where(
      and(
        inArray(cashbookDays.branchId, branchIds),
        lte(cashbookDays.date, date),
        activeAtEndOfDay(cashbookCommitments.voidedAt),
        or(
          isNull(cashbookCommitments.settledAt),
          sql`(${cashbookCommitments.settledAt} AT TIME ZONE 'Asia/Kolkata')::date > ${date}`,
        ),
      ),
    )
    .orderBy(asc(cashbookDays.date), asc(cashbookCommitments.createdAt));

  const payoutRows = await db
    .select({
      branchId: payoutTransactions.branchId,
      n: sql<number>`COUNT(*)::int`,
      total: sql<string>`COALESCE(SUM(${payoutTransactions.totalPaise}), 0)`,
      cash: sql<string>`COALESCE(SUM(${payoutTransactions.cashPaise}), 0)`,
      online: sql<string>`COALESCE(SUM(${payoutTransactions.onlinePaise}), 0)`,
    })
    .from(payoutTransactions)
    .where(
      and(
        inArray(payoutTransactions.branchId, branchIds),
        eq(payoutTransactions.valueDate, date),
        isNull(payoutTransactions.reversedAt),
      ),
    )
    .groupBy(payoutTransactions.branchId);

  const positionRows = await db
    .selectDistinctOn([branchCashPositions.branchId], {
      branchId: branchCashPositions.branchId,
      date: branchCashPositions.date,
      openingCashPaise: branchCashPositions.openingCashPaise,
      plannedOnlinePaise: branchCashPositions.plannedOnlinePaise,
      note: branchCashPositions.note,
      updatedAt: branchCashPositions.updatedAt,
    })
    .from(branchCashPositions)
    .where(
      and(
        inArray(branchCashPositions.branchId, branchIds),
        lte(branchCashPositions.date, date),
      ),
    )
    .orderBy(branchCashPositions.branchId, desc(branchCashPositions.date));

  const dayByBranch = new Map(dayRows.map((day) => [day.branchId, day]));
  const entriesByBranch = new Map<string, CashbookEntry[]>();
  for (const row of entryRows) {
    const rows = entriesByBranch.get(row.branchId) ?? [];
    rows.push(row.entry);
    entriesByBranch.set(row.branchId, rows);
  }
  const currentByBranch = new Map<string, CashbookCommitmentView[]>();
  for (const row of currentRows) {
    const rows = currentByBranch.get(row.branchId) ?? [];
    rows.push({ ...row.item, sourceDate: row.sourceDate, carried: false });
    currentByBranch.set(row.branchId, rows);
  }
  const outstandingByBranch = new Map<string, CashbookCommitmentView[]>();
  for (const row of outstandingRows) {
    const rows = outstandingByBranch.get(row.branchId) ?? [];
    rows.push({ ...row.item, sourceDate: row.sourceDate, carried: row.sourceDate < date });
    outstandingByBranch.set(row.branchId, rows);
  }
  const payoutsByBranch = new Map(
    payoutRows.map((row) => [
      row.branchId,
      {
        n: Number(row.n),
        totalPaise: big(row.total),
        cashPaise: big(row.cash),
        onlinePaise: big(row.online),
      },
    ]),
  );
  const positionsByBranch = new Map(positionRows.map((position) => [position.branchId, position]));

  return branchRows.map((branch) => {
    const day = dayByBranch.get(branch.id) ?? null;
    const entries = entriesByBranch.get(branch.id) ?? [];
    const currentCommitments = currentByBranch.get(branch.id) ?? [];
    const outstandingCommitments = outstandingByBranch.get(branch.id) ?? [];
    const carriedCommitments = outstandingCommitments.filter((item) => item.carried);
    const figures = cashbookFigures(day);
    const liveTotals = calculateDailyCashbook(entries, figures, currentCommitments);
    const closedTotals = totalsFromCloseSnapshot(day);
    const totals = closedTotals ?? liveTotals;
    const payout = payoutsByBranch.get(branch.id) ?? {
      n: 0,
      totalPaise: 0n,
      cashPaise: 0n,
      onlinePaise: 0n,
    };
    const position = positionsByBranch.get(branch.id);
    const plannedOpening: CashbookPlannedOpening = position
      ? {
          amountPaise: position.openingCashPaise,
          plannedOnlinePaise: position.plannedOnlinePaise,
          source: position.date === date ? 'EXACT' : 'CARRIED_FORWARD',
          sourceDate: position.date,
          note: position.note,
          updatedAt: position.updatedAt,
        }
      : {
          amountPaise: 0n,
          plannedOnlinePaise: 0n,
          source: 'NONE',
          sourceDate: null,
          note: null,
          updatedAt: null,
        };

    return {
      branch,
      date,
      day,
      figures,
      entries,
      currentCommitments,
      carriedCommitments,
      outstandingCommitments,
      commitmentTotals: totalCommitments(
        currentCommitments,
        carriedCommitments,
        outstandingCommitments,
      ),
      totals,
      totalsSource: closedTotals ? 'CLOSE_SNAPSHOT' : 'LIVE',
      payoutComparison: payoutComparison(totals, payout),
      plannedOpening,
      plannedOpeningPaise: plannedOpening.amountPaise,
      openingVsPlanPaise: totals.openingBalancePaise - plannedOpening.amountPaise,
    } satisfies CashbookDayView;
  });
}

function cashbookBranchSelection() {
  return {
    id: branches.id,
    code: branches.code,
    name: branches.name,
    city: branches.city,
    isActive: branches.isActive,
    comfortPaise: branches.dailyCashComfortPaise,
  };
}

/** One branch's complete, read-scoped daily cashbook. No row is created on this read path. */
export async function getCashbookDay(
  actor: Actor,
  branchId: string,
  date = todayISO(),
): Promise<CashbookDayView | null> {
  const scope = cashbookBranchScope(actor);
  const [branch] = await db
    .select(cashbookBranchSelection())
    .from(branches)
    .where(and(eq(branches.id, branchId), ...(scope ? [scope] : [])))
    .limit(1);
  if (!branch) return null;
  return (await loadCashbookRows([branch], date))[0] ?? null;
}

function sumCommitmentTotals(rows: readonly CashbookSummaryRow[]): CashbookCommitmentTotals {
  const totals = emptyCommitmentTotals();
  for (const row of rows) {
    for (const kind of CASHBOOK_COMMITMENT_KINDS) {
      totals[kind].openedTodayPaise += row.commitmentTotals[kind].openedTodayPaise;
      totals[kind].carriedPaise += row.commitmentTotals[kind].carriedPaise;
      totals[kind].outstandingPaise += row.commitmentTotals[kind].outstandingPaise;
    }
  }
  return totals;
}

function sumCashbookRows(rows: readonly CashbookSummaryRow[]): CashbookSummaryTotals {
  const byCategory = Object.fromEntries(
    CASHBOOK_ENTRY_CATEGORIES.map((category) => [
      category,
      rows.reduce((sum, row) => sum + row.totals.byCategory[category], 0n),
    ]),
  ) as DailyCashbookTotals['byCategory'];
  const sum = (pick: (row: CashbookSummaryRow) => bigint): bigint =>
    rows.reduce((total, row) => total + pick(row), 0n);
  const shortagePaise = sum((row) =>
    row.totals.cashDifferencePaise < 0n ? -row.totals.cashDifferencePaise : 0n,
  );
  const excessPaise = sum((row) =>
    row.totals.cashDifferencePaise > 0n ? row.totals.cashDifferencePaise : 0n,
  );
  const hasActivity = rows.some((row) => row.totals.hasActivity);
  const state: CashbookSummaryTotals['state'] = !hasActivity
    ? 'EMPTY'
    : shortagePaise > 0n && excessPaise > 0n
      ? 'MIXED'
      : shortagePaise > 0n
        ? 'SHORT'
        : excessPaise > 0n
          ? 'EXCESS'
          : 'BALANCED';

  return {
    byCategory,
    receivingPaise: sum((row) => row.totals.receivingPaise),
    byAccountPaise: sum((row) => row.totals.byAccountPaise),
    openingBalancePaise: sum((row) => row.totals.openingBalancePaise),
    totalAmountPaise: sum((row) => row.totals.totalAmountPaise),
    deductionsPaise: sum((row) => row.totals.deductionsPaise),
    expectedPhysicalCashPaise: sum((row) => row.totals.expectedPhysicalCashPaise),
    countedCashPaise: sum((row) => row.totals.countedCashPaise),
    cashDifferencePaise: sum((row) => row.totals.cashDifferencePaise),
    portalBreakdownPaise: sum((row) => row.totals.portalBreakdownPaise),
    portalVariancePaise: sum((row) => row.totals.portalVariancePaise),
    givenCashPaise: sum((row) => row.totals.givenCashPaise),
    dueAmountPaise: sum((row) => row.totals.dueAmountPaise),
    pendingWithdrawalPaise: sum((row) => row.totals.pendingWithdrawalPaise),
    hasActivity,
    state,
    warnings: rows.some((row) => row.totals.warnings.includes('NEGATIVE_EXPECTED_CASH'))
      ? ['NEGATIVE_EXPECTED_CASH']
      : [],
    oldPortalTotalPaise: sum((row) => row.figures.oldPortalTotalPaise),
    fixedDepositPaise: sum((row) => row.figures.fixedDepositPaise),
    newBusinessPaise: sum((row) => row.figures.newBusinessPaise),
    membershipCollectionPaise: sum((row) => row.figures.membershipCollectionPaise),
    oldLoanPaise: sum((row) => row.figures.oldLoanPaise),
    payoutTransactionCount: rows.reduce(
      (total, row) => total + row.payoutComparison.transactionCount,
      0,
    ),
    payoutTotalPaise: sum((row) => row.payoutComparison.payoutTotalPaise),
    payoutCashPaise: sum((row) => row.payoutComparison.payoutCashPaise),
    payoutOnlinePaise: sum((row) => row.payoutComparison.payoutOnlinePaise),
    withdrawalVsPayoutCashPaise: sum(
      (row) => row.payoutComparison.withdrawalVsPayoutCashPaise,
    ),
    payoutCashMissingFromCashbookPaise: sum(
      (row) => row.payoutComparison.payoutCashMissingFromCashbookPaise,
    ),
    otherCashWithdrawalsPaise: sum((row) => row.payoutComparison.otherCashWithdrawalsPaise),
    plannedOpeningPaise: sum((row) => row.plannedOpeningPaise),
    openingVsPlanPaise: sum((row) => row.openingVsPlanPaise),
    shortagePaise,
    excessPaise,
    commitmentTotals: sumCommitmentTotals(rows),
  };
}

/** Bank/branch daily reconciliation for the Summary dashboard, always over the full scoped book. */
export async function getCashbookSummary(
  actor: Actor,
  date = todayISO(),
): Promise<CashbookSummary> {
  const scope = cashbookBranchScope(actor);
  const branchRows = await db
    .select(cashbookBranchSelection())
    .from(branches)
    .where(and(eq(branches.isActive, true), ...(scope ? [scope] : [])))
    .orderBy(asc(branches.code));
  const loaded = await loadCashbookRows(branchRows, date);
  const rows: CashbookSummaryRow[] = loaded.map((row) => ({
    branch: row.branch,
    date: row.date,
    day: row.day,
    figures: row.figures,
    totals: row.totals,
    totalsSource: row.totalsSource,
    commitmentTotals: row.commitmentTotals,
    currentCommitmentCount: row.currentCommitments.length,
    carriedCommitmentCount: row.carriedCommitments.length,
    outstandingCommitmentCount: row.outstandingCommitments.length,
    payoutComparison: row.payoutComparison,
    plannedOpening: row.plannedOpening,
    plannedOpeningPaise: row.plannedOpeningPaise,
    openingVsPlanPaise: row.openingVsPlanPaise,
  }));

  const statusCounts: CashbookSummary['statusCounts'] = {
    NOT_STARTED: 0,
    OPEN: 0,
    CLOSE_REQUESTED: 0,
    CLOSED: 0,
  };
  const reconciliationCounts: CashbookSummary['reconciliationCounts'] = {
    EMPTY: 0,
    BALANCED: 0,
    SHORT: 0,
    EXCESS: 0,
  };
  for (const row of rows) {
    statusCounts[row.day?.status ?? 'NOT_STARTED'] += 1;
    reconciliationCounts[row.totals.state] += 1;
  }

  return {
    date,
    rows,
    totals: sumCashbookRows(rows),
    statusCounts,
    reconciliationCounts,
  };
}

export async function getCaseDetail(actor: Actor, caseId: string) {
  const scope = caseScope(actor);
  const [row] = await db
    .select({
      c: maturityCases,
      customer: customers,
      agent: agents,
      branch: branches,
      approver: { id: users.id, name: users.name },
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .leftJoin(users, eq(users.id, maturityCases.approvedById))
    .where(and(eq(maturityCases.id, caseId), ...(scope ? [scope] : [])))
    .limit(1);

  if (!row) return null;

  const instalments = await db
    .select()
    .from(payoutInstalments)
    .where(
      and(
        eq(payoutInstalments.caseId, caseId),
        eq(payoutInstalments.scheduleVersion, row.c.scheduleVersion),
      ),
    )
    .orderBy(asc(payoutInstalments.seq));

  const transactions = await db
    .select({
      t: payoutTransactions,
      recordedBy: { name: users.name },
    })
    .from(payoutTransactions)
    .leftJoin(users, eq(users.id, payoutTransactions.recordedById))
    .where(eq(payoutTransactions.caseId, caseId))
    .orderBy(desc(payoutTransactions.paidAt));

  const timeline = await db
    .select({ e: caseEvents, actor: { name: users.name, role: users.role } })
    .from(caseEvents)
    .leftJoin(users, eq(users.id, caseEvents.actorId))
    .where(eq(caseEvents.caseId, caseId))
    .orderBy(desc(caseEvents.at));

  const uploader = alias(users, 'uploader');
  const verifier = alias(users, 'verifier');
  const documents = await db
    .select({
      id: caseDocuments.id,
      kind: caseDocuments.kind,
      fileName: caseDocuments.fileName,
      mimeType: caseDocuments.mimeType,
      sizeBytes: caseDocuments.sizeBytes,
      uploadedAt: caseDocuments.uploadedAt,
      verifiedAt: caseDocuments.verifiedAt,
      uploadedByName: uploader.name,
      verifiedByName: verifier.name,
    })
    .from(caseDocuments)
    .leftJoin(uploader, eq(uploader.id, caseDocuments.uploadedById))
    .leftJoin(verifier, eq(verifier.id, caseDocuments.verifiedById))
    .where(eq(caseDocuments.caseId, caseId))
    .orderBy(asc(caseDocuments.uploadedAt));

  return { ...row, instalments, transactions, timeline, documents };
}

// ── Rollups ───────────────────────────────────────────────────────────────

export async function getAgentRollup(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentCode: agents.code,
      branchName: branches.name,
      totalCases: count(),
      totalPaise: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}),0)`,
      paidPaise: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise}),0)`,
      liveCases: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS'))::int`,
      completedCases: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} = 'COMPLETED')::int`,
      overdueCases: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS') AND ${maturityCases.deadlineOn} < ${todayISO()})::int`,
    })
    .from(maturityCases)
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(and(inArray(maturityCases.status, OPEN.concat('COMPLETED')), ...(scope ? [scope] : [])))
    .groupBy(agents.id, agents.name, agents.code, branches.name)
    .orderBy(desc(sql`COALESCE(SUM(${maturityCases.maturityAmountPaise}),0)`));
}

export async function getBranchRollup(actor: Actor) {
  const branchFilter =
    ROLE_SCOPE[activeRole(actor.role)] === 'ALL' ? undefined : eq(branches.id, actor.branchId ?? '__none__');
  return db
    .select({
      branchId: branches.id,
      branchName: branches.name,
      branchCode: branches.code,
      city: branches.city,
      totalCases: sql<number>`COUNT(${maturityCases.id})::int`,
      totalPaise: sql<string>`COALESCE(SUM(${maturityCases.maturityAmountPaise}),0)`,
      paidPaise: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise}),0)`,
      cashPaise: sql<string>`COALESCE(SUM(${maturityCases.paidCashPaise}),0)`,
      onlinePaise: sql<string>`COALESCE(SUM(${maturityCases.paidOnlinePaise}),0)`,
      liveCases: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS'))::int`,
      overdueCases: sql<number>`COUNT(*) FILTER (WHERE ${maturityCases.status} IN ('APPROVED','IN_PROGRESS') AND ${maturityCases.deadlineOn} < ${todayISO()})::int`,
    })
    .from(branches)
    .leftJoin(maturityCases, eq(maturityCases.branchId, branches.id))
    .where(and(eq(branches.isActive, true), ...(branchFilter ? [branchFilter] : [])))
    .groupBy(branches.id, branches.name, branches.code, branches.city)
    .orderBy(asc(branches.code));
}

// ── Cash runway ──────────────────────────────────────────────────────────

const RUNWAY_ROUNDING = 100n; // ₹1 — leftover must still spread, not collapse to one day

/**
 * Capacity plan for the counter: remaining rupees from the live register, placed
 * on working days, split at the cash cap. Empty only when nobody is owed money.
 */
export async function getCashPlan(branchId: string, days = 14, from = todayISO()) {
  const org = await loadOrgSettings();
  const CASH_CAP = org.cashCapPaise > 0n ? org.cashCapPaise : DEFAULT_CASH_CAP_PAISE;
  const policy = await getBranchPolicy(branchId);
  const workingDays = collectWorkingDays(from, days, policy.calendar);
  const last = workingDays[workingDays.length - 1] ?? from;

  const live = await db
    .select({
      id: maturityCases.id,
      remaining: sql<string>`${maturityCases.maturityAmountPaise} - ${maturityCases.paidCashPaise} - ${maturityCases.paidOnlinePaise}`,
      todayApprovedPaise: maturityCases.todayApprovedPaise,
      todayCashPaise: maturityCases.todayCashPaise,
      todayOnlinePaise: maturityCases.todayOnlinePaise,
      windowDays: maturityCases.windowDays,
      status: maturityCases.status,
      cashCapPerDayPaise: maturityCases.cashCapPerDayPaise,
      customerName: customers.name,
      agentName: agents.name,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .where(
      and(
        eq(maturityCases.branchId, branchId),
        inArray(maturityCases.status, OPEN),
        sql`${maturityCases.maturityAmountPaise} - ${maturityCases.paidCashPaise} - ${maturityCases.paidOnlinePaise} > 0`,
      ),
    );

  const cases: RunwayCase[] = live.map((c) => ({
    id: c.id,
    customerName: c.customerName,
    agentName: c.agentName,
    remainingPaise: big(c.remaining),
    todayApprovedPaise: c.todayApprovedPaise,
    todayCashPaise: c.todayCashPaise,
    todayOnlinePaise: c.todayOnlinePaise,
    windowDays: c.windowDays,
    committed: c.status === 'APPROVED' || c.status === 'IN_PROGRESS',
    cashCapPaise:
      c.cashCapPerDayPaise && c.cashCapPerDayPaise > 0n ? c.cashCapPerDayPaise : CASH_CAP,
  }));

  const positions = await db
    .select()
    .from(branchCashPositions)
    .where(
      and(
        eq(branchCashPositions.branchId, branchId),
        gte(branchCashPositions.date, addDays(from, -40)),
        lte(branchCashPositions.date, last),
      ),
    );
  const posMap = new Map(positions.map((p) => [p.date, p.openingCashPaise]));
  const prior = positions
    .filter((p) => p.date <= from)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const todayOpening = posMap.get(from) ?? prior?.openingCashPaise ?? 0n;
  const openings = new Map<string, bigint>();
  for (const d of workingDays) {
    if (d === from) openings.set(d, todayOpening);
    else if (posMap.has(d)) openings.set(d, posMap.get(d)!);
  }

  const common = {
    cases,
    workingDays,
    roundingPaise: RUNWAY_ROUNDING,
    defaultCashCapPaise: CASH_CAP,
    calendar: policy.calendar,
    openings,
    defaultOpeningPaise: policy.dailyCashComfortPaise,
    comfortPaise: policy.dailyCashComfortPaise,
  };

  return {
    even: buildRunway({ ...common, distribution: 'EVEN' }),
    front: buildRunway({ ...common, distribution: 'FRONT_LOADED' }),
    comfortPaise: policy.dailyCashComfortPaise,
    cashCapPaise: CASH_CAP,
    todayOpeningPaise: todayOpening,
    branchName: policy.name,
    branchCode: policy.code,
    horizonDays: days,
  };
}

/** Day-by-day ledger of planned vs paid, for analysis exports. */
export async function getDailyLedger(actor: Actor, from: string, to: string) {
  const scope = caseScope(actor);
  const rows = await db
    .select({
      date: payoutInstalments.dueOn,
      planned: sql<string>`COALESCE(SUM(${payoutInstalments.amountPaise}),0)`,
      cashDue: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.cashLegPaise} - ${payoutInstalments.paidCashPaise},0)),0)`,
      onlineDue: sql<string>`COALESCE(SUM(GREATEST(${payoutInstalments.onlineLegPaise} - ${payoutInstalments.paidOnlinePaise},0)),0)`,
      cashPaid: sql<string>`COALESCE(SUM(${payoutInstalments.paidCashPaise}),0)`,
      onlinePaid: sql<string>`COALESCE(SUM(${payoutInstalments.paidOnlinePaise}),0)`,
      n: count(),
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and(
        gte(payoutInstalments.dueOn, from),
        lte(payoutInstalments.dueOn, to),
        ne(payoutInstalments.status, 'SUPERSEDED'),
        ...(scope ? [scope] : []),
      ),
    )
    .groupBy(payoutInstalments.dueOn)
    .orderBy(asc(payoutInstalments.dueOn));

  return rows.map((r) => ({
    date: r.date,
    month: r.date.slice(0, 7),
    plannedPaise: big(r.planned),
    cashDuePaise: big(r.cashDue),
    onlineDuePaise: big(r.onlineDue),
    cashPaidPaise: big(r.cashPaid),
    onlinePaidPaise: big(r.onlinePaid),
    count: r.n,
  }));
}

/** Month-by-month rollup of the same ledger. */
export async function getMonthlyLedger(actor: Actor, from: string, to: string) {
  const daily = await getDailyLedger(actor, from, to);
  const byMonth = new Map<
    string,
    {
      month: string;
      plannedPaise: bigint;
      cashDuePaise: bigint;
      onlineDuePaise: bigint;
      cashPaidPaise: bigint;
      onlinePaidPaise: bigint;
      days: number;
      count: number;
    }
  >();
  for (const d of daily) {
    const cur = byMonth.get(d.month) ?? {
      month: d.month,
      plannedPaise: 0n,
      cashDuePaise: 0n,
      onlineDuePaise: 0n,
      cashPaidPaise: 0n,
      onlinePaidPaise: 0n,
      days: 0,
      count: 0,
    };
    cur.plannedPaise += d.plannedPaise;
    cur.cashDuePaise += d.cashDuePaise;
    cur.onlineDuePaise += d.onlineDuePaise;
    cur.cashPaidPaise += d.cashPaidPaise;
    cur.onlinePaidPaise += d.onlinePaidPaise;
    cur.days += 1;
    cur.count += d.count;
    byMonth.set(d.month, cur);
  }
  return [...byMonth.values()];
}

// ── Audit ─────────────────────────────────────────────────────────────────

export interface AuditListFilters {
  action?: string;
  entityId?: string;
  branchId?: string;
  actorId?: string;
  hideAuth?: boolean;
  onlyAuth?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  from?: Date;
  to?: Date;
}

function auditWhere(filters: AuditListFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.action) conds.push(eq(auditLog.action, filters.action));
  if (filters.hideAuth) conds.push(not(like(auditLog.action, 'auth.%')));
  if (filters.onlyAuth) conds.push(like(auditLog.action, 'auth.%'));
  if (filters.entityId) conds.push(eq(auditLog.entityId, filters.entityId));
  if (filters.branchId) conds.push(eq(auditLog.branchId, filters.branchId));
  if (filters.actorId) conds.push(eq(auditLog.actorId, filters.actorId));
  if (filters.query) {
    const term = `%${filters.query.trim()}%`;
    conds.push(
      or(
        ilike(auditLog.summary, term),
        ilike(auditLog.actorName, term),
        ilike(auditLog.action, term),
        ilike(auditLog.entity, term),
        ilike(auditLog.entityId, term),
      )!,
    );
  }
  if (filters.from) conds.push(gte(auditLog.at, filters.from));
  if (filters.to) conds.push(lte(auditLog.at, filters.to));
  return conds.length ? and(...conds) : undefined;
}

export async function listAudit(filters: AuditListFilters = {}) {

  return db
    .select()
    .from(auditLog)
    .where(auditWhere(filters))
    .orderBy(desc(auditLog.at))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
}

/** A bounded audit page plus its unbounded count, using exactly the same predicates. */
export async function listAuditPage(filters: AuditListFilters = {}) {
  const { limit = 50, offset = 0 } = filters;
  const where = auditWhere(filters);

  const [rows, totalRows] = await Promise.all([
    db.select().from(auditLog).where(where).orderBy(desc(auditLog.at)).limit(limit).offset(offset),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);
  return { rows, total: Number(totalRows[0]?.total ?? 0) };
}

/** Stable choices for the audit filters. Audit history itself remains append-only. */
export async function getAuditFilterOptions() {
  const [actionRows, actorRows, branchRows] = await Promise.all([
    db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(asc(auditLog.action)),
    db
      .selectDistinct({ id: auditLog.actorId, name: auditLog.actorName })
      .from(auditLog)
      .orderBy(asc(auditLog.actorName)),
    db
      .select({ id: branches.id, code: branches.code, name: branches.name })
      .from(branches)
      .orderBy(asc(branches.code)),
  ]);
  return {
    actions: actionRows.map((r) => r.action),
    actors: actorRows.filter((r): r is { id: string; name: string } => Boolean(r.id)),
    branches: branchRows,
  };
}

// ── Lookups for forms ─────────────────────────────────────────────────────

/**
 * The dropdowns behind the new-maturity form.
 *
 * These are scoped by ROLE_WRITE_SCOPE, not the wider read scope, because every option here is
 * something the actor is about to *write*. On the read scope an agent would be offered every
 * branch and every agent in the bank, and each pick would then be rejected by `assertCan` on
 * submit — a form full of choices that fail. Offer only what the actor can actually use.
 */
export async function getFormOptions(actor: Actor) {
  const scope = ROLE_WRITE_SCOPE[activeRole(actor.role)];
  const branchFilter = scope === 'ALL' ? undefined : eq(branches.id, actor.branchId ?? '__none__');

  const allBranches = await db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      defaultRoundingPaise: branches.defaultRoundingPaise,
      defaultWindowDays: branches.defaultWindowDays,
      dailyCashComfortPaise: branches.dailyCashComfortPaise,
      registerColumnOrder: branches.registerColumnOrder,
    })
    .from(branches)
    .where(and(eq(branches.isActive, true), ...(branchFilter ? [branchFilter] : [])))
    .orderBy(asc(branches.code));

  const agentFilter =
    scope === 'OWN'
      ? eq(agents.id, actor.agentId ?? '__none__')
      : scope === 'BRANCH'
        ? eq(agents.branchId, actor.branchId ?? '__none__')
        : undefined;

  const agentList = await db
    .select({ id: agents.id, code: agents.code, name: agents.name, branchId: agents.branchId })
    .from(agents)
    .where(and(eq(agents.isActive, true), ...(agentFilter ? [agentFilter] : [])))
    .orderBy(asc(agents.name));

  const customerFilter =
    scope === 'OWN'
      ? eq(customers.agentId, actor.agentId ?? '__none__')
      : scope === 'BRANCH'
        ? eq(customers.branchId, actor.branchId ?? '__none__')
        : undefined;

  const customerList = await db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      branchId: customers.branchId,
      agentId: customers.agentId,
      accountNumber: customers.accountNumber,
    })
    .from(customers)
    .where(customerFilter)
    .orderBy(asc(customers.name))
    .limit(2000);

  const branchList = allBranches.filter((b) => b.code !== 'HO' || allBranches.length === 1);

  return { branches: branchList, agents: agentList, customers: customerList };
}

export async function getApprovalQueue(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      id: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      formSubmittedOn: maturityCases.formSubmittedOn,
      submittedAt: maturityCases.submittedAt,
      windowDays: maturityCases.windowDays,
      roundingPaise: maturityCases.roundingPaise,
      distribution: maturityCases.distribution,
      cashPolicy: maturityCases.cashPolicy,
      cashCapPerDayPaise: maturityCases.cashCapPerDayPaise,
      startOnNextWorkingDay: maturityCases.startOnNextWorkingDay,
      customerName: customers.name,
      customerPhone: customers.phone,
      agentName: agents.name,
      branchId: branches.id,
      branchName: branches.name,
      branchCode: branches.code,
      returnReason: maturityCases.returnReason,
      notes: maturityCases.notes,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(inArray(maturityCases.status, ['SUBMITTED', 'UNDER_REVIEW']), ...(scope ? [scope] : [])),
    )
    .orderBy(asc(maturityCases.submittedAt));
}

export async function getUserDossier(userId: string, currentTokenId?: string) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      employeeCode: users.employeeCode,
      role: users.role,
      branchId: users.branchId,
      branchName: branches.name,
      branchCode: branches.code,
      avatarKey: users.avatarKey,
      notes: users.notes,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      deletedAt: users.deletedAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;

  const now = new Date();

  const [
    sessionRows,
    activity,
    caseRows,
    payoutRows,
    caseCount,
    payoutCount,
    docCount,
    liveSessions,
  ] = await Promise.all([
    db
      .select({
        id: sessions.id,
        tokenId: sessions.tokenId,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(40),
    db
      .select()
      .from(auditLog)
      .where(
        or(
          eq(auditLog.actorId, userId),
          and(eq(auditLog.entity, 'User'), eq(auditLog.entityId, userId)),
        ),
      )
      .orderBy(desc(auditLog.at))
      .limit(200),
    db
      .select({
        id: maturityCases.id,
        caseNumber: maturityCases.caseNumber,
        status: maturityCases.status,
        customerName: customers.name,
        maturityAmountPaise: maturityCases.maturityAmountPaise,
        createdAt: maturityCases.createdAt,
      })
      .from(maturityCases)
      .innerJoin(customers, eq(customers.id, maturityCases.customerId))
      .where(eq(maturityCases.createdById, userId))
      .orderBy(desc(maturityCases.createdAt))
      .limit(30),
    db
      .select({
        id: payoutTransactions.id,
        caseId: payoutTransactions.caseId,
        totalPaise: payoutTransactions.totalPaise,
        cashPaise: payoutTransactions.cashPaise,
        onlinePaise: payoutTransactions.onlinePaise,
        valueDate: payoutTransactions.valueDate,
        paidAt: payoutTransactions.paidAt,
        reversedAt: payoutTransactions.reversedAt,
      })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.recordedById, userId))
      .orderBy(desc(payoutTransactions.paidAt))
      .limit(30),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(maturityCases)
      .where(eq(maturityCases.createdById, userId))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.recordedById, userId))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(caseDocuments)
      .where(eq(caseDocuments.uploadedById, userId))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gte(sessions.expiresAt, now)),
      )
      .then((r) => r[0]?.n ?? 0),
  ]);

  return {
    user: row,
    sessions: sessionRows.map(({ tokenId, ...s }) => ({
      ...s,
      isCurrent: Boolean(currentTokenId && tokenId === currentTokenId),
    })),
    activity,
    cases: caseRows,
    payouts: payoutRows,
    stats: {
      casesCreated: caseCount,
      payoutsRecorded: payoutCount,
      documentsUploaded: docCount,
      liveSessions,
    },
  };
}

// ── Follow-up: the four lists that chase money that has not moved ──────────

/**
 * "Missed" is DERIVED, never read from a stored flag.
 *
 * `markMissedInstalments()` exists in schedule-service.ts and would set `status = 'MISSED'`, but
 * calling it here would mean writing on a read path: a transaction on every page view, fired by
 * anyone holding `case.view` including the read-only Auditor, changing stored state with no audit
 * row. The predicate below is the same answer, needs no write, and cannot drift from a column
 * because it does not consult one.
 *
 * One definition, so the four tabs cannot disagree about what "missed" means.
 */
export function isOverdueInstalment(asOf: string) {
  return and(
    sql`${payoutInstalments.dueOn} < ${asOf}`,
    inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
  );
}

const followUpRow = {
  caseId: maturityCases.id,
  caseNumber: maturityCases.caseNumber,
  customerName: customers.name,
  accountNumber: customers.accountNumber,
  agentName: agents.name,
  agentId: agents.id,
  branchName: branches.name,
  maturityAmountPaise: maturityCases.maturityAmountPaise,
  paidCashPaise: maturityCases.paidCashPaise,
  paidOnlinePaise: maturityCases.paidOnlinePaise,
  approvedOn: maturityCases.approvedOn,
  deadlineOn: maturityCases.deadlineOn,
  cadence: maturityCases.cadence,
} as const;

/** Days that came and went without the money going out. */
export async function listMissedInstalments(actor: Actor, asOf: string) {
  const scope = caseScope(actor);
  return db
    .select({
      ...followUpRow,
      instalmentId: payoutInstalments.id,
      dueOn: payoutInstalments.dueOn,
      dueAmountPaise: payoutInstalments.amountPaise,
      duePaidPaise: sql<string>`${payoutInstalments.paidCashPaise} + ${payoutInstalments.paidOnlinePaise}`,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(and(isOverdueInstalment(asOf), ...(scope ? [scope] : [])))
    .orderBy(asc(payoutInstalments.dueOn));
}

/** Due today, still not handed over. */
export async function listNotTakenToday(actor: Actor, asOf: string) {
  const scope = caseScope(actor);
  return db
    .select({
      ...followUpRow,
      instalmentId: payoutInstalments.id,
      dueOn: payoutInstalments.dueOn,
      dueAmountPaise: payoutInstalments.amountPaise,
      duePaidPaise: sql<string>`${payoutInstalments.paidCashPaise} + ${payoutInstalments.paidOnlinePaise}`,
      cashLegPaise: payoutInstalments.cashLegPaise,
      onlineLegPaise: payoutInstalments.onlineLegPaise,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(
        sql`${payoutInstalments.dueOn} = ${asOf}`,
        inArray(payoutInstalments.status, ['PENDING', 'PARTIAL']),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(desc(payoutInstalments.amountPaise));
}

/**
 * Live cases at or above the ₹1 lakh line — the ones paid every working day.
 *
 * The threshold is the policy's, not a literal repeated here: change LARGE_CASE_THRESHOLD_PAISE
 * and this list follows.
 */
export async function listPriorityCases(actor: Actor, asOf: string) {
  const scope = caseScope(actor);
  return db
    .select({
      ...followUpRow,
      dueTodayPaise: sql<string>`COALESCE((
        SELECT SUM(pi.amount_paise - pi.paid_cash_paise - pi.paid_online_paise)
        FROM payout_instalments pi
        WHERE pi.case_id = ${maturityCases.id}
          AND pi.due_on = ${asOf}
          AND pi.status IN ('PENDING','PARTIAL')
      ), 0)`,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(
        inArray(maturityCases.status, ['APPROVED', 'IN_PROGRESS']),
        sql`${maturityCases.maturityAmountPaise} >= ${LARGE_CASE_THRESHOLD_PAISE}`,
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(desc(maturityCases.maturityAmountPaise));
}

/** Past the promised completion date with money still owed. */
export async function listBreachedCases(actor: Actor, asOf: string) {
  const scope = caseScope(actor);
  return db
    .select(followUpRow)
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(
        inArray(maturityCases.status, ['APPROVED', 'IN_PROGRESS']),
        sql`${maturityCases.deadlineOn} IS NOT NULL AND ${maturityCases.deadlineOn} < ${asOf}`,
        sql`${maturityCases.paidCashPaise} + ${maturityCases.paidOnlinePaise} < ${maturityCases.maturityAmountPaise}`,
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(maturityCases.deadlineOn));
}

/**
 * Every customer an agent is responsible for, with the state of each maturity.
 *
 * One row per case, not per customer: a customer can hold more than one maturity, and collapsing
 * them would hide the one that has not been paid. The caller groups.
 *
 * Scoped like everything else — an agent opening this sees only their own book.
 */
export async function getAgentCustomers(actor: Actor, agentId: string) {
  const scope = caseScope(actor);
  return db
    .select({
      caseId: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      customerId: customers.id,
      customerName: customers.name,
      accountNumber: customers.accountNumber,
      phone: customers.phone,
      schemeName: maturityCases.schemeName,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      instrumentMaturityOn: maturityCases.instrumentMaturityOn,
      formSubmittedOn: maturityCases.formSubmittedOn,
      approvedOn: maturityCases.approvedOn,
      deadlineOn: maturityCases.deadlineOn,
      paymentOn: maturityCases.paymentOn,
      cadence: maturityCases.cadence,
      branchName: branches.name,
      agentName: agents.name,
      agentCode: agents.code,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(
      and(
        eq(maturityCases.agentId, agentId),
        inArray(maturityCases.status, OPEN.concat('COMPLETED')),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(customers.name), asc(maturityCases.caseNumber));
}

/** The same, for every agent at once — what the Agents page expands into. */
export async function getAllAgentCustomers(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      agentId: maturityCases.agentId,
      caseId: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      customerId: customers.id,
      customerName: customers.name,
      accountNumber: customers.accountNumber,
      phone: customers.phone,
      schemeName: maturityCases.schemeName,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      instrumentMaturityOn: maturityCases.instrumentMaturityOn,
      formSubmittedOn: maturityCases.formSubmittedOn,
      approvedOn: maturityCases.approvedOn,
      deadlineOn: maturityCases.deadlineOn,
      paymentOn: maturityCases.paymentOn,
      cadence: maturityCases.cadence,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .where(and(inArray(maturityCases.status, OPEN.concat('COMPLETED')), ...(scope ? [scope] : [])))
    .orderBy(asc(customers.name), asc(maturityCases.caseNumber));
}

// ── The Register's planning board ──────────────────────────────────────────

/**
 * Every open case with the parameters its schedule is built from, plus the schedule itself
 * where one exists.
 *
 * The board has to answer "what will this customer get, on which day" for cases that have NOT
 * been approved yet — most of the register, most of the time — so it cannot just read
 * `payout_instalments`. It returns the inputs as well, and the client runs the same pure engine
 * the server will run at approval to project the rest. Approved cases come back with their real
 * rows and are shown as fact; the rest are shown as a projection and labelled as one.
 */
export async function getPlanBoardCases(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      caseId: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      customerName: customers.name,
      accountNumber: customers.accountNumber,
      phone: customers.phone,
      agentName: agents.name,
      agentId: agents.id,
      branchId: maturityCases.branchId,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      todayApprovedPaise: maturityCases.todayApprovedPaise,
      // Everything generateSchedule needs, so the client can project an unapproved case.
      windowDays: maturityCases.windowDays,
      roundingPaise: maturityCases.roundingPaise,
      distribution: maturityCases.distribution,
      cadence: maturityCases.cadence,
      cashPolicy: maturityCases.cashPolicy,
      cashCapPerDayPaise: maturityCases.cashCapPerDayPaise,
      startOnNextWorkingDay: maturityCases.startOnNextWorkingDay,
      scheduleVersion: maturityCases.scheduleVersion,
      approvedOn: maturityCases.approvedOn,
      deadlineOn: maturityCases.deadlineOn,
      formSubmittedOn: maturityCases.formSubmittedOn,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .where(and(inArray(maturityCases.status, OPEN), ...(scope ? [scope] : [])))
    .orderBy(desc(maturityCases.maturityAmountPaise));
}

/** The live schedule rows for those cases — what has actually been planned and paid. */
export async function getPlanBoardInstalments(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      caseId: payoutInstalments.caseId,
      seq: payoutInstalments.seq,
      dueOn: payoutInstalments.dueOn,
      amountPaise: payoutInstalments.amountPaise,
      cashLegPaise: payoutInstalments.cashLegPaise,
      onlineLegPaise: payoutInstalments.onlineLegPaise,
      paidCashPaise: payoutInstalments.paidCashPaise,
      paidOnlinePaise: payoutInstalments.paidOnlinePaise,
      status: payoutInstalments.status,
    })
    .from(payoutInstalments)
    .innerJoin(maturityCases, eq(maturityCases.id, payoutInstalments.caseId))
    .where(
      and(
        eq(payoutInstalments.scheduleVersion, maturityCases.scheduleVersion),
        ne(payoutInstalments.status, 'SUPERSEDED'),
        inArray(maturityCases.status, OPEN),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(asc(payoutInstalments.dueOn), asc(payoutInstalments.seq));
}

// ── The Customers book ────────────────────────────────────────────────────

/**
 * Every customer on the register, with each of their maturities.
 *
 * One row per CASE, not per customer — a customer can hold several maturities and collapsing
 * them would hide the one that has not been paid. The caller groups by `customerId`.
 *
 * Carries the schedule parameters as well, so the page can show the day-by-day plan for a case
 * that has not been approved yet. Scoped like every other read.
 */
export async function getCustomerBook(actor: Actor) {
  const scope = caseScope(actor);
  return db
    .select({
      caseId: maturityCases.id,
      caseNumber: maturityCases.caseNumber,
      customerId: customers.id,
      customerName: customers.name,
      customerCode: customers.customerCode,
      accountNumber: customers.accountNumber,
      phone: customers.phone,
      email: customers.email,
      address: customers.address,
      payoutBank: customers.payoutBank,
      payoutAccount: customers.payoutAccount,
      payoutIfsc: customers.payoutIfsc,
      agentName: agents.name,
      agentId: agents.id,
      branchId: maturityCases.branchId,
      branchName: branches.name,
      schemeName: maturityCases.schemeName,
      status: maturityCases.status,
      maturityAmountPaise: maturityCases.maturityAmountPaise,
      paidCashPaise: maturityCases.paidCashPaise,
      paidOnlinePaise: maturityCases.paidOnlinePaise,
      instrumentMaturityOn: maturityCases.instrumentMaturityOn,
      formSubmittedOn: maturityCases.formSubmittedOn,
      approvedOn: maturityCases.approvedOn,
      deadlineOn: maturityCases.deadlineOn,
      paymentOn: maturityCases.paymentOn,
      windowDays: maturityCases.windowDays,
      roundingPaise: maturityCases.roundingPaise,
      distribution: maturityCases.distribution,
      cadence: maturityCases.cadence,
      cashPolicy: maturityCases.cashPolicy,
      cashCapPerDayPaise: maturityCases.cashCapPerDayPaise,
      startOnNextWorkingDay: maturityCases.startOnNextWorkingDay,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .innerJoin(agents, eq(agents.id, maturityCases.agentId))
    .innerJoin(branches, eq(branches.id, maturityCases.branchId))
    .where(and(inArray(maturityCases.status, OPEN.concat('COMPLETED')), ...(scope ? [scope] : [])))
    .orderBy(asc(customers.name), asc(maturityCases.caseNumber));
}

export { ne };
