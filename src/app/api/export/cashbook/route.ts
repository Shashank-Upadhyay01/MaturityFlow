import { NextResponse } from 'next/server';

import { db } from '@/db';
import { writeAudit } from '@/lib/audit';
import { requireActor } from '@/lib/auth/session';
import { PRODUCT_NAME } from '@/lib/brand';
import {
  CASHBOOK_CATEGORY_META,
  CASHBOOK_COMMITMENT_META,
  CASHBOOK_DENOMINATIONS,
} from '@/lib/daily-cashbook';
import { paiseToDecimalString } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { parseISODate, todayISO } from '@/lib/working-days';
import { getCashbookDay } from '@/services/queries';

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function money(value: bigint): string {
  return paiseToDecimalString(value);
}

function safeDate(value: string | null): string {
  const date = value ?? todayISO();
  parseISODate(date);
  return date;
}

export async function GET(request: Request) {
  try {
    const { session, actor } = await requireActor();
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId')?.trim();
    if (!branchId) return NextResponse.json({ error: 'Choose a branch.' }, { status: 400 });
    const date = safeDate(url.searchParams.get('date'));
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

    assertCan(actor, 'cashbook.view', { branchId });
    assertCan(actor, 'report.export', { branchId });
    const view = await getCashbookDay(actor, branchId, date);
    if (!view) return NextResponse.json({ error: 'Cashbook not found.' }, { status: 404 });

    const t = view.totals;
    const summary: (string | number)[][] = [
      ['Field', 'Value'],
      ['Business date', view.date],
      ['Branch code', view.branch.code],
      ['Branch name', view.branch.name],
      ['Status', view.day?.status ?? 'NOT_STARTED'],
      ['Close revision', view.day?.closeRevision ?? 0],
      ['Receiving (cash)', money(t.receivingPaise)],
      ['Old portal total', money(view.figures.oldPortalTotalPaise)],
      ['New loan', money(t.byCategory.NEW_LOAN)],
      ['Savings deposit', money(t.byCategory.SAVINGS_DEPOSIT)],
      ['Opening balance', money(t.openingBalancePaise)],
      ['TOTAL AMOUNT', money(t.totalAmountPaise)],
      ['By account', money(t.byAccountPaise)],
      ['Withdrawals', money(t.byCategory.WITHDRAWAL)],
      ['Expenses', money(t.byCategory.EXPENSE)],
      ['EXPECTED PHYSICAL CASH', money(t.expectedPhysicalCashPaise)],
      ['CASH IN HAND', money(t.countedCashPaise)],
      ['CASH DIFFERENCE (counted - expected)', money(t.cashDifferencePaise)],
      ['Reconciliation', t.state],
      ['Renewal', money(t.byCategory.RENEWAL)],
      ['Fixed deposit', money(view.figures.fixedDepositPaise)],
      ['New business', money(view.figures.newBusinessPaise)],
      ['Membership', money(view.figures.membershipCollectionPaise)],
      ['Old loan', money(view.figures.oldLoanPaise)],
      ['Portal breakdown', money(t.portalBreakdownPaise)],
      ['Portal variance', money(t.portalVariancePaise)],
      ['Given cash opened today', money(t.givenCashPaise)],
      ['Due amount opened today', money(t.dueAmountPaise)],
      ['Pending withdrawal opened today', money(t.pendingWithdrawalPaise)],
      ['Given cash outstanding', money(view.commitmentTotals.GIVEN_CASH.outstandingPaise)],
      ['Due amount outstanding', money(view.commitmentTotals.DUE_AMOUNT.outstandingPaise)],
      ['Pending withdrawal outstanding', money(view.commitmentTotals.PENDING_WITHDRAWAL.outstandingPaise)],
      ['Planned opening', money(view.plannedOpeningPaise)],
      ['Opening vs plan', money(view.openingVsPlanPaise)],
      ['Payout Desk cash', money(view.payoutComparison.payoutCashPaise)],
      ['Withdrawal vs Payout Desk', money(view.payoutComparison.withdrawalVsPayoutCashPaise)],
      ['Day note', view.day?.notes ?? ''],
    ];

    const entries: (string | number)[][] = [
      ['Category', 'Channel', 'Amount (rupees)', 'Person / customer', 'Reference', 'Note', 'Entered at'],
      ...view.entries.map((row) => [
        CASHBOOK_CATEGORY_META[row.category].label,
        row.channel === 'CASH' ? 'Cash' : 'By account',
        money(row.amountPaise),
        row.partyName ?? '',
        row.reference ?? '',
        row.note ?? '',
        row.createdAt.toISOString(),
      ]),
    ];

    const namedById = new Map(
      [...view.currentCommitments, ...view.carriedCommitments].map((row) => [row.id, row]),
    );
    const named: (string | number)[][] = [
      ['Source date', 'Carried', 'Type', 'Person / customer', 'Amount (rupees)', 'Due date', 'Status', 'Reference', 'Note'],
      ...[...namedById.values()].map((row) => [
        row.sourceDate,
        row.carried ? 'Yes' : 'No',
        CASHBOOK_COMMITMENT_META[row.kind].label,
        row.partyName,
        money(row.amountPaise),
        row.dueOn ?? '',
        row.settledAt ? 'Settled' : 'Outstanding',
        row.reference ?? '',
        row.note ?? '',
      ]),
    ];

    const denominations: (string | number)[][] = [
      ['Denomination', 'Count', 'Value (rupees)'],
      ...CASHBOOK_DENOMINATIONS.map((denomination) => [
        denomination.label,
        view.figures[denomination.field],
        money(BigInt(view.figures[denomination.field]) * denomination.paise),
      ]),
      ['Coins (aggregate value)', '', money(view.figures.coinsPaise)],
      ['CASH IN HAND', '', money(t.countedCashPaise)],
    ];

    await writeAudit(db, session, {
      action: 'report.exported',
      entity: 'CashbookDay',
      entityId: view.day?.id ?? `${branchId}:${date}`,
      branchId,
      summary: `Exported ${view.branch.code} cashbook for ${date} as ${format.toUpperCase()}`,
    });

    const fileBase = `cashbook-${view.branch.code}-${date}`;
    if (format === 'csv') {
      const blocks = [
        ['DAILY CASHBOOK SUMMARY', ...summary],
        ['', 'DAY ENTRIES', ...entries],
        ['', 'NAMED ITEMS', ...named],
        ['', 'DENOMINATION COUNT', ...denominations],
      ];
      const csv = blocks
        .flatMap((block) => block.map((row) => (Array.isArray(row) ? row : [row])))
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n');
      return new NextResponse(`\uFEFF${csv}`, {
        headers: {
          ...NO_STORE,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileBase}.csv"`,
        },
      });
    }

    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = PRODUCT_NAME;
    workbook.created = new Date();
    const sheets = [
      ['Summary', summary],
      ['Entries', entries],
      ['Named items', named],
      ['Cash count', denominations],
    ] as const;
    for (const [name, rows] of sheets) {
      const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      rows.forEach((row) => sheet.addRow(row));
      sheet.getRow(1).font = { bold: true, color: { argb: 'FF1E1B4B' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      sheet.columns.forEach((column) => {
        column.width = Math.min(48, Math.max(14, ...(column.values ?? []).slice(1).map((value) => String(value ?? '').length + 2)));
      });
      sheet.autoFilter = rows[0].length > 1
        ? { from: { row: 1, column: 1 }, to: { row: 1, column: rows[0].length } }
        : undefined;
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        ...NO_STORE,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileBase}.xlsx"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cashbook export failed.';
    return NextResponse.json({ error: message }, { status: 403, headers: NO_STORE });
  }
}
