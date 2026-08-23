import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { caseDocuments, maturityCases } from '@/db/schema';
import { requireActor } from '@/lib/auth/session';
import { assertCan } from '@/lib/rbac';
import { readCaseDocument, safeDownloadName } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/**
 * Authenticated document download.
 *
 * The storage key is never exposed and never taken from the request — it is looked up from
 * the row, and the caller's access to the PARENT CASE is re-checked here. A branch manager
 * cannot fetch another branch's KYC scan by guessing an id.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireActor();
    const { id } = await ctx.params;

    const [row] = await db
      .select({
        doc: caseDocuments,
        branchId: maturityCases.branchId,
        agentId: maturityCases.agentId,
      })
      .from(caseDocuments)
      .innerJoin(maturityCases, eq(maturityCases.id, caseDocuments.caseId))
      .where(eq(caseDocuments.id, id))
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    assertCan(actor, 'case.view', { branchId: row.branchId, agentId: row.agentId });

    const bytes = await readCaseDocument(row.doc.storageKey);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': row.doc.mimeType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${safeDownloadName(row.doc.fileName)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that document';
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
