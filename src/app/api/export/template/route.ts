import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { branches } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { REGISTER_IMPORT_HEADERS } from '@/lib/excel-register';
import { assertCan } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

const SAMPLE: Record<string, string | number> = {
  'Savings Account Number': '1001602329',
  'Customer Name': 'Sample Customer',
  'Date of Maturity': '29/06/2026',
  'Form Submission Date': '24/07/2026',
  'Payment Date': '29/07/2026',
  'Maturity Amount': 104035,
  'Paid Maturity': 80000,
  'Remaining Amount': 24035,
  "Customer's Agent Name": 'Agent Name',
  'Window Days': 15,
  'Due Payment': 0,
};

export async function GET(request: Request) {
  const { session, actor } = await requireActor();
  assertCan(actor, 'case.view');

  const url = new URL(request.url);
  const compiled = url.searchParams.get('scope') === 'all';
  const branchId = url.searchParams.get('branch') || session.branchId;
  let sampleBranchCode = 'AZM';
  if (branchId) {
    const [b] = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1);
    sampleBranchCode = b?.code ?? sampleBranchCode;
  } else {
    const [b] = await db
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.isActive, true))
      .orderBy(asc(branches.code))
      .limit(1);
    sampleBranchCode = b?.code ?? sampleBranchCode;
  }
  const headers = [
    ...(compiled ? ['Branch Code'] : []),
    ...REGISTER_IMPORT_HEADERS,
  ];

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    ...(compiled ? [sampleBranchCode] : []),
    ...REGISTER_IMPORT_HEADERS.map((h) => SAMPLE[h] ?? ''),
  ]);
  ws.columns.forEach((c) => {
    c.width = 18;
  });
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${compiled ? 'all-branches-register-template' : 'maturity-register-template'}.xlsx"`,
    },
  });
}
