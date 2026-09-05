import { NextResponse } from 'next/server';

import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { todayISO } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getPlanBoardCases, getPlanBoardInstalments } from '@/services/queries';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: NO_STORE });
  if (!roleCan(session.role, 'case.view')) {
    return NextResponse.json({ error: 'You cannot view the Register plan' }, { status: 403, headers: NO_STORE });
  }

  try {
    const actor = toActor(session);
    const [cases, instalments] = await Promise.all([
      getPlanBoardCases(actor),
      getPlanBoardInstalments(actor),
    ]);
    const branchIds = [...new Set(cases.map((row) => row.branchId))];
    const calendarRows = await Promise.all(
      branchIds.map(async (branchId) => [branchId, await getCalendarSnapshot(branchId)] as const),
    );
    return NextResponse.json(
      serialize({
        cases,
        instalments,
        calendars: Object.fromEntries(calendarRows),
        today: todayISO(),
        // Whether the board may offer to commit its what-if, decided on the server.
        canReplan: roleCan(session.role, 'schedule.reschedule'),
      }),
      { headers: NO_STORE },
    );
  } catch (cause) {
    console.error('Register plan load failed', cause);
    return NextResponse.json({ error: 'Could not load the payout plan' }, { status: 500, headers: NO_STORE });
  }
}
