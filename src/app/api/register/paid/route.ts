import { NextResponse } from 'next/server';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { parseISODate, todayISO } from '@/lib/working-days';
import { countStillDueOn, listPaidOn } from '@/services/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

/**
 * Who took money on one day.
 *
 * The day and the branch come from the Register the clerk is looking at, so the tab answers for
 * the sheet on screen rather than for today whatever page they are on. A malformed date falls
 * back to today instead of erroring — the tab should never be the reason a page looks broken.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: NO_STORE });
  if (!roleCan(session.role, 'case.view')) {
    return NextResponse.json({ error: 'You cannot view the Register' }, { status: 403, headers: NO_STORE });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get('on');
  let on = todayISO();
  if (requested) {
    try {
      parseISODate(requested);
      on = requested;
    } catch {
      on = todayISO();
    }
  }
  // The branch filter narrows; it can never widen what this actor's scope already allows.
  const branchId = url.searchParams.get('branch') || null;

  try {
    const actor = toActor(session);
    const [people, stillDue] = await Promise.all([
      listPaidOn(actor, on, branchId),
      countStillDueOn(actor, on, branchId),
    ]);
    return NextResponse.json(serialize({ on, people, stillDue }), { headers: NO_STORE });
  } catch (cause) {
    console.error('Register paid list failed', cause);
    return NextResponse.json({ error: 'Could not load the day’s payments' }, { status: 500, headers: NO_STORE });
  }
}
