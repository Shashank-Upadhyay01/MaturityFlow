'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

import { requireActor } from '@/lib/auth/session';
import { assertCan } from '@/lib/rbac';
import { parseBugDraft, parseUpdateDraft } from '@/lib/whats-new';
import {
  createAppUpdate,
  createBugReport,
  deleteAppUpdate,
  setBugReportStatus,
  updateAppUpdate,
} from '@/services/whats-new-service';
import { fail, ok, toActionError, type ActionResult } from './_result';
import type { BugReportStatus } from '@/db/schema';

export async function publishUpdateAction(input: {
  title: string;
  body: string;
  kind: string;
  publishedAt: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'updates.manage');
    const parsed = parseUpdateDraft(input);
    if (!parsed.ok) return fail(parsed.error, 'VALIDATION');
    const id = await createAppUpdate(session, actor, parsed.value);
    revalidatePath('/whats-new');
    return ok({ id });
  } catch (e) {
    return toActionError(e);
  }
}

export async function editUpdateAction(
  id: string,
  input: { title: string; body: string; kind: string; publishedAt: string },
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'updates.manage');
    if (!id) return fail('Missing update.', 'VALIDATION');
    const parsed = parseUpdateDraft(input);
    if (!parsed.ok) return fail(parsed.error, 'VALIDATION');
    await updateAppUpdate(session, actor, id, parsed.value);
    revalidatePath('/whats-new');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeUpdateAction(id: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'updates.manage');
    if (!id) return fail('Missing update.', 'VALIDATION');
    await deleteAppUpdate(session, actor, id);
    revalidatePath('/whats-new');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function reportProblemAction(input: {
  screen: string;
  tryingTo: string;
  whatHappened: string;
  extra?: string;
  severity: string;
  pagePath?: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, actor } = await requireActor();
    const parsed = parseBugDraft(input);
    if (!parsed.ok) return fail(parsed.error, 'VALIDATION');
    const headerList = await headers();
    const id = await createBugReport(session, actor, parsed.value, {
      pagePath: input.pagePath ?? null,
      userAgent: headerList.get('user-agent'),
    });
    revalidatePath('/whats-new');
    return ok({ id });
  } catch (e) {
    return toActionError(e);
  }
}

export async function setProblemStatusAction(
  id: string,
  status: BugReportStatus,
  adminNote: string,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'bug.manage');
    if (!id) return fail('Missing report.', 'VALIDATION');
    await setBugReportStatus(session, actor, id, status, adminNote);
    revalidatePath('/whats-new');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
