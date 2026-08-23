'use client';

import { FileSpreadsheet, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { importRegisterAction } from '@/actions/import';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';

export function RegisterImport({
  branches,
  defaultBranchId,
}: {
  branches: { id: string; code: string; name: string }[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(defaultBranchId ?? branches[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

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
      const { created, skipped, warnings, errors } = r.data;
      toast.success(`Imported ${created} cases`, { description: skipped ? `${skipped} skipped` : undefined });
      setLog([
        `${created} created, ${skipped} skipped.`,
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

  return (
    <Glass className="p-5">
      <p className="text-[1.0625rem] font-semibold">Import the current Excel register</p>
      <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">
        Download the template, or upload the existing MATURITY.xlsx. The engine will build a
        day-by-day plan for every remaining rupee so the cash planner can see each date.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Load into branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} — {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button asChild variant="glass">
          <a href="/api/export/template">
            <FileSpreadsheet className="h-4 w-4" />
            Download template
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
