import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { users } from '@/db/schema';
import { requireSession } from '@/lib/auth/session';
import { readStoredFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    await requireSession();
    const { userId } = await ctx.params;

    const [row] = await db
      .select({ avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row?.avatarKey) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const bytes = await readStoredFile(row.avatarKey);
    const ext = row.avatarKey.split('.').pop()?.toLowerCase();
    const mime =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
