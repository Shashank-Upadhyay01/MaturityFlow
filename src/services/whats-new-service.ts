import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { appUpdates, bugReports, users } from '@/db/schema';
import type { BugReportStatus } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { requestMeta, type SessionUser } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { assertCan, type Actor } from '@/lib/rbac';
import type { BugDraft, UpdateDraft } from '@/lib/whats-new';

function isMissingTable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '42P01');
}

function missingTableError(): Error {
  return new Error('This page is not fully set up on the live server yet. Apply the latest database migration and try again.');
}

export async function listAppUpdates() {
  try {
  return await db
    .select({
      id: appUpdates.id,
      title: appUpdates.title,
      body: appUpdates.body,
      kind: appUpdates.kind,
      publishedAt: appUpdates.publishedAt,
      authorName: users.name,
    })
    .from(appUpdates)
    .leftJoin(users, eq(users.id, appUpdates.createdById))
    .orderBy(desc(appUpdates.publishedAt));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function createAppUpdate(session: SessionUser, actor: Actor, draft: UpdateDraft) {
  assertCan(actor, 'updates.manage');
  const id = newId('upd');
  try {
  await db.transaction(async (tx) => {
    await tx.insert(appUpdates).values({
      id,
      title: draft.title,
      body: draft.body,
      kind: draft.kind,
      publishedAt: draft.publishedAt,
      createdById: session.id,
    });
    await writeAudit(tx, session, {
      action: 'update.published',
      entity: 'AppUpdate',
      entityId: id,
      summary: `Published update: ${draft.title}`,
      after: { title: draft.title, kind: draft.kind, publishedAt: draft.publishedAt.toISOString() },
      ...(await requestMeta()),
    });
  });
  } catch (error) {
    if (isMissingTable(error)) throw missingTableError();
    throw error;
  }
  return id;
}

export async function updateAppUpdate(
  session: SessionUser,
  actor: Actor,
  id: string,
  draft: UpdateDraft,
) {
  assertCan(actor, 'updates.manage');
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(appUpdates).where(eq(appUpdates.id, id)).limit(1);
    if (!existing) throw new Error('That update is not there any more.');
    await tx
      .update(appUpdates)
      .set({
        title: draft.title,
        body: draft.body,
        kind: draft.kind,
        publishedAt: draft.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(appUpdates.id, id));
    await writeAudit(tx, session, {
      action: 'update.edited',
      entity: 'AppUpdate',
      entityId: id,
      summary: `Edited update: ${draft.title}`,
      before: { title: existing.title, kind: existing.kind },
      after: { title: draft.title, kind: draft.kind, publishedAt: draft.publishedAt.toISOString() },
      ...(await requestMeta()),
    });
  });
}

export async function deleteAppUpdate(session: SessionUser, actor: Actor, id: string) {
  assertCan(actor, 'updates.manage');
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(appUpdates).where(eq(appUpdates.id, id)).limit(1);
    if (!existing) throw new Error('That update is not there any more.');
    await tx.delete(appUpdates).where(eq(appUpdates.id, id));
    await writeAudit(tx, session, {
      action: 'update.removed',
      entity: 'AppUpdate',
      entityId: id,
      summary: `Removed update: ${existing.title}`,
      before: { title: existing.title, kind: existing.kind },
      ...(await requestMeta()),
    });
  });
}

export async function listOwnBugReports(actor: Actor) {
  try {
  return await db
    .select({
      id: bugReports.id,
      screen: bugReports.screen,
      tryingTo: bugReports.tryingTo,
      whatHappened: bugReports.whatHappened,
      extra: bugReports.extra,
      severity: bugReports.severity,
      status: bugReports.status,
      adminNote: bugReports.adminNote,
      createdAt: bugReports.createdAt,
    })
    .from(bugReports)
    .where(eq(bugReports.reporterId, actor.id))
    .orderBy(desc(bugReports.createdAt));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function listAllBugReports(actor: Actor) {
  assertCan(actor, 'bug.manage');
  try {
  return await db
    .select({
      id: bugReports.id,
      screen: bugReports.screen,
      tryingTo: bugReports.tryingTo,
      whatHappened: bugReports.whatHappened,
      extra: bugReports.extra,
      severity: bugReports.severity,
      status: bugReports.status,
      adminNote: bugReports.adminNote,
      pagePath: bugReports.pagePath,
      reporterRole: bugReports.reporterRole,
      userAgent: bugReports.userAgent,
      createdAt: bugReports.createdAt,
      reporterName: users.name,
    })
    .from(bugReports)
    .innerJoin(users, eq(users.id, bugReports.reporterId))
    .orderBy(desc(bugReports.createdAt));
  } catch (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
}

export async function createBugReport(
  session: SessionUser,
  actor: Actor,
  draft: BugDraft,
  meta: { pagePath?: string | null; userAgent?: string | null },
) {
  const id = newId('bug');
  try {
  await db.transaction(async (tx) => {
    await tx.insert(bugReports).values({
      id,
      reporterId: session.id,
      screen: draft.screen,
      tryingTo: draft.tryingTo,
      whatHappened: draft.whatHappened,
      extra: draft.extra || null,
      severity: draft.severity,
      pagePath: meta.pagePath ?? null,
      reporterRole: session.role,
      branchId: session.branchId,
      userAgent: meta.userAgent ?? null,
    });
    await writeAudit(tx, session, {
      action: 'bug.reported',
      entity: 'BugReport',
      entityId: id,
      branchId: session.branchId,
      summary: `Reported a problem on ${draft.screen}: ${draft.tryingTo}`,
      ...(await requestMeta()),
    });
  });
  } catch (error) {
    if (isMissingTable(error)) throw missingTableError();
    throw error;
  }
  return id;
}

export async function setBugReportStatus(
  session: SessionUser,
  actor: Actor,
  id: string,
  status: BugReportStatus,
  adminNote: string,
) {
  assertCan(actor, 'bug.manage');
  const note = adminNote.trim();
  if (note.length > 2000) throw new Error('Keep the note to a few sentences.');
  const resolved = status === 'FIXED' || status === 'CLOSED';
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(bugReports).where(eq(bugReports.id, id)).limit(1);
    if (!existing) throw new Error('That report is not there any more.');
    await tx
      .update(bugReports)
      .set({
        status,
        adminNote: note || null,
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? session.id : null,
        updatedAt: new Date(),
      })
      .where(eq(bugReports.id, id));
    await writeAudit(tx, session, {
      action: 'bug.updated',
      entity: 'BugReport',
      entityId: id,
      summary: `Set problem report to ${status}`,
      before: { status: existing.status },
      after: { status, adminNote: note || null },
      ...(await requestMeta()),
    });
  });
}


