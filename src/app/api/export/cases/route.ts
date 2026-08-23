import { NextResponse } from 'next/server';

import { db } from '@/db';
import { writeAudit } from '@/lib/audit';
import { requireActor } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { formatDMY, todayISO } from '@/lib/working-days';
import { listRegister } from '@/services/queries';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'Savings Account Number',
  'Customer Name',
  'Date of Maturity',
  'Form Submission Date',
  'Payment Date',
  'Maturity Amount',
  'Paid Maturity',
  'Remaining Amount',
  "Customer's Agent Name",
  "Today's Approved Withdrawalable Amount",
  'Window Days',
] as const;

export async function GET(request: Request) {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'report.export');

    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
    const today = todayISO();
    const rows = await listRegister(actor);

    const data = rows.map((c) => {
      const paid = c.paidCashPaise + c.paidOnlinePaise;
      return [
        c.accountNumber ?? '',
        c.customerName,
        c.instrumentMaturityOn ? formatDMY(c.instrumentMaturityOn) : '',
        formatDMY(c.formSubmittedOn),
        c.paymentOn ? formatDMY(c.paymentOn) : '',
        formatPaise(c.maturityAmountPaise, { decimals: false, symbol: false }),
        formatPaise(paid, { decimals: false, symbol: false }),
        formatPaise(c.maturityAmountPaise - paid, { decimals: false, symbol: false }),
        c.agentName,
        formatPaise(c.todayApprovedPaise, { decimals: false, symbol: false }),
        c.windowDays,
      ];
    });

    await writeAudit(db, session, {
      action: 'report.exported',
      entity: 'Report',
      entityId: `cases:${format}`,
      branchId: session.branchId,
      summary: `Exported ${data.length} cases as ${format.toUpperCase()}`,
    });

    const stamp = today.replace(/-/g, '');

    if (format === 'csv') {
      const csv = [COLUMNS, ...data]
        .map((r) => r.map(csvCell).join(','))
        .join('\r\n');
      return new NextResponse(`\uFEFF${csv}`, {  // BOM so Excel reads UTF-8 correctly
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="maturities-${stamp}.csv"`,
        },
      });
    }

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'MaturityFlow';
    wb.created = new Date();
    const ws = wb.addWorksheet('Maturities', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.addRow([...COLUMNS]);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E7FF' },
    };
    for (const r of data) ws.addRow(r);
    ws.columns.forEach((col, i) => {
      col.width = Math.max(12, (COLUMNS[i]?.length ?? 10) + 4);
      if (i >= 5 && i <= 7) col.numFmt = '#,##,##0';
      if (i === 9) col.numFmt = '#,##,##0';
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="maturities-${stamp}.xlsx"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Export failed';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
