'use server';

import { eq, or } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/db';
import { users } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { checkPasswordStrength, hashPassword, verifyPassword } from '@/lib/auth/password';
import { defaultLandingPage, type LandingPage } from '@/lib/landing-page';
import {
  createSession,
  destroySession,
  requestMeta,
  requireSession,
  revokeAllSessions,
} from '@/lib/auth/session';
import { fail, ok, toActionError, type ActionResult } from './_result';

const LOCK_AFTER = 6;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username'),
  password: z.string().min(1, 'Enter your password'),
});

export async function loginAction(
  _prev: ActionResult<{ mustChangePassword: boolean; next: LandingPage }> | null,
  formData: FormData,
): Promise<ActionResult<{ mustChangePassword: boolean; next: LandingPage }>> {
  try {
    const parsed = loginSchema.safeParse({
      identifier: formData.get('identifier') ?? formData.get('email'),
      password: formData.get('password'),
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the details below', 'VALIDATION', fe);
    }

    const identifier = parsed.data.identifier.trim().toLowerCase();
    const meta = await requestMeta();

    const [user] = identifier.includes('@')
      ? await db.select().from(users).where(eq(users.email, identifier)).limit(1)
      : await db
          .select()
          .from(users)
          .where(or(eq(users.username, identifier), eq(users.email, identifier)))
          .limit(1);

    // Same generic message whether the account is missing or the password is wrong —
    // never confirm to an attacker that an email exists.
    const GENERIC = 'Email, username or password is incorrect.';

    if (!user) {
      await new Promise((r) => setTimeout(r, 250)); // level the timing
      return fail(GENERIC, 'BAD_CREDENTIALS');
    }
    if (!user.isActive || user.deletedAt) return fail('This account has been deactivated.', 'INACTIVE');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return fail(`Too many failed attempts. Try again in ${mins} minute(s).`, 'LOCKED');
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      const failures = user.failedLoginCount + 1;
      await db
        .update(users)
        .set({
          failedLoginCount: failures,
          lockedUntil:
            failures >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await writeAudit(db, { id: user.id, name: user.name, role: user.role }, {
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user.id,
        branchId: user.branchId,
        summary: `Failed sign-in (${failures}/${LOCK_AFTER})`,
        ...meta,
      });
      return fail(GENERIC, 'BAD_CREDENTIALS');
    }

    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    await createSession(user.id, meta);
    await writeAudit(db, { id: user.id, name: user.name, role: user.role }, {
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      branchId: user.branchId,
      summary: `${user.name} signed in`,
      ...meta,
    });

    return ok({
      mustChangePassword: user.mustChangePassword,
      next: defaultLandingPage(user),
    });
  } catch (e) {
    return toActionError(e);
  }
}

export async function logoutAction(): Promise<void> {
  try {
    const s = await requireSession();
    const meta = await requestMeta();
    await writeAudit(db, s, {
      action: 'auth.logout',
      entity: 'User',
      entityId: s.id,
      branchId: s.branchId,
      summary: `${s.name} signed out`,
      ...meta,
    });
  } catch {
    /* already signed out */
  }
  await destroySession();
  redirect('/login');
}

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z.string().min(10, 'Use at least 10 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'The two new passwords do not match',
    path: ['confirmPassword'],
  });

export async function changePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const parsed = changeSchema.safeParse({
      currentPassword: formData.get('currentPassword'),
      newPassword: formData.get('newPassword'),
      confirmPassword: formData.get('confirmPassword'),
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the details below', 'VALIDATION', fe);
    }

    const strength = checkPasswordStrength(parsed.data.newPassword);
    if (!strength.ok) {
      return fail(strength.problems.join('. '), 'WEAK_PASSWORD', {
        newPassword: strength.problems[0],
      });
    }

    const [user] = await db.select().from(users).where(eq(users.id, s.id)).limit(1);
    if (!user) return fail('Account not found', 'NOT_FOUND');

    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return fail('Your current password is incorrect.', 'BAD_CREDENTIALS', {
        currentPassword: 'Incorrect',
      });
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, s.id));

    const meta = await requestMeta();
    await writeAudit(db, s, {
      action: 'auth.password_changed',
      entity: 'User',
      entityId: s.id,
      branchId: s.branchId,
      summary: `${s.name} changed their password`,
      ...meta,
    });

    // Every other device is logged out — a password change should end old sessions.
    await revokeAllSessions(s.id);
    await createSession(s.id, meta);

    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
