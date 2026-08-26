'use server';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { caseDocuments, maturityCases, payoutTransactions, sessions, users, type Role } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { checkPasswordStrength, hashPassword } from '@/lib/auth/password';
import { requestMeta, requireActor, revokeAllSessions } from '@/lib/auth/session';
import { parseDisplayName, parseEmployeeCode, parsePhone, parseUsername } from '@/lib/profile';
import { ASSIGNABLE_ROLES, assertCan } from '@/lib/rbac';
import { deleteStoredFile, storeAvatar } from '@/lib/storage';
import { fail, ok, toActionError, type ActionResult } from './_result';

/** Retired roles cannot be assigned. ASSIGNABLE_ROLES is the single list. */
const ROLES = ASSIGNABLE_ROLES;
const emailSchema = z.string().trim().email('Enter a valid email');

function revalidateUser(userId: string) {
  revalidatePath('/settings/users');
  revalidatePath(`/settings/users/${userId}`);
  revalidatePath('/account');
}

async function activeAdminCount(exceptId?: string): Promise<number> {
  const conds = [eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt)];
  if (exceptId) conds.push(ne(users.id, exceptId));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(...conds));
  return row?.n ?? 0;
}

async function assertCanDemoteOrDisable(userId: string, next: { role?: Role; active?: boolean; deleting?: boolean }) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return fail('User not found', 'NOT_FOUND');
  if (u.role !== 'ADMIN') return null;
  const wouldLoseAdmin =
    next.deleting === true ||
    next.active === false ||
    (next.role !== undefined && next.role !== 'ADMIN');
  if (!wouldLoseAdmin) return null;
  const others = await activeAdminCount(userId);
  if (others < 1) {
    return fail('This is the last active administrator. Appoint another Admin first.', 'LAST_ADMIN');
  }
  return null;
}

function publicSnapshot(u: typeof users.$inferSelect) {
  return {
    name: u.name,
    username: u.username,
    email: u.email,
    phone: u.phone,
    employeeCode: u.employeeCode,
    role: u.role,
    branchId: u.branchId,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    notes: u.notes,
    deletedAt: u.deletedAt,
  };
}

export async function updateUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');

    const userId = String(formData.get('userId') ?? '');
    if (!userId) return fail('No user', 'VALIDATION');

    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return fail('User not found', 'NOT_FOUND');

    const name = parseDisplayName(String(formData.get('name') ?? ''));
    const username = parseUsername(String(formData.get('username') ?? ''));
    const phone = parsePhone(String(formData.get('phone') ?? ''));
    const employeeCode = parseEmployeeCode(String(formData.get('employeeCode') ?? ''));
    const emailParsed = emailSchema.safeParse(String(formData.get('email') ?? ''));
    const roleRaw = String(formData.get('role') ?? target.role);
    const roleParsed = z.enum(ROLES).safeParse(roleRaw);
    const branchIdRaw = String(formData.get('branchId') ?? '');
    const branchId = branchIdRaw.trim() ? branchIdRaw : null;
    const notesRaw = String(formData.get('notes') ?? '');
    const notes = notesRaw.trim() ? notesRaw.trim().slice(0, 4000) : null;
    const mustChange = formData.get('mustChangePassword') === 'on';

    const fe: Record<string, string> = {};
    if (!name.ok) fe.name = name.error;
    if (!username.ok) fe.username = username.error;
    if (!phone.ok) fe.phone = phone.error;
    if (!employeeCode.ok) fe.employeeCode = employeeCode.error;
    if (!emailParsed.success) fe.email = emailParsed.error.issues[0]?.message ?? 'Enter a valid email';
    if (!roleParsed.success) fe.role = 'Choose a role';
    if (Object.keys(fe).length) return fail('Check the highlighted fields', 'VALIDATION', fe);

    const role = roleParsed.data!;
    const blocked = await assertCanDemoteOrDisable(userId, { role });
    if (blocked) return blocked;

    const next = {
      name: name.ok ? name.name : target.name,
      username: username.ok ? username.username : target.username,
      email: emailParsed.data!.toLowerCase(),
      phone: phone.ok ? phone.phone : target.phone,
      employeeCode: employeeCode.ok ? employeeCode.employeeCode : target.employeeCode,
      role,
      branchId,
      notes,
      mustChangePassword: mustChange,
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      await tx.update(users).set(next).where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.updated',
        entity: 'User',
        entityId: userId,
        branchId: next.branchId,
        summary: `Updated ${next.name} (${next.role})`,
        before: publicSnapshot(target),
        after: { ...next, updatedAt: undefined },
        ...(await requestMeta()),
      });
    });

    if (role !== target.role) await revokeAllSessions(userId);

    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function unlockUserAction(userId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.unlocked',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Unlocked ${u.name}`,
        ...(await requestMeta()),
      });
    });
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function forcePasswordChangeAction(userId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.updated',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Forced password change for ${u.name}`,
        ...(await requestMeta()),
      });
    });
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeUserSessionsAction(userId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    await revokeAllSessions(userId);
    await writeAudit(db, session, {
      action: 'user.sessions_revoked',
      entity: 'User',
      entityId: userId,
      branchId: u.branchId,
      summary: `Signed ${u.name} out of every device`,
      ...(await requestMeta()),
    });
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function revokeUserSessionAction(sessionRowId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionRowId)).limit(1);
    if (!row) return fail('Session not found', 'NOT_FOUND');
    if (row.tokenId === session.tokenId) return fail('You cannot revoke the session you are using.', 'SELF');

    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionRowId));
    await writeAudit(db, session, {
      action: 'user.sessions_revoked',
      entity: 'User',
      entityId: row.userId,
      summary: 'Revoked one live session',
      ...(await requestMeta()),
    });
    revalidateUser(row.userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setUserPasswordAction(userId: string, newPassword: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const strength = checkPasswordStrength(newPassword);
    if (!strength.ok) return fail(strength.problems.join('. '), 'WEAK_PASSWORD');

    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(newPassword),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.password_reset',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Password reset for ${u.name}`,
        ...(await requestMeta()),
      });
    });
    await revokeAllSessions(userId);
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function uploadUserAvatarAction(userId: string, formData: FormData): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return fail('Choose a photo', 'VALIDATION');

    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    const stored = await storeAvatar(userId, file);
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ avatarKey: stored.storageKey, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.avatar_updated',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Photo updated for ${u.name}`,
        ...(await requestMeta()),
      });
    });
    if (u.avatarKey && u.avatarKey !== stored.storageKey) await deleteStoredFile(u.avatarKey);
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeUserAvatarAction(userId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');
    if (!u.avatarKey) return ok();

    await db.transaction(async (tx) => {
      await tx.update(users).set({ avatarKey: null, updatedAt: new Date() }).where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.avatar_updated',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Photo removed for ${u.name}`,
        ...(await requestMeta()),
      });
    });
    await deleteStoredFile(u.avatarKey);
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteUserAction(userId: string, confirmName: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    if (userId === session.id) return fail('You cannot delete your own account.', 'SELF');

    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');
    if (confirmName.trim() !== u.name) {
      return fail('Type the person’s full name exactly to confirm deletion.', 'CONFIRM');
    }

    const blocked = await assertCanDemoteOrDisable(userId, { deleting: true });
    if (blocked) return blocked;

    const [cases] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(maturityCases)
      .where(eq(maturityCases.createdById, userId));
    const [txns] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(payoutTransactions)
      .where(eq(payoutTransactions.recordedById, userId));
    const [docs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(caseDocuments)
      .where(eq(caseDocuments.uploadedById, userId));

    const tied = (cases?.n ?? 0) + (txns?.n ?? 0) + (docs?.n ?? 0) > 0;

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          isActive: false,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.deleted',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: tied
          ? `Deleted ${u.name} (kept on record — they signed money or documents)`
          : `Deleted ${u.name}`,
        before: publicSnapshot(u),
        ...(await requestMeta()),
      });
    });
    await revokeAllSessions(userId);
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function restoreUserAction(userId: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: null, isActive: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: 'user.restored',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `Restored ${u.name}`,
        ...(await requestMeta()),
      });
    });
    revalidateUser(userId);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
