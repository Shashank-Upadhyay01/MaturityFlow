'use client';

import { Building2, CalendarDays, FileSpreadsheet, Network, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { importMaturityForecastAction, importRegisterAction } from '@/actions/import';
import { ALL_BRANCHES } from '@/lib/branch-routing';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';

export function RegisterImport({
  branches,
  defaultBranchId,
  canImportAll,
  headBranchId,
}: {
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
  canImportAll: boolean;
  headBranchId: string | null;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [forecastBusy, setForecastBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const compiled = branchId === ALL_BRANCHES;

  async function onFile(file: File) {
    if (!branchId) return toast.error('Choose a branch first');
    setBusy(true);
    setLog([]);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error('No worksheet in that file');
      const grid: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const line: unknown[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          line[col - 1] = cell.value;
        });
        grid.push(line);
      });
      const r = await importRegisterAction(branchId, grid);
      if (!r.ok) {
        toast.error(r.error);
        setBusy(false);
        return;
      }
      const { created, skipped, warnings, errors, branches: importedBranches } = r.data;
      toast.success(`Imported ${created} cases`, { description: skipped ? `${skipped} skipped` : undefined });
      setLog([
        `${created} created, ${skipped} skipped.`,
        ...importedBranches.map(
          (branch) =>
            `${branch.branchCode} — ${branch.branchName}: ${branch.created} imported, ${branch.skipped} skipped`,
        ),
        ...errors,
        ...warnings.slice(0, 30),
        warnings.length > 30 ? `…and ${warnings.length - 30} more notes` : '',
      ].filter(Boolean));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read that file');
    }
    setBusy(false);
  }

  async function onForecastFile(file: File) {
    const targetBranchId = compiled ? headBranchId : branchId;
    if (!targetBranchId) return toast.error('Choose a branch first');
    setForecastBusy(true);
    setLog([]);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const sheets = wb.worksheets.map((ws) => {
        const rows: unknown[][] = [];
        ws.eachRow({ includeEmpty: false }, (row) => {
          const line: unknown[] = [];
          row.eachCell({ includeEmpty: true }, (cell, col) => { line[col - 1] = cell.value; });
          rows.push(line);
        });
        return { name: ws.name, rows };
      });
      const response = await importMaturityForecastAction(targetBranchId, file.name, sheets);
      if (!response.ok) return toast.error(response.error);
      const { created, updated, removed, parsed, errors, warnings } = response.data;
      toast.success(`Loaded ${parsed} upcoming maturities`, {
        description: `${created} new · ${updated} refreshed`,
      });
      setLog([
        `${parsed} forecast rows loaded: ${created} new, ${updated} refreshed${removed ? `, ${removed} stale rows replaced` : ''}.`,
        ...errors,
        ...warnings,
      ]);
      router.push('/maturity-calendar');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read that forecast workbook');
    } finally {
      setForecastBusy(false);
    }
  }

  return (
    <Glass className="p-5">
      <p className="text-[1.0625rem] font-semibold">Import maturity registers</p>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
        Upload one branch sheet, or let headquarters route a compiled workbook automatically.
        Every imported row keeps its branch ownership across the register, reports and payouts.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Import destination">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {canImportAll && (
              <option value={ALL_BRANCHES}>All branches — auto-sort by Branch Code</option>
            )}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}{b.id === headBranchId ? ' (Head branch)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Button asChild variant="glass">
          <a href={compiled ? '/api/export/template?scope=all' : `/api/export/template?branch=${branchId}`}>
            <FileSpreadsheet className="h-4 w-4" />
            {compiled ? 'Download compiled template' : 'Download branch template'}
          </a>
        </Button>
        <label className="inline-flex">
          <input
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <span className="inline-flex">
            <Button type="button" variant="primary" loading={busy} onClick={(ev) => {
              (ev.currentTarget.parentElement?.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null)?.click();
            }}>
              <Upload className="h-4 w-4" />
              Upload Excel
            </Button>
          </span>
        </label>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.75fr)]">
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-solid)] p-3.5">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
            {compiled ? <Network className="h-4 w-4 text-[var(--color-brand-500)]" /> : <Building2 className="h-4 w-4 text-[var(--color-brand-500)]" />}
            {compiled ? 'Automatic branch routing' : 'Single-branch import'}
          </p>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
            {compiled
              ? 'Each row must contain Branch Code (recommended) or an exact Branch Name. Blank or unknown branches are skipped and listed after import—never guessed.'
              : 'Every row is assigned to the selected branch. Use this for the existing branch-specific MATURITY.xlsx format.'}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--hairline)] bg-[var(--surface-solid)] p-3.5">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
            Active branch codes
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {branches.map((branch) => (
              <span key={branch.id} className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[0.75rem] font-medium">
                {branch.code} → {branch.name}{branch.id === headBranchId ? ' · Head' : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--surface-solid)] p-3.5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[0.8125rem] font-semibold"><CalendarDays className="h-4 w-4 text-[var(--color-brand-500)]" />Upcoming maturity forecast</p>
          <p className="mt-1 text-[0.75rem] text-[var(--muted-fg)]">For monthly workbooks with MaturityDate and maturity amounts. August uses MaturityAmount; later months use Current Maturity Amount. Imported to {branches.find((item) => item.id === (compiled ? headBranchId : branchId))?.code ?? 'the selected branch'}.</p>
        </div>
        <label className="inline-flex shrink-0">
          <input type="file" accept=".xlsx,.xls" className="sr-only" disabled={forecastBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onForecastFile(file); event.target.value = ''; }} />
          <span className="inline-flex"><Button type="button" variant="glass" loading={forecastBusy} onClick={(event) => { (event.currentTarget.parentElement?.parentElement?.querySelector('input[type=file]') as HTMLInputElement | null)?.click(); }}><CalendarDays className="h-4 w-4" />Upload maturity forecast</Button></span>
        </label>
      </div>
      {log.length > 0 && (
        <ul className="mt-4 max-h-48 space-y-1 overflow-auto text-[0.8125rem] text-[var(--muted-fg)]">
          {log.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </Glass>
  );
}
