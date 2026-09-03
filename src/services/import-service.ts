import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import {
  agents,
  caseEvents,
  customers,
  maturityCases,
  payoutTransactions,
} from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { resolveImportBranch } from '@/lib/branch-routing';
import { formatCaseNumber, newId } from '@/lib/id';
import { parseRupeesToPaise } from '@/lib/money';
import { todayISO } from '@/lib/working-days';
import type { RegisterRow } from '@/lib/excel-register';
import { sql } from 'drizzle-orm';
import { caseCounters, branches } from '@/db/schema';

export interface ImportResult {
  created: number;
  skipped: number;
  warnings: string[];
  errors: string[];
  branches: ImportBranchResult[];
}

export interface ImportBranchResult {
  branchId: string;
  branchCode: string;
  branchName: string;
  created: number;
  skipped: number;
}

async function nextCaseNumber(tx: Queryable, branchCode: string, year: number): Promise<string> {
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

export async function importRegisterRows(
  actor: Pick<SessionUser, 'id' | 'name' | 'role'>,
  branchId: string,
  rows: RegisterRow[],
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let created = 0;
  let skipped = 0;
  let importedBranchCode = branchId;
  let importedBranchName = 'Branch';

  await db.transaction(async (tx) => {
    const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
    if (!branch) throw new Error('Branch not found');
    importedBranchCode = branch.code;
    importedBranchName = branch.name;

    const agentByKey = new Map<string, string>();
    const existingAgents = await tx.select().from(agents).where(eq(agents.branchId, branchId));
    for (const a of existingAgents) agentByKey.set(a.name.trim().toLowerCase(), a.id);

    let agentSeq = existingAgents.length;
    async function agentIdFor(name: string): Promise<string> {
      const key = name.trim().toLowerCase();
      const hit = agentByKey.get(key);
      if (hit) return hit;
      agentSeq += 1;
      const id = newId('agt');
      await tx.insert(agents).values({
        id,
        code: `AG${String(agentSeq).padStart(3, '0')}`,
        name: name.trim(),
        branchId,
      });
      agentByKey.set(key, id);
      return id;
    }

    for (const row of rows) {
      warnings.push(...row.warnings.map((w) => `Row ${row.rowNumber}: ${w}`));
      if (row.maturityRupees <= 0) {
        errors.push(`Row ${row.rowNumber} (${row.customerName}): amount must be greater than zero.`);
        skipped += 1;
        continue;
      }

      const agentId = await agentIdFor(row.agentName);
      let customerId: string;
      if (row.accountNumber) {
        const [found] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.branchId, branchId), eq(customers.accountNumber, row.accountNumber)))
          .limit(1);
        if (found) customerId = found.id;
        else {
          customerId = newId('cus');
          await tx.insert(customers).values({
            id: customerId,
            name: row.customerName,
            accountNumber: row.accountNumber,
            branchId,
            agentId,
          });
        }
      } else {
        customerId = newId('cus');
        await tx.insert(customers).values({
          id: customerId,
          name: row.customerName,
          branchId,
          agentId,
        });
      }

      const formSubmittedOn = row.formSubmittedOn ?? row.instrumentMaturityOn ?? todayISO();
      if (!row.formSubmittedOn) {
        warnings.push(`Row ${row.rowNumber} (${row.customerName}): form-in date was blank — used ${formSubmittedOn}.`);
      }
      if (!row.instrumentMaturityOn) {
        warnings.push(`Row ${row.rowNumber} (${row.customerName}): maturity date was blank.`);
      }

      const dup = await tx
        .select({ id: maturityCases.id })
        .from(maturityCases)
        .where(
          and(
            eq(maturityCases.customerId, customerId),
            eq(maturityCases.formSubmittedOn, formSubmittedOn),
            eq(maturityCases.maturityAmountPaise, paiseFromRupeesNumber(row.maturityRupees)),
          ),
        )
        .limit(1);
      if (dup[0]) {
        skipped += 1;
        warnings.push(`Row ${row.rowNumber}: already imported, skipped.`);
        continue;
      }

      const amount = paiseFromRupeesNumber(row.maturityRupees);
      const paid = paiseFromRupeesNumber(row.paidRupees);
      const year = Number(formSubmittedOn.slice(0, 4));
      const caseNumber = await nextCaseNumber(tx, branch.code, year);
      const caseId = newId('case');
      const approvedOn = row.paymentOn && row.paymentOn >= formSubmittedOn ? row.paymentOn : formSubmittedOn;

      await tx.insert(maturityCases).values({
        id: caseId,
        caseNumber,
        branchId,
        agentId,
        customerId,
        maturityAmountPaise: amount,
        instrumentMaturityOn: row.instrumentMaturityOn,
        formSubmittedOn,
        paymentOn: row.paymentOn,
        submittedAt: new Date(`${formSubmittedOn}T10:00:00+05:30`),
        status: 'SUBMITTED',
        windowDays: row.windowDays,
        roundingPaise: branch.defaultRoundingPaise,
        distribution: 'FRONT_LOADED',
        cashPolicy: 'CASH_ONLY',
        cashCapPerDayPaise: null,
        startOnNextWorkingDay: false,
        todayApprovedPaise: 0n,
        createdById: actor.id,
      });
      await tx.insert(caseEvents).values({
        id: newId('evt'),
        caseId,
        type: 'CREATED',
        toStatus: 'DRAFT',
        actorId: actor.id,
      });
      await tx.insert(caseEvents).values({
        id: newId('evt'),
        caseId,
        type: 'SUBMITTED',
        fromStatus: 'DRAFT',
        toStatus: 'SUBMITTED',
        actorId: actor.id,
      });

      const remaining = amount - paid;
      const todayCap = paiseFromRupeesNumber(row.todayPayableRupees);
      const todayAmt = remaining > 0n ? (todayCap > remaining ? remaining : todayCap) : 0n;
      const cap = parseRupeesToPaise('25000');
      const recCash = todayAmt < cap ? todayAmt : cap;
      await tx
        .update(maturityCases)
        .set({
          paidCashPaise: paid,
          paidOnlinePaise: 0n,
          todayApprovedPaise: todayAmt,
          todayCashPaise: recCash,
          todayOnlinePaise: todayAmt - recCash,
          approvedOn: remaining <= 0n ? approvedOn : null,
          status: remaining <= 0n ? 'COMPLETED' : 'SUBMITTED',
          completedAt: remaining <= 0n ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(maturityCases.id, caseId));

      if (paid > 0n) {
        await tx.insert(payoutTransactions).values({
          id: newId('txn'),
          caseId,
          instalmentId: null,
          branchId,
          cashPaise: paid,
          onlinePaise: 0n,
          totalPaise: paid,
          remarks: 'Imported paid amount from previous register',
          valueDate: approvedOn,
          recordedById: actor.id,
        });
      }

      created += 1;
    }

    await writeAudit(tx, actor, {
      action: 'data.imported',
      entity: 'MaturityCase',
      entityId: branchId,
      branchId,
      summary: `Imported ${created} cases from Excel (${skipped} skipped)`,
      ...meta,
    });
  });

  return {
    created,
    skipped,
    warnings,
    errors,
    branches: [
      {
        branchId,
        branchCode: importedBranchCode,
        branchName: importedBranchName,
        created,
        skipped,
      },
    ],
  };
}

/** Route one compiled workbook by exact Branch Code/Branch Name, then audit each branch import. */
export async function importCompiledRegisterRows(
  actor: Pick<SessionUser, 'id' | 'name' | 'role'>,
  rows: RegisterRow[],
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ImportResult> {
  const branchRows = await db
    .select({ id: branches.id, code: branches.code, name: branches.name })
    .from(branches)
    .where(eq(branches.isActive, true));

  const grouped = new Map<string, RegisterRow[]>();
  const errors: string[] = [];
  let skipped = 0;

  for (const row of rows) {
    const branch = resolveImportBranch(row.branchReference, branchRows);
    if (!branch) {
      const supplied = row.branchReference || 'blank';
      errors.push(
        `Row ${row.rowNumber} (${row.customerName}): branch “${supplied}” was not recognised; row skipped.`,
      );
      skipped += 1;
      continue;
    }
    const list = grouped.get(branch.id) ?? [];
    list.push(row);
    grouped.set(branch.id, list);
  }

  const result: ImportResult = {
    created: 0,
    skipped,
    warnings: [],
    errors,
    branches: [],
  };

  for (const branch of branchRows) {
    const branchInput = grouped.get(branch.id);
    if (!branchInput?.length) continue;
    const imported = await importRegisterRows(actor, branch.id, branchInput, meta);
    result.created += imported.created;
    result.skipped += imported.skipped;
    result.warnings.push(...imported.warnings);
    result.errors.push(...imported.errors);
    result.branches.push(...imported.branches);
  }

  return result;
}

function paiseFromRupeesNumber(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return parseRupeesToPaise(n.toFixed(2));
}
