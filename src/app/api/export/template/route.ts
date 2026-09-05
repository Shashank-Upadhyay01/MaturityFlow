import { asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { branches } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { buildRegisterTemplate } from '@/lib/register-template';
import { assertCan } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

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

  const buf = await buildRegisterTemplate({ compiled, branchCode: sampleBranchCode });
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${compiled ? 'all-branches-register-template' : 'maturity-register-template'}.xlsx"`,
    },
  });
}
