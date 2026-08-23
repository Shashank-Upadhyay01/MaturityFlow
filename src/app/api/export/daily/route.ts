import { NextResponse } from 'next/server';

import { requireActor } from '@/lib/auth/session';
import { paiseToDecimalString } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';
import { getDailyLedger } from '@/services/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { actor } = await requireActor();
  assertCan(actor, 'report.export');
  const url = new URL(request.url);
  const format = (url.searchParams.get('format') ?? 'xlsx').toLowerCase();
  const from = url.searchParams.get('from') ?? addDays(todayISO(), -90);
  const to = url.searchParams.get('to') ?? addDays(todayISO(), 45);
  const load = await getDailyLedger(actor, from, to);

  const cols = [
    'Date',
    'Month',
    'Instalments',
    'Planned (₹)',
    'Cash still due (₹)',
    'Online still due (₹)',
    'Cash paid (₹)',
    'Online paid (₹)',
    'Total remaining (₹)',
  ];
  const data = load.map((d) => [
    d.date,
    d.month,
    d.count,
    paiseToDecimalString(d.plannedPaise),
    paiseToDecimalString(d.cashDuePaise),
    paiseToDecimalString(d.onlineDuePaise),
    paiseToDecimalString(d.cashPaidPaise),
    paiseToDecimalString(d.onlinePaidPaise),
    paiseToDecimalString(d.cashDuePaise + d.onlineDuePaise),
  ]);

  const stamp = `${from}_to_${to}`;

  if (format === 'json') {
    return NextResponse.json({
      from,
      to,
      rows: data.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]]))),
    });
  }

  if (format === 'csv') {
    const csv = [cols, ...data].map((r) => r.join(',')).join('\r\n');
    return new NextResponse(`\uFEFF${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="daily-cash-${stamp}.csv"`,
      },
    });
  }

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daily cash');
  ws.addRow(cols);
  ws.getRow(1).font = { bold: true };
  for (const r of data) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="daily-cash-${stamp}.xlsx"`,
    },
  });
}
