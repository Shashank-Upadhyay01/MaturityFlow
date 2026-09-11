import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import {
  branches,
  caseCounters,
  caseEvents,
  customers,
  maturityCases,
  payoutTransactions,
} from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth/session';
import { resolveImportBranch } from '@/lib/branch-routing';
import { accountKey, customerNameKey } from '@/lib/customer-identity';
import { formatCaseNumber, newId } from '@/lib/id';
import { parseRupeesToPaise } from '@/lib/money';
import { DEFAULT_CASH_CAP_PAISE } from '@/lib/org-settings';
import { formatDMY, parseISODate, todayISO } from '@/lib/working-days';
import { approvalDateProblem, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS } from '@/lib/payout-policy';
import type { RegisterRow } from '@/lib/excel-register';
import { approveAndScheduleInTx } from '@/services/case-service';
import { getBranchPolicy } from '@/services/calendar-service';
import { customersForAccount, findOrCreateRegisterAgent } from '@/services/customer-identity';
import { loadOrgSettings } from '@/services/org-settings';
import { ensureAllocatedLedgerInTx } from '@/services/payout-ledger';

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

/**
 * Import the branch register one row at a time.
 *
 * A workbook is operational input, so one malformed row must not roll back every good row in the
 * file. Each row gets a transaction with identity locks, a complete schedule, and an audited
 * historical-payment allocation. Re-importing the same row is idempotent by its customer/date/
 * amount identity and never creates a second customer or second receipt.
 */
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

  const [branch] = await db
    .select()
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.isActive, true)))
    .limit(1);
  if (!branch) throw new Error('Branch not found or inactive');
  const [policy, org] = await Promise.all([getBranchPolicy(branchId), loadOrgSettings()]);
  const cashCap = org.cashCapPaise > 0n ? org.cashCapPaise : DEFAULT_CASH_CAP_PAISE;

  for (const row of rows) {
    warnings.push(...row.warnings.map((warning) => `Row ${row.rowNumber}: ${warning}`));
    try {
      const outcome = await db.transaction(async (tx) => {
        const amount = paiseFromRow(row.maturityPaise, row.maturityRupees);
        const paid = paiseFromRow(row.paidPaise, row.paidRupees);
        const todayInput = paiseFromRow(row.todayPayablePaise, row.todayPayableRupees);
        if (amount <= 0n) throw new Error('Maturity amount must be greater than zero.');
        if (paid < 0n || paid > amount) throw new Error('Paid cannot exceed the maturity amount.');
        if (!Number.isInteger(row.windowDays) || row.windowDays < MIN_WINDOW_DAYS || row.windowDays > MAX_WINDOW_DAYS) {
          throw new Error(`Payment window must be between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS} days.`);
        }
        for (const date of [row.formSubmittedOn, row.instrumentMaturityOn, row.paymentOn, row.approvedOn]) {
          if (date) parseISODate(date);
        }

        const customerName = row.customerName.trim().replace(/\s+/g, ' ');
        if (customerName.length < 2) throw new Error('Customer name is required.');
        const agentId = await findOrCreateRegisterAgent(tx, branchId, row.agentName || 'Unassigned');
        const account = accountKey(row.accountNumber || '');
        let customerId: string;

        if (account) {
          const matches = await customersForAccount(tx, branchId, account);
          if (matches.length > 1) throw new Error(`Account ${account} is assigned to multiple customers in this branch.`);
          const existing = matches[0];
          if (existing) {
            if (customerNameKey(existing.name) !== customerNameKey(customerName)) {
              throw new Error(`Account ${account} already belongs to ${existing.name}; the imported customer name does not match.`);
            }
            if (existing.agentId && existing.agentId !== agentId) {
              throw new Error(`Account ${account} is assigned to another agent. Correct the account or agent before importing.`);
            }
            customerId = existing.id;
            if (!existing.agentId) {
              await tx.update(customers).set({ agentId, updatedAt: new Date() }).where(eq(customers.id, existing.id));
            }
          } else {
            customerId = newId('cus');
            await tx.insert(customers).values({
              id: customerId,
              name: customerName,
              accountNumber: account,
              branchId,
              agentId,
            });
          }
        } else {
          const nameKey = customerNameKey(customerName);
          const nameMatches = await tx
            .select()
            .from(customers)
            .where(and(
              eq(customers.branchId, branchId),
              sql`lower(regexp_replace(trim(${customers.name}), '[[:space:]]+', ' ', 'g')) = ${nameKey}`,
            ));
          if (nameMatches.length > 1) throw new Error(`Customer ${customerName} has duplicate account-less records in this branch.`);
          const existing = nameMatches[0];
          if (existing) {
            if (existing.agentId && existing.agentId !== agentId) throw new Error(`Customer ${customerName} is assigned to another agent.`);
            customerId = existing.id;
            if (!existing.agentId) await tx.update(customers).set({ agentId, updatedAt: new Date() }).where(eq(customers.id, existing.id));
          } else {
            customerId = newId('cus');
            await tx.insert(customers).values({
              id: customerId,
              name: customerName,
              accountNumber: null,
              branchId,
              agentId,
            });
          }
        }

        // Blank dates are accepted by the parser for the four-cell template. The form date is a
        // required database field, so use the supplied maturity or today and report the choice.
        const formSubmittedOn = row.formSubmittedOn ?? row.instrumentMaturityOn ?? todayISO();
        if (!row.formSubmittedOn) warnings.push(`Row ${row.rowNumber} (${customerName}): form-in date was blank — used ${formSubmittedOn}.`);
        const maturityOn = row.instrumentMaturityOn ?? formSubmittedOn;
        if (!row.instrumentMaturityOn) warnings.push(`Row ${row.rowNumber} (${customerName}): maturity date was blank — dated from ${maturityOn}.`);

        const duplicateConditions = [
          eq(maturityCases.branchId, branchId),
          eq(maturityCases.customerId, customerId),
          eq(maturityCases.formSubmittedOn, formSubmittedOn),
          eq(maturityCases.maturityAmountPaise, amount),
          eq(maturityCases.instrumentMaturityOn, maturityOn),
          row.paymentOn ? eq(maturityCases.paymentOn, row.paymentOn) : isNull(maturityCases.paymentOn),
        ];
        const [duplicate] = await tx
          .select({ id: maturityCases.id })
          .from(maturityCases)
          .where(and(...duplicateConditions))
          .limit(1);
        if (duplicate) return { skipped: true as const };

        const caseId = newId('case');
        const caseNumber = await nextCaseNumber(tx, branch.code, Number(formSubmittedOn.slice(0, 4)));
        const typedReview = row.approvedOn ?? null;
        const reviewProblem = typedReview
          ? approvalDateProblem(typedReview, formSubmittedOn, row.paymentOn ?? null)
          : null;
        if (typedReview && reviewProblem) {
          warnings.push(`Row ${row.rowNumber} (${customerName}): approval date ${formatDMY(typedReview)} is inconsistent with the form/payment dates; imported without the review mark.`);
        }
        const reviewOn = typedReview && !reviewProblem ? typedReview : null;
        await tx.insert(maturityCases).values({
          id: caseId,
          caseNumber,
          branchId,
          agentId,
          customerId,
          maturityAmountPaise: amount,
          instrumentMaturityOn: maturityOn,
          formSubmittedOn,
          paymentOn: row.paymentOn,
          opsReviewedOn: reviewOn,
          opsReviewedAt: reviewOn ? new Date() : null,
          opsReviewedById: reviewOn ? actor.id : null,
          submittedAt: new Date(`${formSubmittedOn}T10:00:00+05:30`),
          status: 'SUBMITTED',
          windowDays: row.windowDays,
          roundingPaise: branch.defaultRoundingPaise,
          distribution: 'FRONT_LOADED',
          cashPolicy: 'CASH_ONLY',
          cashCapPerDayPaise: null,
          startOnNextWorkingDay: false,
          createdById: actor.id,
        });
        await tx.insert(caseEvents).values([
          { id: newId('evt'), caseId, type: 'CREATED', toStatus: 'DRAFT', actorId: actor.id },
          { id: newId('evt'), caseId, type: 'SUBMITTED', fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: actor.id },
        ]);

        const [inserted] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).limit(1);
        if (!inserted) throw new Error('Imported case could not be read back.');
        /*
          An imported row can arrive carrying months of payments already made at the counter, and
          the days still to come must add up to what is LEFT, not to the amount the customer
          started with. Without this the schedule covers the full maturity a second time, and the
          allocator below then has to bury the already-paid money in days that have not happened
          yet - which is how a row imported on the 10th came back showing today already paid and
          refused the real payment when the customer turned up.

          A row that is settled in full keeps the old behaviour: there is nothing left to spread,
          and the schedule exists only for the ledger to hang the history on.
        */
        const remaining = amount - paid;
        const { anchor } = await approveAndScheduleInTx(
          tx,
          actor,
          inserted,
          policy.calendar,
          remaining > 0n ? remaining : undefined,
        );

        const todayAmount = todayInput > remaining ? remaining : todayInput;
        const cashToday = todayAmount < cashCap ? todayAmount : cashCap;
        await tx.update(maturityCases).set({
          todayApprovedPaise: todayAmount,
          todayCashPaise: cashToday,
          todayOnlinePaise: todayAmount - cashToday,
          updatedAt: new Date(),
        }).where(eq(maturityCases.id, caseId));

        if (paid > 0n) {
          const valueDate = row.paymentOn ?? formSubmittedOn;
          await tx.insert(payoutTransactions).values({
            id: newId('txn'),
            caseId,
            instalmentId: null,
            branchId,
            cashPaise: paid,
            onlinePaise: 0n,
            totalPaise: paid,
            remarks: 'Imported paid amount from previous register',
            valueDate,
            recordedById: actor.id,
          });
          await tx.update(maturityCases).set({
            paidCashPaise: paid,
            paidOnlinePaise: 0n,
            status: paid === amount ? 'COMPLETED' : 'IN_PROGRESS',
            completedAt: paid === amount ? new Date() : null,
            updatedAt: new Date(),
          }).where(eq(maturityCases.id, caseId));
        }

        const [locked] = await tx.select().from(maturityCases).where(eq(maturityCases.id, caseId)).for('update').limit(1);
        if (!locked) throw new Error('Imported case disappeared before ledger allocation.');
        if (paid > 0n) await ensureAllocatedLedgerInTx(tx, actor, locked, meta);

        await writeAudit(tx, actor, {
          action: 'data.imported',
          entity: 'MaturityCase',
          entityId: caseId,
          branchId,
          summary: `${caseNumber}: imported register row for ${customerName}`,
          after: { maturityAmountPaise: amount, paidPaise: paid, todayPaise: todayAmount, paymentOn: row.paymentOn, anchor },
          ...meta,
        });
        return { skipped: false as const };
      });

      if (outcome.skipped) {
        skipped += 1;
        warnings.push(`Row ${row.rowNumber}: already imported, skipped.`);
      } else {
        created += 1;
      }
    } catch (cause) {
      skipped += 1;
      errors.push(`Row ${row.rowNumber} (${row.customerName}): ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  await db.transaction(async (tx) => {
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
    branches: [{ branchId, branchCode: branch.code, branchName: branch.name, created, skipped }],
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
      errors.push(`Row ${row.rowNumber} (${row.customerName}): branch “${supplied}” was not recognised; row skipped.`);
      skipped += 1;
      continue;
    }
    const list = grouped.get(branch.id) ?? [];
    list.push(row);
    grouped.set(branch.id, list);
  }

  const result: ImportResult = { created: 0, skipped, warnings: [], errors, branches: [] };
  for (const branch of branchRows) {
    const branchRowsInput = grouped.get(branch.id);
    if (!branchRowsInput?.length) continue;
    const imported = await importRegisterRows(actor, branch.id, branchRowsInput, meta);
    result.created += imported.created;
    result.skipped += imported.skipped;
    result.warnings.push(...imported.warnings);
    result.errors.push(...imported.errors);
    result.branches.push(...imported.branches);
  }
  return result;
}

function paiseFromRupeesNumber(n: number): bigint {
  if (!Number.isFinite(n) || n < 0) throw new Error('Spreadsheet money must be a non-negative amount.');
  return parseRupeesToPaise(n.toFixed(2));
}

function paiseFromRow(exact: string | undefined, fallback: number): bigint {
  if (exact != null && exact !== '') {
    try {
      const p = BigInt(exact);
      if (p < 0n) throw new Error('Spreadsheet money must be a non-negative amount.');
      return p;
    } catch {
      throw new Error('Spreadsheet money value is not a valid paise amount.');
    }
  }
  return paiseFromRupeesNumber(fallback);
}
