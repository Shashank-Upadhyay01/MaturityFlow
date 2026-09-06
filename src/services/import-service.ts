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
import { addDays, formatDMY, todayISO } from '@/lib/working-days';
import { approvalDateProblem, APPROVAL_LEAD_CALENDAR_DAYS } from '@/lib/payout-policy';
import type { RegisterRow } from '@/lib/excel-register';
import { approveAndScheduleInTx } from '@/services/case-service';
import { getBranchPolicy } from '@/services/calendar-service';
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
    const policy = await getBranchPolicy(branchId, tx);

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
      /*
        A maturity date is required to work out where the schedule starts, and the branch is only
        asked to type four columns — so a blank one falls back to the form date rather than
        refusing the row. Said out loud in the warnings, because it is a date nobody supplied.
      */
      const maturityOn = row.instrumentMaturityOn ?? formSubmittedOn;
      if (!row.instrumentMaturityOn) {
        warnings.push(
          `Row ${row.rowNumber} (${row.customerName}): maturity date was blank — dated from ${maturityOn}.`,
        );
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
        instrumentMaturityOn: maturityOn,
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

      /*
        Schedule the case here, in the transaction that created it.

        Imported rows used to arrive with no instalments at all, so every derived column on the
        register read zero until somebody remembered to run the backfill script by hand. The
        branch types four cells; the register owes them the other ten the moment the file lands.

        `approveAndScheduleInTx` anchors on the maturity date plus three calendar days, rolled
        onto the next open day, and `payoutPlanFor` splits by amount — twelve daily payouts at
        ₹1 lakh and over, six on alternate days below it. A row that cannot be scheduled is
        reported and left as it was rather than losing the whole file.
      */
      if (remaining > 0n) {
        try {
          const [inserted] = await tx
            .select()
            .from(maturityCases)
            .where(eq(maturityCases.id, caseId))
            .limit(1);
          if (inserted) {
            /*
              `remaining`, not the maturity amount.

              An imported row can arrive with months of counter payments already against it - the
              Paid column - and the days still to come have to add up to what is left. Passing the
              full amount put a case that was all but settled back on the register asking for the
              whole sum a second time: a customer owed 5,795 was scheduled for twelve more days of
              14,000. The cadence is still taken from the maturity amount inside, because the band
              belongs to the deposit rather than to the balance.
            */
            const { anchor } = await approveAndScheduleInTx(
              tx,
              actor,
              inserted,
              policy.calendar,
              remaining,
            );
            const paymentOn = row.paymentOn ?? anchor;

            /*
              The Approval Date the branch typed, checked against the same two rules the register
              enforces when somebody edits that cell by hand: an approval cannot precede the form
              that asked for it, and it cannot fall after the day the counter starts paying.

              A date breaking either rule used to be replaced by null with nothing said, so a
              swapped month or a mistyped year quietly erased the column and the branch found out
              weeks later. It is reported now. The cell is still left empty - storing a date that
              contradicts the payment date would only move the contradiction into the register -
              but the row says so on the import report, naming both dates, so it can be corrected
              in the sheet and imported again, or simply typed on the register.

              With no Approval Date typed at all the default stands: form date plus three days. It
              is only ever a default until somebody holding `case.approve` confirms it, so
              `opsReviewedAt` and `opsReviewedById` stay empty either way.
            */
            const typedReview = row.approvedOn ?? null;
            const reviewOn = typedReview ?? addDays(formSubmittedOn, APPROVAL_LEAD_CALENDAR_DAYS);
            const problem = approvalDateProblem(reviewOn, formSubmittedOn, paymentOn);
            if (typedReview && problem) {
              warnings.push(
                `Row ${row.rowNumber} (${row.customerName}): approval date ${formatDMY(typedReview)} ` +
                  (problem === 'BEFORE_FORM'
                    ? `is before the form submission date ${formatDMY(formSubmittedOn)}`
                    : `is after the payment date ${formatDMY(paymentOn)}`) +
                  ' - imported with the approval column left blank. Correct the sheet and import ' +
                  'the row again, or type the date on the register.',
              );
            }

            await tx
              .update(maturityCases)
              .set({
                paymentOn,
                opsReviewedOn: problem ? null : reviewOn,
                updatedAt: new Date(),
              })
              .where(eq(maturityCases.id, caseId));
          }
        } catch (cause) {
          warnings.push(
            `Row ${row.rowNumber} (${row.customerName}): imported, but could not be scheduled — ` +
              `${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }

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
