import { NextResponse } from 'next/server';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { searchWorkspace } from '@/services/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: NO_STORE });
  if (!roleCan(session.role, 'case.view')) {
    return NextResponse.json({ error: 'Search is unavailable' }, { status: 403, headers: NO_STORE });
  }
  const q = new URL(request.url).searchParams.get('q') ?? '';
  try {
    const results = await searchWorkspace(toActor(session), q);
    return NextResponse.json({ results }, { headers: NO_STORE });
  } catch (cause) {
    console.error('Global search failed', cause);
    return NextResponse.json({ error: 'Search failed' }, { status: 500, headers: NO_STORE });
  }
}
