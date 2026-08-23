import { asc, gte } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { GlassCard, PageHeader } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { db } from '@/db';
import { holidays } from '@/db/schema';
import { getSession } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';
import { HolidayManager } from './holiday-manager';

export const metadata = { title: 'Bank holidays' };
export const dynamic = 'force-dynamic';

export default async function HolidaysPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'holiday.manage')) redirect('/dashboard');

  const rows = await db
    .select()
    .from(holidays)
    .where(gte(holidays.date, addDays(todayISO(), -120)))
    .orderBy(asc(holidays.date));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Bank holidays"
        description="A day listed here is never used for a payout instalment, and never counts towards a 'within 15 days' promise."
      />

      <Callout tone="info" title="Already built in">
        Sundays and 2nd/4th Saturdays are handled by each branch&apos;s weekend rule, and the fixed
        national holidays (26 Jan, 1 May, 15 Aug, 2 Oct, 25 Dec) are always excluded. Add the
        moving ones — Diwali, Holi, Eid, and any state or local holiday.
      </Callout>

      <GlassCard bodyClassName="p-0 sm:p-0">
        <HolidayManager
          holidays={rows.map((h) => ({ id: h.id, date: h.date, name: h.name, branchId: h.branchId }))}
          today={todayISO()}
        />
      </GlassCard>
    </div>
  );
}
