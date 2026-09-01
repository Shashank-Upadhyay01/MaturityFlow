'use server';

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { agents, branchCashPositions, branches, holidays, users } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { checkPasswordStrength, hashPassword } from '@/lib/auth/password';
import { requestMeta, requireActor, revokeAllSessions } from '@/lib/auth/session';
import { newId } from '@/lib/id';
import { formatPaise, parseRupeesToPaise } from '@/lib/money';
import { ASSIGNABLE_ROLES, assertCan } from '@/lib/rbac';
import { fail, ok, toActionError, type ActionResult } from './_result';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ── Branch cash opening ───────────────────────────────────────────────────

export async function setCashOpeningAction(
  branchId: string,
  date: string,
  amount: string,
  note?: string,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'cash.setOpening', { branchId });
    if (!ISO.test(date)) return fail('Invalid date', 'VALIDATION');

    let paise: bigint;
    try {
      paise = parseRupeesToPaise(amount);
    } catch {
      return fail('Enter a valid amount', 'VALIDATION');
    }

    await db.transaction(async (tx) => {
      await tx
        .insert(branchCashPositions)
        .values({
          id: newId('cp'),
          branchId,
          date,
          openingCashPaise: paise,
          note: note ?? null,
          notedById: session.id,
        })
        .onConflictDoUpdate({
          target: [branchCashPositions.branchId, branchCashPositions.date],
          set: { openingCashPaise: paise, note: note ?? null, notedById: session.id, updatedAt: new Date() },
        });
      await writeAudit(tx, session, {
        action: 'cash.opening_set',
        entity: 'BranchCashPosition',
        entityId: `${branchId}|${date}`,
        branchId,
        summary: `Cash opening for ${date} set to ${formatPaise(paise)}`,
        ...(await requestMeta()),
      });
    });

    revalidatePath('/cash-planner');
    revalidatePath('/dashboard');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ── Holidays ──────────────────────────────────────────────────────────────

export async function addHolidayAction(
  date: string,
  name: string,
  branchId: string | null,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'holiday.manage', branchId ? { branchId } : {});
    if (!ISO.test(date)) return fail('Invalid date', 'VALIDATION');
    if (!name.trim()) return fail('Give the holiday a name', 'VALIDATION');

    await db.transaction(async (tx) => {
      await tx
        .insert(holidays)
        .values({
          id: newId('hol'),
          key: `${date}|${branchId ?? 'ALL'}`,
          date,
          name: name.trim(),
          branchId,
          createdById: session.id,
        })
        .onConflictDoNothing();
      await writeAudit(tx, session, {
        action: 'holiday.created',
        entity: 'Holiday',
        entityId: `${date}|${branchId ?? 'ALL'}`,
        branchId,
        summary: `Holiday added: ${name.trim()} on ${date}`,
        ...(await requestMeta()),
      });
    });

    revalidatePath('/settings/holidays');
    revalidatePath('/cash-planner');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteHolidayAction(id: string): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'holiday.manage');
    const [h] = await db.select().from(holidays).where(eq(holidays.id, id)).limit(1);
    if (!h) return fail('Holiday not found', 'NOT_FOUND');
    await db.transaction(async (tx) => {
      await tx.delete(holidays).where(eq(holidays.id, id));
      await writeAudit(tx, session, {
        action: 'holiday.deleted',
        entity: 'Holiday',
        entityId: id,
        branchId: h.branchId,
        summary: `Holiday removed: ${h.name} on ${h.date}`,
        ...(await requestMeta()),
      });
    });
    revalidatePath('/settings/holidays');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ── Agents ────────────────────────────────────────────────────────────────

const agentSchema = z.object({
  code: z.string().trim().min(2, 'Enter an agent code'),
  name: z.string().trim().min(2, 'Enter the agent name'),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  branchId: z.string().min(1, 'Choose a branch'),
});

export async function createAgentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    const parsed = agentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;
    assertCan(actor, 'agent.manage', { branchId: d.branchId });

    const id = newId('agt');
    await db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id,
        code: d.code.toUpperCase(),
        name: d.name,
        phone: d.phone || null,
        email: d.email || null,
        branchId: d.branchId,
      });
      await writeAudit(tx, session, {
        action: 'agent.created',
        entity: 'Agent',
        entityId: id,
        branchId: d.branchId,
        summary: `Agent added: ${d.name} (${d.code.toUpperCase()})`,
        ...(await requestMeta()),
      });
    });
    revalidatePath('/agents');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ── Branches ──────────────────────────────────────────────────────────────

const branchSchema = z.object({
  code: z.string().trim().min(2, 'Enter a branch code'),
  name: z.string().trim().min(2, 'Enter the branch name'),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  ifsc: z.string().trim().optional().nullable(),
  defaultWindowDays: z.coerce.number().int().min(1).max(60),
  defaultRounding: z.string().min(1),
  dailyCashComfort: z.string().min(1),
  saturdayRule: z.enum(['NONE', 'ALL', 'SECOND_FOURTH']),
  sundaysOff: z.union([z.literal('on'), z.literal('')]).optional(),
});

export async function upsertBranchAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'branch.manage');
    const parsed = branchSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;
    const existingId = String(formData.get('id') ?? '');

    const values = {
      code: d.code.toUpperCase(),
      name: d.name,
      city: d.city || null,
      state: d.state || null,
      phone: d.phone || null,
      ifsc: d.ifsc || null,
      defaultWindowDays: d.defaultWindowDays,
      defaultRoundingPaise: parseRupeesToPaise(d.defaultRounding),
      dailyCashComfortPaise: parseRupeesToPaise(d.dailyCashComfort),
      saturdayRule: d.saturdayRule,
      sundaysOff: d.sundaysOff === 'on',
      updatedAt: new Date(),
    };

    await db.transaction(async (tx) => {
      let id = existingId;
      if (existingId) {
        await tx.update(branches).set(values).where(eq(branches.id, existingId));
      } else {
        id = newId('br');
        await tx.insert(branches).values({ id, ...values });
      }
      await writeAudit(tx, session, {
        action: existingId ? 'branch.updated' : 'branch.created',
        entity: 'Branch',
        entityId: id,
        branchId: id,
        summary: `${existingId ? 'Updated' : 'Created'} branch ${values.code} — ${values.name}`,
        after: { ...values, defaultRoundingPaise: values.defaultRoundingPaise, dailyCashComfortPaise: values.dailyCashComfortPaise },
        ...(await requestMeta()),
      });
    });

    revalidatePath('/branches');
    revalidatePath('/settings/branches');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveRegisterLayoutAction(
  branchId: string,
  order: string[],
  hidden: string[],
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'settings.manage', { branchId });
    if (!branchId) return fail('No branch', 'VALIDATION');
    const { parseRegisterLayout, REGISTER_LAYOUT_VERSION } = await import('@/lib/register-layout');
    const layout = parseRegisterLayout({ version: REGISTER_LAYOUT_VERSION, order, hidden });
    await db.transaction(async (tx) => {
      await tx
        .update(branches)
        .set({ registerColumnOrder: layout, updatedAt: new Date() })
        .where(eq(branches.id, branchId));
      await writeAudit(tx, session, {
        action: 'settings.updated',
        entity: 'Branch',
        entityId: branchId,
        branchId,
        summary: 'Register column layout updated',
        after: layout,
        ...(await requestMeta()),
      });
    });
    revalidatePath('/maturities');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

// ── Users ─────────────────────────────────────────────────────────────────

const userSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  username: z.string().trim().min(3, 'Enter a username'),
  name: z.string().trim().min(2, 'Enter a name'),
  employeeCode: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  role: z.enum(ASSIGNABLE_ROLES),
  branchId: z.string().optional().nullable(),
  password: z.string().min(10, 'Use at least 10 characters'),
});

export async function createUserAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    const parsed = userSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      return fail('Check the highlighted fields', 'VALIDATION', fe);
    }
    const d = parsed.data;
    const { parsePhone, parseUsername, parseEmployeeCode, parseDisplayName } = await import('@/lib/profile');
    const name = parseDisplayName(d.name);
    const username = parseUsername(d.username);
    const phone = parsePhone(d.phone ?? '');
    const employeeCode = parseEmployeeCode(d.employeeCode ?? '');
    const extra: Record<string, string> = {};
    if (!name.ok) extra.name = name.error;
    if (!username.ok) extra.username = username.error;
    if (!phone.ok) extra.phone = phone.error;
    if (!employeeCode.ok) extra.employeeCode = employeeCode.error;
    if (Object.keys(extra).length) return fail('Check the highlighted fields', 'VALIDATION', extra);

    const strength = checkPasswordStrength(d.password);
    if (!strength.ok) return fail(strength.problems.join('. '), 'WEAK_PASSWORD', { password: strength.problems[0] });

    const id = newId('usr');
    await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id,
        email: d.email.toLowerCase(),
        username: username.ok ? username.username : d.username,
        name: name.ok ? name.name : d.name,
        employeeCode: employeeCode.ok ? employeeCode.employeeCode : d.employeeCode || null,
        phone: phone.ok ? phone.phone : null,
        role: d.role,
        branchId: d.branchId || null,
        passwordHash: await hashPassword(d.password),
        mustChangePassword: true,
      });
      await writeAudit(tx, session, {
        action: 'user.created',
        entity: 'User',
        entityId: id,
        branchId: d.branchId || null,
        summary: `User created: ${d.name} (${d.role})`,
        ...(await requestMeta()),
      });
    });

    revalidatePath('/settings/users');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'user.manage');
    if (userId === session.id) return fail('You cannot deactivate your own account.', 'SELF');

    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return fail('User not found', 'NOT_FOUND');
    if (!active && u.role === 'ADMIN') {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(eq(users.role, 'ADMIN'), eq(users.isActive, true), isNull(users.deletedAt), ne(users.id, userId)),
        );
      if ((row?.n ?? 0) < 1) {
        return fail('This is the last active administrator. Appoint another Admin first.', 'LAST_ADMIN');
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ isActive: active, deletedAt: active ? null : u.deletedAt, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await writeAudit(tx, session, {
        action: active ? 'user.updated' : 'user.deactivated',
        entity: 'User',
        entityId: userId,
        branchId: u.branchId,
        summary: `${u.name} ${active ? 'reactivated' : 'deactivated'}`,
        ...(await requestMeta()),
      });
    });
    // Deactivating must take effect immediately, not at token expiry.
    if (!active) await revokeAllSessions(userId);

    revalidatePath('/settings/users');
    revalidatePath(`/settings/users/${userId}`);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function resetUserPasswordAction(
  userId: string,
  newPassword: string,
): Promise<ActionResult> {
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
    revalidatePath('/settings/users');
    revalidatePath(`/settings/users/${userId}`);
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveOrgSettingsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const { session, actor } = await requireActor();
    assertCan(actor, 'settings.manage');

    const orgName = String(formData.get('orgName') ?? '').trim();
    const orgShortName = String(formData.get('orgShortName') ?? '').trim();
    const windowRaw = Number(formData.get('defaultWindowDays') ?? '');
    const fe: Record<string, string> = {};
    if (orgName.length < 2) fe.orgName = 'Enter the organisation name';
    if (orgShortName.length < 2) fe.orgShortName = 'Enter a short name';
    if (!Number.isInteger(windowRaw) || windowRaw < 1 || windowRaw > 60) {
      fe.defaultWindowDays = 'Window must be between 1 and 60 working days';
    }

    let cashCapPaise: bigint;
    let defaultRoundingPaise: bigint;
    try {
      cashCapPaise = parseRupeesToPaise(String(formData.get('cashCap') ?? ''));
      if (cashCapPaise <= 0n) fe.cashCap = 'Cash cap must be greater than zero';
    } catch {
      fe.cashCap = 'Enter a valid rupee amount';
      cashCapPaise = 0n;
    }
    try {
      defaultRoundingPaise = parseRupeesToPaise(String(formData.get('defaultRounding') ?? ''));
      if (defaultRoundingPaise <= 0n) fe.defaultRounding = 'Rounding step must be greater than zero';
    } catch {
      fe.defaultRounding = 'Enter a valid rupee amount';
      defaultRoundingPaise = 0n;
    }
    if (Object.keys(fe).length) return fail('Check the highlighted fields', 'VALIDATION', fe);

    const { persistOrgSettings } = await import('@/services/org-settings');
    const next = {
      orgName,
      orgShortName,
      cashCapPaise,
      defaultWindowDays: windowRaw,
      defaultRoundingPaise,
    };

    await db.transaction(async (tx) => {
      await persistOrgSettings(tx, next, session.id);
      await writeAudit(tx, session, {
        action: 'settings.updated',
        entity: 'SystemSettings',
        entityId: 'org',
        summary: `Organisation settings updated (${orgShortName})`,
        after: {
          orgName,
          orgShortName,
          cashCapPaise,
          defaultWindowDays: windowRaw,
          defaultRoundingPaise,
        },
        ...(await requestMeta()),
      });
    });

    revalidatePath('/settings');
    revalidatePath('/settings/organisation');
    revalidatePath('/cash-planner');
    revalidatePath('/account');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
