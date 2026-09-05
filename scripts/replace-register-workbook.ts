/**
 * Replace one live register cohort from an operational Excel workbook.
 *
 * Dry-run (default):
 *   npx tsx --conditions=react-server scripts/replace-register-workbook.ts "C:\path\register.xlsx" --branch=AZM
 *
 * Apply after taking a database backup:
 *   npx tsx --conditions=react-server scripts/replace-register-workbook.ts "C:\path\register.xlsx" --branch=AZM --apply
 *
 * Replacement scope is deliberately narrow: active cases whose maturity date AND payment date
 * occur in the supplied workbook. Users, branches, settings, cashbooks, audit rows and unrelated
 * forecast months are never touched. Existing cases are cancelled through the audited service;
 * they are not deleted.
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import ExcelJS from 'exceljs';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import { db, pool } from '../src/db';
import {
  agents,
  branches,
  customers,
  maturityCases,
  payoutTransactions,
  users,
} from '../src/db/schema';
import { writeAudit } from '../src/lib/audit';
import { toActor, type SessionUser } from '../src/lib/auth/session';
import { excelCellRaw, parseRegisterDate, parseRupeesNumber } from '../src/lib/excel-register';
import { newId } from '../src/lib/id';
import { AUGUST_2026_WINDOW_DAYS } from '../src/lib/maturity-payment-plan';
import { parseRupeesToPaise } from '../src/lib/money';
import { assertCan } from '../src/lib/rbac';
import type { ISODate } from '../src/lib/working-days';
import { cancelCase, createCase } from '../src/services/case-service';
import { importMaturityForecast } from '../src/services/forecast-service';
import { loadOrgSettings } from '../src/services/org-settings';
import { updateRegisterRow } from '../src/services/register-service';

interface OperationalRow {
  rowNumber: number;
  accountNumber: string;
  customerName: string;
  maturityOn: ISODate;
  formSubmittedOn: ISODate;
  paymentOn: ISODate;
  maturityPaise: bigint;
  paidPaise: bigint;
  duePaise: bigint;
  maturityRupees: number;
  agentName: string;
  sourceSheet: string;
}

const fileArg = process.argv[2];
if (!fileArg || fileArg.startsWith('--')) {
  throw new Error('Usage: npx tsx scripts/replace-register-workbook.ts <file.xlsx> [--branch=AZM] [--apply]');
}
const workbookPath = resolve(fileArg);
const workbookName = basename(workbookPath);
const branchCode = (process.argv.find((arg) => arg.startsWith('--branch='))?.slice(9) ?? 'AZM')
  .trim()
  .toUpperCase();
const apply = process.argv.includes('--apply');

function key(value: unknown): string {
  return String(excelCellRaw(value) ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findHeader(headers: unknown[], aliases: string[]): number {
  const accepted = new Set(aliases.map(key));
  return headers.findIndex((header) => accepted.has(key(header)));
}

function accountText(value: unknown): string {
  const raw = excelCellRaw(value);
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(Math.round(raw));
  return String(raw ?? '').trim();
}

function paise(value: unknown): bigint {
  const rupees = parseRupeesNumber(excelCellRaw(value));
  if (!Number.isFinite(rupees)) return 0n;
  return parseRupeesToPaise(rupees.toFixed(2));
}

function requireDate(value: unknown, label: string, rowNumber: number): ISODate {
  // These cells are genuine Excel dates. Do not apply the legacy US-stored-date correction to
  // their ISO representation: 2026-09-01 means 1 September, not 9 January.
  const parsed = parseRegisterDate(excelCellRaw(value));
  if (!parsed) throw new Error(`Row ${rowNumber}: invalid ${label}.`);
  return parsed;
}

async function parseWorkbook(): Promise<OperationalRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);
  const rows: OperationalRow[] = [];
  const seenAccounts = new Set<string>();

  for (const sheet of workbook.worksheets) {
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const indexes = {
      account: findHeader(headers, ['SB A/C', 'Account Number', 'Account No', 'Savings Account Number']),
      customer: findHeader(headers, ['Name', 'Customer Name']),
      maturity: findHeader(headers, ['Maturity Date', 'Date of Maturity']),
      submitted: findHeader(headers, ['Submitted Date', 'Submission Date', 'Form Submission Date']),
      payment: findHeader(headers, ['Payment Date']),
      amount: findHeader(headers, ['Maturity Amount']),
      paid: findHeader(headers, ['Paid Maturity', 'Paid Amount']),
      due: findHeader(headers, ['Due Amount', 'Due Amout', 'Remaining Amount']),
      agent: findHeader(headers, ['Agent Name', "Customer's Agent Name"]),
    };
    const missing = Object.entries(indexes).filter(([, index]) => index < 0).map(([name]) => name);
    if (missing.length > 0) throw new Error(`${sheet.name}: missing required columns: ${missing.join(', ')}.`);

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const values = (sheet.getRow(rowNumber).values as unknown[]).slice(1);
      const customerName = String(excelCellRaw(values[indexes.customer]) ?? '').trim();
      if (!customerName) continue;
      const accountNumber = accountText(values[indexes.account]);
      const agentName = String(excelCellRaw(values[indexes.agent]) ?? '').trim();
      if (!accountNumber) throw new Error(`${sheet.name} row ${rowNumber}: account number is required.`);
      if (!agentName) throw new Error(`${sheet.name} row ${rowNumber}: agent name is required.`);
      if (seenAccounts.has(accountNumber)) throw new Error(`Account ${accountNumber} occurs more than once.`);
      seenAccounts.add(accountNumber);

      const maturityOn = requireDate(values[indexes.maturity], 'maturity date', rowNumber);
      const formSubmittedOn = requireDate(values[indexes.submitted], 'submitted date', rowNumber);
      const paymentOn = requireDate(values[indexes.payment], 'payment date', rowNumber);
      if (formSubmittedOn < maturityOn) throw new Error(`Row ${rowNumber}: submitted date is before maturity date.`);
      if (paymentOn < formSubmittedOn) throw new Error(`Row ${rowNumber}: payment date is before submitted date.`);

      const maturityPaise = paise(values[indexes.amount]);
      const paidPaise = paise(values[indexes.paid]);
      const duePaise = paise(values[indexes.due]);
      if (maturityPaise <= 0n) throw new Error(`Row ${rowNumber}: maturity amount must be positive.`);
      if (paidPaise < 0n || paidPaise > maturityPaise) throw new Error(`Row ${rowNumber}: paid amount is invalid.`);
      if (duePaise !== maturityPaise - paidPaise) {
        throw new Error(`Row ${rowNumber}: due amount does not equal maturity amount minus paid amount.`);
      }

      rows.push({
        rowNumber,
        accountNumber,
        customerName,
        maturityOn,
        formSubmittedOn,
        paymentOn,
        maturityPaise,
        paidPaise,
        duePaise,
        maturityRupees: Number(maturityPaise) / 100,
        agentName,
        sourceSheet: sheet.name,
      });
    }
  }
  if (rows.length === 0) throw new Error('No operational register rows were found.');
  return rows;
}

function importedAgentCode(code: string, name: string): string {
  const suffix = createHash('sha256').update(`${code}|${name.trim().toLowerCase()}`).digest('hex').slice(0, 10).toUpperCase();
  return `I-${code}-${suffix}`;
}

async function ensureAgent(actor: SessionUser, branchId: string, code: string, name: string): Promise<string> {
  const [existing] = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.branchId, branchId), eq(agents.name, name))).limit(1);
  if (existing) return existing.id;
  return db.transaction(async (tx) => {
    const id = newId('agt');
    const agentCode = importedAgentCode(code, name);
    await tx.insert(agents).values({ id, code: agentCode, name, branchId });
    await writeAudit(tx, actor, {
      action: 'agent.created', entity: 'Agent', entityId: id, branchId,
      summary: `Register replacement added agent: ${name} (${agentCode})`,
      userAgent: 'operator-script/replace-register-workbook',
    });
    return id;
  });
}

async function ensureCustomer(
  actor: SessionUser,
  branchId: string,
  agentId: string,
  row: OperationalRow,
): Promise<string> {
  const [existing] = await db.select().from(customers)
    .where(and(eq(customers.branchId, branchId), eq(customers.accountNumber, row.accountNumber))).limit(1);
  if (existing) {
    if (existing.name === row.customerName && existing.agentId === agentId) return existing.id;
    await db.transaction(async (tx) => {
      await tx.update(customers).set({ name: row.customerName, agentId, updatedAt: new Date() })
        .where(eq(customers.id, existing.id));
      await writeAudit(tx, actor, {
        action: 'customer.updated', entity: 'Customer', entityId: existing.id, branchId,
        summary: `Register replacement updated customer ${row.accountNumber}: ${row.customerName}`,
        before: { name: existing.name, agentId: existing.agentId },
        after: { name: row.customerName, agentId },
        userAgent: 'operator-script/replace-register-workbook',
      });
    });
    return existing.id;
  }

  return db.transaction(async (tx) => {
    const id = newId('cus');
    await tx.insert(customers).values({
      id, name: row.customerName, accountNumber: row.accountNumber, branchId, agentId,
    });
    await writeAudit(tx, actor, {
      action: 'customer.created', entity: 'Customer', entityId: id, branchId,
      summary: `Register replacement added customer ${row.accountNumber}: ${row.customerName}`,
      userAgent: 'operator-script/replace-register-workbook',
    });
    return id;
  });
}

async function main() {
  const rows = await parseWorkbook();
  const sourceSha256 = createHash('sha256').update(await readFile(workbookPath)).digest('hex');
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.code, branchCode), eq(branches.isActive, true))).limit(1);
  if (!branch) throw new Error(`Active branch ${branchCode} was not found.`);
  const [admin] = await db.select().from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt))).limit(1);
  if (!admin) throw new Error('No active Admin account was found for the audit trail.');
  const actor = {
    id: admin.id, email: admin.email, name: admin.name, role: admin.role,
    branchId: admin.branchId, agentId: null,
  } as SessionUser;
  const auth = toActor(actor);
  for (const permission of ['data.import', 'agent.manage', 'customer.manage', 'case.create', 'case.submit', 'case.cancel'] as const) {
    assertCan(auth, permission, { branchId: branch.id });
  }

  const maturityDates = [...new Set(rows.map((row) => row.maturityOn))];
  const paymentDates = [...new Set(rows.map((row) => row.paymentOn))];
  const replacementPairs = new Set(rows.map((row) => `${row.maturityOn}|${row.paymentOn}`));
  const candidates = await db.select({
    id: maturityCases.id,
    caseNumber: maturityCases.caseNumber,
    instrumentMaturityOn: maturityCases.instrumentMaturityOn,
    paymentOn: maturityCases.paymentOn,
    paidCashPaise: maturityCases.paidCashPaise,
    paidOnlinePaise: maturityCases.paidOnlinePaise,
    notes: maturityCases.notes,
  }).from(maturityCases).where(and(
    eq(maturityCases.branchId, branch.id),
    inArray(maturityCases.instrumentMaturityOn, maturityDates),
    inArray(maturityCases.paymentOn, paymentDates),
    notInArray(maturityCases.status, ['CANCELLED', 'REJECTED']),
  ));
  const existing = candidates.filter((row) =>
    replacementPairs.has(`${row.instrumentMaturityOn}|${row.paymentOn}`),
  );

  const totalPaise = rows.reduce((sum, row) => sum + row.maturityPaise, 0n);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run', workbook: workbookName, sourceSha256, branch: branch.code,
    records: rows.length, totalPaise: totalPaise.toString(), maturityDates, paymentDates,
    existingCasesToReplace: existing.length,
  }, null, 2));
  if (!apply) return;

  const importedPaidRows = rows.filter((row) => row.paidPaise > 0n);
  if (importedPaidRows.length > 0) {
    throw new Error(
      `Refusing replacement: ${importedPaidRows.length} workbook row(s) contain prior payouts. ` +
      'Those payments must be imported through the audited payout ledger.',
    );
  }

  if (existing.length === rows.length && existing.every((row) => row.notes?.includes(sourceSha256))) {
    console.log('This exact workbook is already active; no changes were made.');
    return;
  }
  const paidExisting = existing.filter((row) => row.paidCashPaise + row.paidOnlinePaise > 0n);
  if (paidExisting.length > 0) {
    throw new Error(`Refusing replacement: ${paidExisting.length} existing case(s) already have payouts.`);
  }

  const forecast = await importMaturityForecast(
    actor,
    branch.id,
    workbookName,
    rows.map((row) => ({
      accountNumber: row.accountNumber,
      customerName: row.customerName,
      agentName: row.agentName,
      planRupees: 0,
      totalDepositRupees: 0,
      joinedOn: null,
      maturityOn: row.maturityOn,
      productName: '',
      planName: '',
      actualMaturityRupees: row.maturityRupees,
      currentMaturityRupees: row.maturityRupees,
      tenureMonths: null,
      interestRateBps: null,
      sourceSheet: row.sourceSheet,
      sourceRow: row.rowNumber,
    })),
    { userAgent: 'operator-script/replace-register-workbook' },
  );

  for (const row of existing) {
    await cancelCase(actor, row.id, `Superseded by ${workbookName} (${sourceSha256}).`, {
      userAgent: 'operator-script/replace-register-workbook',
    });
  }

  const org = await loadOrgSettings();
  const created: string[] = [];
  for (const row of rows) {
    const agentId = await ensureAgent(actor, branch.id, branch.code, row.agentName);
    const customerId = await ensureCustomer(actor, branch.id, agentId, row);
    const specialAugustWindow = row.maturityOn.startsWith('2026-08') && row.paymentOn === '2026-09-01';
    const outcome = await createCase(actor, {
      branchId: branch.id,
      agentId,
      customerId,
      maturityAmountPaise: row.maturityPaise,
      formSubmittedOn: row.formSubmittedOn,
      instrumentMaturityOn: row.maturityOn,
      policyNumber: row.accountNumber,
      windowDays: specialAugustWindow ? AUGUST_2026_WINDOW_DAYS : branch.defaultWindowDays,
      roundingPaise: branch.defaultRoundingPaise,
      distribution: 'FRONT_LOADED',
      cashPolicy: 'CASH_CAP',
      cashCapPerDayPaise: org.cashCapPaise,
      startOnNextWorkingDay: false,
      notes: `Imported from ${workbookName} row ${row.rowNumber}; sourceSha256:${sourceSha256}`,
      submitNow: true,
    }, { userAgent: 'operator-script/replace-register-workbook' });
    await updateRegisterRow(actor, outcome.id, { paymentOn: row.paymentOn });
    created.push(outcome.id);
  }

  const payments = await db.select({ caseId: payoutTransactions.caseId }).from(payoutTransactions)
    .where(inArray(payoutTransactions.caseId, created));
  if (payments.length !== 0) throw new Error('Replacement unexpectedly created payout transactions.');

  await db.transaction(async (tx) => {
    await writeAudit(tx, actor, {
      action: 'data.imported', entity: 'MaturityCase', entityId: branch.id, branchId: branch.id,
      summary: `${workbookName} replaced ${existing.length} active cases with ${created.length} audited cases`,
      before: { activeCases: existing.length },
      after: { activeCases: created.length, totalPaise: totalPaise.toString(), sourceSha256, forecast },
      userAgent: 'operator-script/replace-register-workbook',
    });
  });

  console.log(JSON.stringify({ cancelled: existing.length, created: created.length, forecast }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
