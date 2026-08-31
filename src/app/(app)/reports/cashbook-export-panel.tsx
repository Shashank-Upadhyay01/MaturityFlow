'use client';

import { Building2, CalendarDays, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';

interface BranchOption {
  id: string;
  code: string;
  name: string;
}

export function CashbookExportPanel({
  branches,
  today,
  initialBranchId,
}: {
  branches: BranchOption[];
  today: string;
  initialBranchId: string;
}) {
  const [branchId, setBranchId] = useState(initialBranchId || branches[0]?.id || '');
  const [date, setDate] = useState(today);
  const branch = useMemo(
    () => branches.find((option) => option.id === branchId) ?? branches[0],
    [branchId, branches],
  );
  const exportBase = branch
    ? `/api/export/cashbook?branchId=${encodeURIComponent(branch.id)}&date=${encodeURIComponent(date)}`
    : null;

  return (
    <Glass className="overflow-hidden p-0">
      <div className="border-b px-5 py-4 sm:px-6">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Daily cashbook</h2>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
          Choose the branch and business date once, then download the same reconciliation in the
          format you need.
        </p>
      </div>

      <div className="grid gap-4 border-b px-5 py-4 sm:grid-cols-2 sm:px-6">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--muted-fg)]">
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            Branch
          </span>
          <select
            value={branch?.id ?? ''}
            onChange={(event) => setBranchId(event.target.value)}
            className="h-10 w-full rounded-[11px] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[0.875rem] outline-none transition-[border-color,box-shadow] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-brand-500)_20%,transparent)]"
          >
            {branches.map((option) => (
              <option key={option.id} value={option.id}>
                {option.code} · {option.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-[0.75rem] font-medium text-[var(--muted-fg)]">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            Business date
          </span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            className="h-10 w-full rounded-[11px] border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-[0.875rem] outline-none transition-[border-color,box-shadow] focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-brand-500)_20%,transparent)]"
          />
        </label>
      </div>

      <div className="grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ExportChoice
          icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
          title="Cashbook workbook"
          body="Formatted sheet with entries, note count, named items and reconciliation."
          href={exportBase ? `${exportBase}&format=xlsx` : null}
          primary
        />
        <ExportChoice
          icon={<FileText className="h-4 w-4" aria-hidden />}
          title="Cashbook data"
          body="Flat CSV for analysis, archiving or import into another reporting tool."
          href={exportBase ? `${exportBase}&format=csv` : null}
        />
        <ExportChoice
          icon={<Printer className="h-4 w-4" aria-hidden />}
          title="PDF / print"
          body="A4 working copy or approved close snapshot through the browser print dialog."
          href={branch ? `/cashbook/print?branch=${encodeURIComponent(branch.id)}&date=${encodeURIComponent(date)}` : null}
          actionLabel="Open"
        />
      </div>
    </Glass>
  );
}

function ExportChoice({
  icon,
  title,
  body,
  href,
  primary = false,
  actionLabel = 'Download',
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string | null;
  primary?: boolean;
  actionLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-4 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">{body}</p>
      </div>
      {href ? (
        <Button asChild variant={primary ? 'primary' : 'glass'} size="sm" className="self-end">
          <a href={href}>
            {icon}
            {actionLabel}
          </a>
        </Button>
      ) : (
        <Button disabled size="sm" className="self-end">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
