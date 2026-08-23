'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db';
import { caseDocuments, maturityCases, type DocumentKind } from '@/db/schema';
import { isDocumentKind } from '@/lib/documents';
import { writeAudit } from '@/lib/audit';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { assertCan } from '@/lib/rbac';
import { storeCaseDocument, StorageError } from '@/lib/storage';
import { fail, ok, toActionError, type ActionResult } from './_result';

export async function uploadCaseDocumentAction(
  _prev: ActionResult<{ count: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ count: number }>> {
  try {
    const { session, actor } = await requireActor();

    const caseId = String(formData.get('caseId') ?? '');
    const kindRaw = String(formData.get('kind') ?? 'OTHER');
    const kind: DocumentKind = isDocumentKind(kindRaw) ? kindRaw : 'OTHER';

    const [c] = await db
      .select({
        id: maturityCases.id,
        branchId: maturityCases.branchId,
        agentId: maturityCases.agentId,
        caseNumber: maturityCases.caseNumber,
        status: maturityCases.status,
      })
      .from(maturityCases)
      .where(eq(maturityCases.id, caseId))
      .limit(1);
    if (!c) return fail('Case not found', 'NOT_FOUND');

    // Attaching a document is an edit of the case file.
    assertCan(actor, 'case.edit', { branchId: c.branchId, agentId: c.agentId });

    const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return fail('Choose at least one file to attach.', 'VALIDATION');
    if (files.length > 10) return fail('Attach at most 10 files at a time.', 'VALIDATION');

    const meta = await requestMeta();
    let count = 0;

    for (const file of files) {
      let stored;
      try {
        stored = await storeCaseDocument(c.id, file);
      } catch (e) {
        if (e instanceof StorageError) return fail(`${file.name}: ${e.message}`, e.code);
        throw e;
      }

      const id = newId('doc');
      await db.transaction(async (tx) => {
        await tx.insert(caseDocuments).values({
          id,
          caseId: c.id,
          kind,
          fileName: file.name,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          storageKey: stored.storageKey,
          uploadedById: session.id,
        });
        await writeAudit(tx, session, {
          action: 'document.uploaded',
          entity: 'CaseDocument',
          entityId: id,
          branchId: c.branchId,
          summary: `${c.caseNumber}: attached ${file.name} (${kind}), sha256 ${stored.sha256.slice(0, 16)}…`,
          after: { fileName: file.name, kind, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
          ...meta,
        });
      });
      count++;
    }

    revalidatePath(`/maturities/${c.id}`);
    return ok({ count });
  } catch (e) {
    return toActionError(e);
  }
}

/** Mark a document as checked by the approver — the KYC sign-off, recorded per file. */
export async function verifyCaseDocumentAction(documentId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();

    const [row] = await db
      .select({
        doc: caseDocuments,
        branchId: maturityCases.branchId,
        caseNumber: maturityCases.caseNumber,
      })
      .from(caseDocuments)
      .innerJoin(maturityCases, eq(maturityCases.id, caseDocuments.caseId))
      .where(eq(caseDocuments.id, documentId))
      .limit(1);
    if (!row) return fail('Document not found', 'NOT_FOUND');

    // Verifying documents is part of the approval duty.
    assertCan(actor, 'case.approve', { branchId: row.branchId });
    if (row.doc.verifiedAt) return fail('That document is already verified.', 'ALREADY_VERIFIED');

    await db.transaction(async (tx) => {
      await tx
        .update(caseDocuments)
        .set({ verifiedById: session.id, verifiedAt: new Date() })
        .where(and(eq(caseDocuments.id, documentId), eq(caseDocuments.caseId, row.doc.caseId)));
      await writeAudit(tx, session, {
        action: 'document.verified',
        entity: 'CaseDocument',
        entityId: documentId,
        branchId: row.branchId,
        summary: `${row.caseNumber}: verified ${row.doc.fileName}`,
        ...(await requestMeta()),
      });
    });

    revalidatePath(`/maturities/${row.doc.caseId}`);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

