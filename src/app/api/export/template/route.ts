import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { branches } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { excelHeadersForLayout, parseRegisterLayout, visibleRegisterCols } from '@/lib/register-layout';
import { assertCan } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const SAMPLE: Record<string, string | number> = {
  account: '1001602329',
  customer: 'Sample Customer',
  maturityDate: '29/06/2026',
  formDate: '24/07/2026',
  paymentDate: '29/07/2026',
  amount: 104035,
  paid: 80000,
  remaining: 24035,
  agent: 'Agent Name',
  days: 15,
  perDay: 1602,
  today: 0,
  cash: 0,
  online: 0,
};

export async function GET(request: Request) {
  const { session, actor } = await requireActor();
  assertCan(actor, 'case.view');

  const url = new URL(request.url);
  const branchId = url.searchParams.get('branch') || session.branchId;
  let raw: unknown = null;
  if (branchId) {
    const [b] = await db
      .select({ registerColumnOrder: branches.registerColumnOrder })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    raw = b?.registerColumnOrder;
  }
  const layout = parseRegisterLayout(raw);
  const cols = visibleRegisterCols(layout);
  const headers = excelHeadersForLayout(layout);

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.addRow(cols.map((c) => SAMPLE[c.id] ?? ''));
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="maturity-register-template.xlsx"',
    },
  });
}
