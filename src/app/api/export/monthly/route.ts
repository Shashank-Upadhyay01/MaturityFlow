import { NextResponse } from 'next/server';

import { requireActor } from '@/lib/auth/session';
import { paiseToDecimalString } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';
import { getMonthlyLedger } from '@/services/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { actor } = await requireActor();
  assertCan(actor, 'report.export');
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') ?? 'xlsx').toLowerCase();
  const from = url.searchParams.get('from') ?? addDays(todayISO(), -365);
  const to = url.searchParams.get('to') ?? addDays(todayISO(), 90);
  const rows = await getMonthlyLedger(actor, from, to);

  const cols = [
    'Month',
    'Days',
    'Instalments',
    'Planned (₹)',
    'Cash still due (₹)',
    'Online still due (₹)',
    'Cash paid (₹)',
    'Online paid (₹)',
    'Total remaining (₹)',
  ];
  const data = rows.map((m) => [
    m.month,
    m.days,
    m.count,
    paiseToDecimalString(m.plannedPaise),
    paiseToDecimalString(m.cashDuePaise),
    paiseToDecimalString(m.onlineDuePaise),
    paiseToDecimalString(m.cashPaidPaise),
    paiseToDecimalString(m.onlinePaidPaise),
    paiseToDecimalString(m.cashDuePaise + m.onlineDuePaise),
  ]);

  const stamp = `${from.slice(0, 7)}_to_${to.slice(0, 7)}`;

  if (format === 'json') {
    return NextResponse.json({ from, to, rows: data.map((r, i) => Object.fromEntries(cols.map((c, j) => [c, data[i][j]]))) });
  }

  if (format === 'csv') {
    const csv = [cols, ...data].map((r) => r.join(',')).join('\r\n');
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="monthly-cash-${stamp}.csv"`,
      },
    });
  }

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Monthly cash');
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  for (const r of data) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="monthly-cash-${stamp}.xlsx"`,
    },
  });
}
