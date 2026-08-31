import { Download, FileSpreadsheet } from 'lucide-react';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { getSession, toActor } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';
import { getCashbookSummary } from '@/services/queries';
import { CashbookExportPanel } from './cashbook-export-panel';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'report.export')) redirect('/dashboard');

  const today = todayISO();
  const from = addDays(today, -90);
  const dailyTo = addDays(today, 45);
  const cashbooks = roleCan(session.role, 'cashbook.view')
    ? await getCashbookSummary(toActor(session), today)
    : null;

  const downloads = [
    {
      href: `/api/export/cases?format=xlsx&from=${from}&to=${today}`,
      title: 'Register (Excel)',
      body: 'Every row on the book for the last 90 days.',
      primary: true,
    },
    {
      href: `/api/export/cases?format=csv&from=${from}&to=${today}`,
      title: 'Register (CSV)',
      body: 'The same sheet, for a spreadsheet that is not Excel.',
    },
    {
      href: `/api/export/daily?format=xlsx&from=${today}&to=${dailyTo}`,
      title: 'Maturity payout plan — daily (Excel)',
      body: 'Scheduled maturity cash and online payouts, day by day. This is not the branch cashbook.',
    },
    {
      href: `/api/export/monthly?format=xlsx&from=${from}&to=${today}`,
      title: 'Monthly (Excel)',
      body: 'Month totals of given and remaining.',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader
        title="Reports"
        description="Controlled exports for both the maturity register and the separate branch daily cashbook."
      />
      {cashbooks && cashbooks.rows.length > 0 && (
        <CashbookExportPanel
          branches={cashbooks.rows.map((row) => row.branch)}
          today={today}
          initialBranchId={session.branchId ?? cashbooks.rows[0]?.branch.id ?? ''}
        />
      )}
      <div className="px-1 pt-1"><h2 className="text-[0.9375rem] font-semibold">Maturity register reports</h2></div>
      <div className="space-y-2">
        {downloads.map((d) => (
          <Glass key={d.href} className="flex items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{d.title}</p>
              <p className="mt-0.5 text-[0.8125rem] text-[var(--muted-fg)]">{d.body}</p>
            </div>
            <Button asChild variant={d.primary ? 'primary' : 'glass'} size="sm">
              <a href={d.href}>
                {d.primary ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                Download
              </a>
            </Button>
          </Glass>
        ))}
      </div>
    </div>
  );
}
