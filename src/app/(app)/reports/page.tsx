import { Download, FileSpreadsheet } from 'lucide-react';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Glass, PageHeader } from '@/components/ui/glass';
import { getSession } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';
import { addDays, todayISO } from '@/lib/working-days';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!roleCan(session.role, 'report.export')) redirect('/dashboard');

  const today = todayISO();
  const from = addDays(today, -90);
  const dailyTo = addDays(today, 45);

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
      title: 'Daily cash (Excel)',
      body: 'Cash vs online the counter must hold, day by day.',
    },
    {
      href: `/api/export/monthly?format=xlsx&from=${from}&to=${today}`,
      title: 'Monthly (Excel)',
      body: 'Month totals of given and remaining.',
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <PageHeader
        title="Reports"
        description="Downloads of the register. Remaining and paid on these files are the same figures as the sheet."
      />
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
