import { redirect } from 'next/navigation';

import { PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { listAllBugReports, listAppUpdates, listOwnBugReports } from '@/services/whats-new-service';
import { WhatsNewBoard } from './whats-new-board';

export const metadata = { title: "What's new" };
export const dynamic = 'force-dynamic';

export default async function WhatsNewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'case.view')) redirect('/dashboard');
  const params = await searchParams;

  const actor = toActor(session);
  const canWriteUpdates = roleCan(session.role, 'updates.manage');
  const canManageBugs = roleCan(session.role, 'bug.manage');

  const updates = await listAppUpdates();
  const mine = await listOwnBugReports(actor);
  const reports = canManageBugs ? await listAllBugReports(actor) : [];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-3">
      <PageHeader
        compact
        eyebrow="Help"
        title="What's new"
        description="What changed in this app, on which day and at what time — written in everyday words. If something goes wrong, tell us here."
      />
      <WhatsNewBoard
        tab={params.tab === 'problem' || (params.tab === 'inbox' && canManageBugs) ? params.tab : 'news'}
        canWriteUpdates={canWriteUpdates}
        canManageBugs={canManageBugs}
        updates={updates.map((row) => ({
          id: row.id,
          title: row.title,
          body: row.body,
          kind: row.kind,
          publishedAt: row.publishedAt.toISOString(),
          authorName: row.authorName,
        }))}
        mine={mine.map((row) => ({
          id: row.id,
          screen: row.screen,
          tryingTo: row.tryingTo,
          whatHappened: row.whatHappened,
          extra: row.extra,
          severity: row.severity,
          status: row.status,
          adminNote: row.adminNote,
          createdAt: row.createdAt.toISOString(),
        }))}
        reports={reports.map((row) => ({
          id: row.id,
          screen: row.screen,
          tryingTo: row.tryingTo,
          whatHappened: row.whatHappened,
          extra: row.extra,
          severity: row.severity,
          status: row.status,
          adminNote: row.adminNote,
          pagePath: row.pagePath,
          reporterRole: row.reporterRole,
          userAgent: row.userAgent,
          createdAt: row.createdAt.toISOString(),
          reporterName: row.reporterName,
        }))}
      />
    </div>
  );
}
