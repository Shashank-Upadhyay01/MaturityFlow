import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { customers, maturityCases } from '@/db/schema';

/**
 * register-bulk.ts — acting on many ticked rows at once.
 *
 * Every one of these fans out to the SAME single-row function the sheet already calls when you
 * edit one cell. That is the whole design: a bulk action is a loop over the audited path, not a
 * second, faster path that skips the row lock and the audit line. One `UPDATE … WHERE id IN (…)`
 * would be one round-trip instead of fifty, and it would also be the first place in this codebase
 * where money moved without a lock and without a trail. Fifty round-trips is the cheaper mistake.
 *
 * Each row is attempted independently and failures are collected rather than thrown, because the
 * realistic bulk action is "these forty rows, two of which have already been paid". Aborting the
 * whole batch on row 3 would leave the clerk re-ticking thirty-seven rows to find out which ones
 * were the problem.
 */

/** Hard ceiling on one bulk call. A selection larger than this is a mis-click, not an intent. */
export const MAX_BULK_ROWS = 500;

export interface BulkFailure {
  id: string;
  label: string;
  error: string;
}

export interface BulkOutcome {
  done: number;
  failed: BulkFailure[];
}

export interface CaseRef {
  id: string;
  branchId: string;
  agentId: string;
  caseNumber: string;
  customerName: string;
}

/** One query for the whole selection — scope checks and error labels both read from this. */
export async function loadCaseRefs(caseIds: readonly string[]): Promise<Map<string, CaseRef>> {
  if (caseIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: maturityCases.id,
      branchId: maturityCases.branchId,
      agentId: maturityCases.agentId,
      caseNumber: maturityCases.caseNumber,
      customerName: customers.name,
    })
    .from(maturityCases)
    .innerJoin(customers, eq(customers.id, maturityCases.customerId))
    .where(inArray(maturityCases.id, [...caseIds]));
  return new Map(rows.map((r) => [r.id, r]));
}

export function labelFor(ref: CaseRef | undefined, id: string): string {
  if (!ref) return id;
  const name = ref.customerName?.trim();
  return name && name !== 'New customer' ? `${ref.caseNumber} · ${name}` : ref.caseNumber;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : 'Could not update this row';
}

/**
 * Run `each` over every id, keeping going past failures.
 *
 * Sequential on purpose. These all take `SELECT … FOR UPDATE` on the case row and several of them
 * touch the shared agent table; firing them concurrently would have the batch queue behind itself
 * for no gain, and would reintroduce exactly the interleaving that trap #7 in CLAUDE.md describes.
 */
export async function runBulk(
  caseIds: readonly string[],
  refs: Map<string, CaseRef>,
  each: (id: string, ref: CaseRef) => Promise<void>,
): Promise<BulkOutcome> {
  const failed: BulkFailure[] = [];
  let done = 0;
  for (const id of caseIds) {
    const ref = refs.get(id);
    if (!ref) {
      failed.push({ id, label: id, error: 'Row no longer exists' });
      continue;
    }
    try {
      await each(id, ref);
      done += 1;
    } catch (e) {
      failed.push({ id, label: labelFor(ref, id), error: messageOf(e) });
    }
  }
  return { done, failed };
}
