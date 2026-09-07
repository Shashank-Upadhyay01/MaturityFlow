import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { agents, branches, customers } from '@/db/schema';
import { accountKey, customerNameKey } from '@/lib/customer-identity';
import { newId } from '@/lib/id';

/** Serialise all account creation/edit paths, including concurrent spreadsheet uploads. */
export async function customersForAccount(tx: Tx, branchId: string, account: string) {
  const key = accountKey(account);
  if (!key) return [];
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`customer-account:${branchId}:${key}`}, 0))`);
  return tx.select().from(customers).where(and(
    eq(customers.branchId, branchId),
    sql`upper(regexp_replace(trim(${customers.accountNumber}), '[[:space:]]+', '', 'g')) = ${key}`,
  ));
}

export async function assertCustomerBranchAgent(tx: Tx, branchId: string, agentId: string) {
  const [branch] = await tx.select({ id: branches.id }).from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.isActive, true))).limit(1);
  if (!branch) throw new Error('Choose an active branch.');
  const [agent] = await tx.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.branchId, branchId), eq(agents.isActive, true))).limit(1);
  if (!agent) throw new Error('Choose an active agent belonging to the selected branch.');
}

export async function findOrCreateRegisterAgent(tx: Tx, branchId: string, name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ') || 'Unassigned';
  const key = customerNameKey(trimmed);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`register-agent:${branchId}:${key}`}, 0))`);
  const existing = await tx.select().from(agents).where(eq(agents.branchId, branchId));
  const matches = existing.filter((agent) => customerNameKey(agent.name) === key);
  if (matches.length > 1) throw new Error(`Agent "${trimmed}" is ambiguous in this branch. Give the agents distinct names in Settings.`);
  if (matches[0]) {
    if (!matches[0].isActive) throw new Error(`Agent "${trimmed}" is inactive. Reactivate the agent or select an active agent.`);
    return matches[0].id;
  }
  const id = newId('agt');
  // Codes are globally unique, so a branch-local row count is never a valid sequence.
  await tx.insert(agents).values({ id, code: `IMP-${id.slice(4)}`, name: trimmed, branchId });
  return id;
}
