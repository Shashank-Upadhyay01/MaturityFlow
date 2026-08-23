/**
 * session.ts — stateless JWT in an httpOnly cookie, backed by a revocable server-side row.
 *
 * The JWT keeps the hot path free of a DB round-trip for identity, while the `sessions` table
 * means a compromised or ex-employee token dies the moment it is revoked. Both are checked.
 */
import 'server-only';

import { and, eq, isNull, gt } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { db } from '@/db';
import { agents, branches, sessions, users } from '@/db/schema';
import type { Role } from '@/db/schema';
import { cookieSecure, env } from '@/lib/env';
import { newId } from '@/lib/id';
import { loadOrgSettings } from '@/services/org-settings';
import { type Actor, type Permission, permissionsOf } from '@/lib/rbac';

export const SESSION_COOKIE = 'mf_session';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  username: string;
  phone: string | null;
  role: Role;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  agentId: string | null;
  mustChangePassword: boolean;
  hasAvatar: boolean;
  avatarAt: number;
  orgName: string;
  orgShortName: string;
  permissions: Permission[];
  tokenId: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const ttlHours = env().SESSION_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  const tokenId = newId('ses', 24);

  await db.insert(sessions).values({
    id: newId('sess'),
    tokenId,
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const token = await new SignJWT({ sub: userId, jti: tokenId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('maturityflow')
    .setAudience('maturityflow-app')
    .setExpirationTime(expiresAt)
    .sign(secret());

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    path: '/',
    expires: expiresAt,
  });
}

/**
 * Resolve the caller. Memoised per request via React `cache`, so a page that checks
 * permissions in five components still costs one query.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let payload: { sub?: string; jti?: string };
  try {
    const verified = await jwtVerify(token, secret(), {
      issuer: 'maturityflow',
      audience: 'maturityflow-app',
    });
    payload = verified.payload as { sub?: string; jti?: string };
  } catch {
    return null; // expired, tampered, or signed with a rotated secret
  }
  if (!payload.sub || !payload.jti) return null;

  // The token being valid is not enough — the session must still be live.
  const [row] = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      phone: users.phone,
      role: users.role,
      branchId: users.branchId,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
      mustChangePassword: users.mustChangePassword,
      avatarKey: users.avatarKey,
      updatedAt: users.updatedAt,
      branchName: branches.name,
      branchCode: branches.code,
      agentId: agents.id,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(agents, eq(agents.userId, users.id))
    .where(
      and(
        eq(sessions.tokenId, payload.jti),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row || !row.isActive || row.deletedAt) return null;

  const org = await loadOrgSettings();

  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    username: row.username,
    phone: row.phone,
    role: row.role,
    branchId: row.branchId,
    branchName: row.branchName,
    branchCode: row.branchCode,
    agentId: row.agentId,
    mustChangePassword: row.mustChangePassword,
    hasAvatar: Boolean(row.avatarKey),
    avatarAt: row.updatedAt.getTime(),
    orgName: org.orgName,
    orgShortName: org.orgShortName,
    permissions: permissionsOf(row.role),
    tokenId: payload.jti,
  };
});

export class UnauthenticatedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthenticatedError';
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new UnauthenticatedError();
  return s;
}

/** The RBAC view of the caller. */
export function toActor(s: SessionUser): Actor {
  return { id: s.id, role: s.role, branchId: s.branchId, agentId: s.agentId, name: s.name };
}

export async function requireActor(): Promise<{ session: SessionUser; actor: Actor }> {
  const session = await requireSession();
  return { session, actor: toActor(session) };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret(), {
        issuer: 'maturityflow',
        audience: 'maturityflow-app',
      });
      const jti = (payload as { jti?: string }).jti;
      if (jti) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.tokenId, jti));
      }
    } catch {
      // token already unusable — clearing the cookie is enough
    }
  }
  jar.delete(SESSION_COOKIE);
}

/** Kill every live session for a user — used when deactivating or resetting an account. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ip: forwarded ? forwarded.split(',')[0].trim() : (h.get('x-real-ip') ?? null),
    userAgent: h.get('user-agent'),
  };
}
