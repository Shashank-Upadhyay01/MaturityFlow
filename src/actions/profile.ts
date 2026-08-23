'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { users } from '@/db/schema';
import { writeAudit } from '@/lib/audit';
import { requestMeta, requireSession } from '@/lib/auth/session';
import { parseDisplayName, parsePhone, parseUsername } from '@/lib/profile';
import { deleteStoredFile, storeAvatar } from '@/lib/storage';
import { fail, ok, toActionError, type ActionResult } from './_result';

const emailSchema = z.string().trim().email('Enter a valid email');

export async function updateOwnProfileAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const name = parseDisplayName(String(formData.get('name') ?? ''));
    const username = parseUsername(String(formData.get('username') ?? ''));
    const phone = parsePhone(String(formData.get('phone') ?? ''));
    const emailParsed = emailSchema.safeParse(String(formData.get('email') ?? ''));

    const fe: Record<string, string> = {};
    if (!name.ok) fe.name = name.error;
    if (!username.ok) fe.username = username.error;
    if (!phone.ok) fe.phone = phone.error;
    if (!emailParsed.success) fe.email = emailParsed.error.issues[0]?.message ?? 'Enter a valid email';
    if (Object.keys(fe).length) return fail('Check the highlighted fields', 'VALIDATION', fe);

    const email = emailParsed.data!.toLowerCase();

    const [current] = await db.select().from(users).where(eq(users.id, s.id)).limit(1);
    if (!current) return fail('Account not found', 'NOT_FOUND');

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          name: name.ok ? name.name : current.name,
          username: username.ok ? username.username : current.username,
          email,
          phone: phone.ok ? phone.phone : current.phone,
          updatedAt: new Date(),
        })
        .where(eq(users.id, s.id));
      await writeAudit(tx, s, {
        action: 'user.updated',
        entity: 'User',
        entityId: s.id,
        branchId: s.branchId,
        summary: `${s.name} updated their profile`,
        before: { name: current.name, username: current.username, email: current.email, phone: current.phone },
        after: {
          name: name.ok ? name.name : current.name,
          username: username.ok ? username.username : current.username,
          email,
          phone: phone.ok ? phone.phone : current.phone,
        },
        ...(await requestMeta()),
      });
    });

    revalidatePath('/account');
    revalidatePath('/settings');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function uploadOwnAvatarAction(formData: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return fail('Choose a photo', 'VALIDATION');

    const stored = await storeAvatar(s.id, file);
    const [current] = await db
      .select({ avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, s.id))
      .limit(1);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ avatarKey: stored.storageKey, updatedAt: new Date() })
        .where(eq(users.id, s.id));
      await writeAudit(tx, s, {
        action: 'user.avatar_updated',
        entity: 'User',
        entityId: s.id,
        branchId: s.branchId,
        summary: `${s.name} updated their profile photo`,
        ...(await requestMeta()),
      });
    });

    if (current?.avatarKey && current.avatarKey !== stored.storageKey) {
      await deleteStoredFile(current.avatarKey);
    }

    revalidatePath('/account');
    revalidatePath('/settings');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeOwnAvatarAction(): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const [current] = await db
      .select({ avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, s.id))
      .limit(1);
    if (!current?.avatarKey) return ok();

    await db.transaction(async (tx) => {
      await tx.update(users).set({ avatarKey: null, updatedAt: new Date() }).where(eq(users.id, s.id));
      await writeAudit(tx, s, {
        action: 'user.avatar_updated',
        entity: 'User',
        entityId: s.id,
        branchId: s.branchId,
        summary: `${s.name} removed their profile photo`,
        ...(await requestMeta()),
      });
    });
    await deleteStoredFile(current.avatarKey);
    revalidatePath('/account');
    revalidatePath('/settings');
    return ok();
  } catch (e) {
    return toActionError(e);
  }
}
