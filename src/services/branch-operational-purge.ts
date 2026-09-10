import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db';
import type { SessionUser } from '@/lib/auth/session';
import { writeAudit } from '@/lib/audit';

type PurgeCounts = {
  cases: number;
  agents: number;
  customers: number;
  forecasts: number;
  transactions: number;
  instalments: number;
  registerDays: number;
  notifications: number;
};

/**
 * Remove the customer/maturity register and agent directory for AZM. Staff login accounts,
 * cashbook days and children, cash positions, holidays, branch settings and audit history stay.
 */
export async function purgeAzamgarhOperationalData(
  actor: SessionUser,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<PurgeCounts> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('maturityflow-branch-operational-purge'))`);
    const branchResult = await tx.execute(sql`
      select id, name from branches where code = 'AZM' for update
    `);
    const branch = branchResult.rows[0] as { id?: string; name?: string } | undefined;
    if (!branch?.id) throw new Error('Azamgarh branch (AZM) was not found. Nothing was deleted.');

    const result = await tx.execute(sql`
      with target_cases as materialized (
        select id from maturity_cases where branch_id = ${branch.id}
      ),
      deleted_notifications as (
        delete from notifications
        where entity_id in (select id from target_cases)
        returning id
      ),
      deleted_transactions as (
        delete from payout_transactions
        where branch_id = ${branch.id}
        returning id
      ),
      deleted_documents as (
        delete from case_documents
        where case_id in (select id from target_cases)
        returning id
      ),
      deleted_events as (
        delete from case_events
        where case_id in (select id from target_cases)
        returning id
      ),
      deleted_instalments as (
        delete from payout_instalments
        where case_id in (select id from target_cases)
        returning id
      ),
      deleted_cases as (
        delete from maturity_cases
        where id in (select id from target_cases)
        returning id
      ),
      deleted_forecasts as (
        delete from maturity_forecasts
        where branch_id = ${branch.id}
        returning id
      ),
      deleted_customers as (
        delete from customers
        where branch_id = ${branch.id}
        returning id
      ),
      deleted_agents as (
        delete from agents
        where branch_id = ${branch.id}
        returning id
      ),
      deleted_register_days as (
        delete from register_days
        where branch_id = ${branch.id}
        returning id
      ),
      reset_counter as (
        delete from case_counters where key like 'AZM|%'
        returning key
      )
      select
        (select count(*)::int from deleted_cases) as cases,
        (select count(*)::int from deleted_agents) as agents,
        (select count(*)::int from deleted_customers) as customers,
        (select count(*)::int from deleted_forecasts) as forecasts,
        (select count(*)::int from deleted_transactions) as transactions,
        (select count(*)::int from deleted_instalments) as instalments,
        (select count(*)::int from deleted_register_days) as register_days,
        (select count(*)::int from deleted_notifications) as notifications
    `);
    const row = result.rows[0] as Record<string, number>;
    const counts: PurgeCounts = {
      cases: Number(row.cases),
      agents: Number(row.agents),
      customers: Number(row.customers),
      forecasts: Number(row.forecasts),
      transactions: Number(row.transactions),
      instalments: Number(row.instalments),
      registerDays: Number(row.register_days),
      notifications: Number(row.notifications),
    };

    await writeAudit(tx, actor, {
      action: 'data.branch_operational_purged',
      entity: 'Branch',
      entityId: branch.id,
      branchId: branch.id,
      summary: `Azamgarh agents, customers and maturity register cleared by administrator. Cashbook, user accounts and branch setup preserved.`,
      before: counts,
      after: { cases: 0, agents: 0, customers: 0, forecasts: 0, transactions: 0, instalments: 0, registerDays: 0 },
      ...meta,
    });
    return counts;
  });
}
