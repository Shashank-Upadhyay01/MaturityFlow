import { redirect } from 'next/navigation';

import { Topbar } from '@/components/layout/topbar';
import { getSession, toActor } from '@/lib/auth/session';
import { getNavBadges } from '@/services/queries';
import { formatISODate, todayISO, weekdayShort } from '@/lib/working-days';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const actor = toActor(session);
  const today = todayISO();
  const badges = await getNavBadges(actor, today);

  return (
    <div className="flex min-h-dvh min-w-0 flex-col">
      <Topbar
        session={session}
        badges={badges}
        todayLabel={`${weekdayShort(today)}, ${formatISODate(today)}`}
      />
      <main className="min-w-0 flex-1 px-3 py-3 sm:px-4">
        {children}
      </main>
      <footer className="no-print px-6 py-2 text-center text-[0.6875rem] text-[var(--faint-fg)]">
        MaturityFlow · every rupee scheduled, every action audited
      </footer>
    </div>
  );
}
