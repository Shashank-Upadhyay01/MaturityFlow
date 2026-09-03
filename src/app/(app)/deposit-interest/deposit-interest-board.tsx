'use client';

import {
  Download,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import {
  applyInterest,
  DEFAULT_INTEREST_BPS,
  DEPOSIT_INTEREST_EXPORT_HEADERS,
  DEPOSIT_INTEREST_HEADERS,
  formatBpsAsPercent,
  formatShare,
  parseDepositInterestGrid,
  parsePercentToBps,
  summariseDepositInterest,
  type DepositRow,
} from '@/lib/deposit-interest';
import { formatPaise, paiseToDecimalString, tryParseRupeesToPaise } from '@/lib/money';
import { cn } from '@/lib/utils';
import { formatDMY, type ISODate } from '@/lib/working-days';

export interface SeedDeposit {
  id: string;
  name: string;
  depositedPaise: string;
  maturityOn: string | null;
  agentName?: string | null;
}

interface SheetRow {
  id: string;
  name: string;
  agentName: string;
  amountDraft: string;
  maturityOn: string;
}

type SortKey = 'amount' | 'name' | 'date';

const STORAGE_KEY = 'kggnl.deposit-interest.v4';
const BLANK_COUNT = 6;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function newId(): string {
  return crypto.randomUUID();
}

function draftFromPaise(paise: bigint): string {
  const s = paiseToDecimalString(paise);
  return s.endsWith('.00') ? s.slice(0, -3) : s;
}

function blankRows(count: number): SheetRow[] {
  return Array.from({ length: count }, () => ({ id: newId(), name: '', agentName: '', amountDraft: '', maturityOn: '' }));
}

function rowsFromSeed(seed: SeedDeposit[]): SheetRow[] {
  if (seed.length === 0) return blankRows(BLANK_COUNT);
  return [
    ...seed.map((row) => ({
      id: row.id,
      name: row.name,
      agentName: row.agentName?.trim() ?? '',
      amountDraft: draftFromPaise(BigInt(row.depositedPaise)),
      maturityOn: row.maturityOn && ISO.test(row.maturityOn) ? row.maturityOn : '',
    })),
    ...blankRows(2),
  ];
}

function isFilled(row: SheetRow): boolean {
  return (
    row.name.trim() !== '' ||
    row.agentName.trim() !== '' ||
    row.amountDraft.trim() !== '' ||
    row.maturityOn.trim() !== ''
  );
}

function toDepositRows(rows: SheetRow[]): DepositRow[] {
  const out: DepositRow[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    const depositedPaise = tryParseRupeesToPaise(row.amountDraft);
    if (!name || depositedPaise == null || depositedPaise <= 0n) continue;
    const maturityOn = ISO.test(row.maturityOn) ? (row.maturityOn as ISODate) : null;
    out.push({ name, depositedPaise, maturityOn, agentName: row.agentName.trim() || null });
  }
  return out;
}

function paiseToExcelNumber(paise: bigint): number {
  return Number(paiseToDecimalString(paise));
}

function ensureTrailingBlanks(rows: SheetRow[]): SheetRow[] {
  const trailing = [...rows].reverse().findIndex(isFilled);
  const emptyTail = trailing === -1 ? rows.length : trailing;
  if (emptyTail >= 2) return rows;
  return [...rows, ...blankRows(2 - emptyTail)];
}

function loadStored(): { rateDraft: string; rows: SheetRow[] } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rateDraft?: unknown; rows?: unknown };
    if (typeof parsed.rateDraft !== 'string' || !Array.isArray(parsed.rows)) return null;
    const rows: SheetRow[] = [];
    for (const item of parsed.rows) {
      if (!item || typeof item !== 'object') continue;
      const row = item as {
        id?: unknown;
        name?: unknown;
        agentName?: unknown;
        amountDraft?: unknown;
        maturityOn?: unknown;
      };
      if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.amountDraft !== 'string') continue;
      const maturityOn = typeof row.maturityOn === 'string' && ISO.test(row.maturityOn) ? row.maturityOn : '';
      const agentName = typeof row.agentName === 'string' ? row.agentName : '';
      rows.push({ id: row.id, name: row.name, agentName, amountDraft: row.amountDraft, maturityOn });
    }
    return { rateDraft: parsed.rateDraft, rows };
  } catch {
    return null;
  }
}

export function DepositInterestBoard({ seed, today }: { seed: SeedDeposit[]; today: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rateDraft, setRateDraft] = useState(formatBpsAsPercent(DEFAULT_INTEREST_BPS));
  const [rows, setRows] = useState<SheetRow[]>(() => blankRows(BLANK_COUNT));
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('amount');
  const [hydrated, setHydrated] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadStored();
    if (saved && saved.rows.some(isFilled)) {
      setRateDraft(saved.rateDraft || formatBpsAsPercent(DEFAULT_INTEREST_BPS));
      setRows(ensureTrailingBlanks(saved.rows));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ rateDraft, rows }));
    } catch {
      /* private mode / quota — the sheet still works for this visit */
    }
  }, [hydrated, rateDraft, rows]);

  const rateBps = parsePercentToBps(rateDraft) ?? DEFAULT_INTEREST_BPS;
  const rateValid = parsePercentToBps(rateDraft) != null;
  const deposits = useMemo(() => toDepositRows(rows), [rows]);
  const insights = useMemo(
    () => summariseDepositInterest(deposits, rateBps, { asOf: today as ISODate }),
    [deposits, rateBps, today],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const decorated = rows.map((row) => {
      const depositedPaise = tryParseRupeesToPaise(row.amountDraft);
      const line =
        row.name.trim() && depositedPaise != null && depositedPaise > 0n
          ? applyInterest([{
              name: row.name,
              agentName: row.agentName.trim() || null,
              depositedPaise,
              maturityOn: ISO.test(row.maturityOn) ? (row.maturityOn as ISODate) : null,
            }], rateBps)[0]
          : undefined;
      return { row, depositedPaise, line };
    });
    const filtered = needle
      ? decorated.filter(
          (item) =>
            item.row.name.toLowerCase().includes(needle) ||
            item.row.agentName.toLowerCase().includes(needle),
        )
      : decorated;
    const filled = filtered.filter((item) => isFilled(item.row));
    const blanks = filtered.filter((item) => !isFilled(item.row));
    filled.sort((a, b) => {
      if (sort === 'name') return a.row.name.localeCompare(b.row.name, 'en-IN');
      if (sort === 'date') {
        const ad = a.row.maturityOn || '9999-99-99';
        const bd = b.row.maturityOn || '9999-99-99';
        if (ad !== bd) return ad < bd ? -1 : 1;
      }
      const av = a.depositedPaise ?? -1n;
      const bv = b.depositedPaise ?? -1n;
      if (av === bv) return a.row.name.localeCompare(b.row.name, 'en-IN');
      return av < bv ? 1 : -1;
    });
    return [...filled, ...blanks];
  }, [query, rateBps, rows, sort]);

  const updateRow = useCallback((id: string, patch: Partial<SheetRow>) => {
    setRows((current) =>
      ensureTrailingBlanks(current.map((row) => (row.id === id ? { ...row, ...patch } : row))),
    );
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return ensureTrailingBlanks(next.length > 0 ? next : blankRows(BLANK_COUNT));
    });
  }, []);

  async function downloadWorkbook() {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Deposit interest', { views: [{ state: 'frozen', ySplit: 1 }] });
    const live = applyInterest(deposits, rateBps);
    if (live.length === 0) {
      ws.addRow([...DEPOSIT_INTEREST_HEADERS]);
      ws.getRow(1).font = { bold: true };
      ws.addRow(['Sample Customer', 'Agent Name', '29/08/2026', 100000]);
    } else {
      ws.addRow([...DEPOSIT_INTEREST_EXPORT_HEADERS]);
      ws.getRow(1).font = { bold: true };
      for (const line of live) {
        ws.addRow([
          line.name,
          line.agentName ?? '',
          line.maturityOn ? formatDMY(line.maturityOn) : '',
          paiseToExcelNumber(line.depositedPaise),
          paiseToExcelNumber(line.interestPaise),
          paiseToExcelNumber(line.maturityPaise),
          formatBpsAsPercent(rateBps),
        ]);
      }
    }
    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 28 : 22;
    });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = live.length === 0 ? 'deposit-interest-template.xlsx' : 'deposit-interest.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onUpload(file: File) {
    setImportBusy(true);
    setImportNote(null);
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
      const parsed = parseDepositInterestGrid(grid);
      if (parsed.rows.length === 0) {
        const message = parsed.errors[0] ?? 'No customer deposits were found in that file.';
        setImportNote(message);
        toast.error(message);
        return;
      }
      setRows(
        ensureTrailingBlanks(
          parsed.rows.map((row) => ({
            id: newId(),
            name: row.name,
            agentName: row.agentName ?? '',
            amountDraft: draftFromPaise(row.depositedPaise),
            maturityOn: row.maturityOn ?? '',
          })),
        ),
      );
      const note = `Loaded ${parsed.rows.length} customer${parsed.rows.length === 1 ? '' : 's'} from ${file.name}`;
      setImportNote(note);
      toast.success(note, {
        description: parsed.errors.length ? `${parsed.errors.length} row${parsed.errors.length === 1 ? '' : 's'} skipped` : undefined,
      });
      if (parsed.errors.length) {
        for (const error of parsed.errors.slice(0, 4)) toast.message(error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read that file';
      setImportNote(message);
      toast.error(message);
    } finally {
      setImportBusy(false);
    }
  }

  const plusDelta = insights.plus25BpsInterestPaise - insights.interestPaise;
  const minusDelta = insights.interestPaise - insights.minus25BpsInterestPaise;
  const skewed = insights.lineCount >= 3 && insights.averageDepositPaise > insights.medianDepositPaise * 2n;

  return (
    <>
    <div className="space-y-3 print:hidden">
      <Glass className="px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]">
            Rate
          </p>
          <div className="relative">
            <input
              aria-label="Interest rate percent"
              inputMode="decimal"
              autoComplete="off"
              value={rateDraft}
              onChange={(event) => setRateDraft(event.target.value)}
              onBlur={() => {
                const parsed = parsePercentToBps(rateDraft);
                if (parsed != null) setRateDraft(formatBpsAsPercent(parsed));
              }}
              className={cn(
                'mf-input tnum h-8 w-[8rem] py-1 pr-8 text-right text-[0.9375rem] font-semibold tracking-[-0.02em]',
                !rateValid && rateDraft.trim() !== '' && 'aria-[invalid]:border-[var(--color-danger-500)]',
              )}
              aria-invalid={rateDraft.trim() !== '' && !rateValid}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.75rem] font-semibold text-[var(--faint-fg)]">
              %
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRateDraft(formatBpsAsPercent(DEFAULT_INTEREST_BPS))}
            disabled={rateBps === DEFAULT_INTEREST_BPS && rateDraft === formatBpsAsPercent(DEFAULT_INTEREST_BPS)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            8.50%
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" variant="glass" size="sm" onClick={() => void downloadWorkbook()}>
              <Download className="h-3.5 w-3.5" />
              Download Excel
            </Button>
            <Button
              type="button"
              variant="glass"
              size="sm"
              className="print:hidden"
              onClick={() => window.print()}
              disabled={insights.lineCount === 0}
            >
              <Download className="h-3.5 w-3.5" />
              Save as PDF
            </Button>
            <label className="inline-flex">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                aria-label="Upload deposit interest workbook"
                className="sr-only"
                disabled={importBusy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onUpload(file);
                  event.target.value = '';
                }}
              />
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={importBusy}
                  onClick={(event) => {
                    const input = event.currentTarget.parentElement?.parentElement?.querySelector('input[type=file]');
                    if (input instanceof HTMLInputElement) input.click();
                  }}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Excel
                </Button>
              </span>
            </label>
          </div>
        </div>
        {importNote && (
          <p className="mt-1.5 text-[0.75rem] text-[var(--muted-fg)]" data-import-note>
            {importNote}
          </p>
        )}
      </Glass>

      {insights.lineCount === 0 && (
        <Glass className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-[var(--muted-fg)]">
            Type customer names and deposits below, or upload the Excel template. Totals and
            briefing appear as soon as the book has a row.
            {seed.length > 0
              ? ` ${seed.length} upcoming deposit${seed.length === 1 ? '' : 's'} from the maturity forecast can be loaded in one click.`
              : ''}
          </p>
          {seed.length > 0 && (
            <Button type="button" variant="primary" onClick={() => setRows(rowsFromSeed(seed))}>
              Load {seed.length} upcoming
            </Button>
          )}
        </Glass>
      )}

      {insights.lineCount > 0 && (
        <>
      <Glass className="p-0">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 sm:divide-x max-sm:divide-y">
          <Figure
            label="Deposited"
            value={<Money paise={insights.depositedPaise} decimals={false} />}
            hint={`${insights.lineCount} deposit${insights.lineCount === 1 ? '' : 's'} · ${insights.customerCount} customer${insights.customerCount === 1 ? '' : 's'}`}
          />
          <Figure
            label={`Interest at ${formatBpsAsPercent(rateBps)}%`}
            value={<Money paise={insights.interestPaise} decimals={false} tone="money" />}
            hint="What the book earns at this rate"
          />
          <Figure
            label="With interest"
            value={<Money paise={insights.maturityPaise} decimals={false} />}
            hint="Deposited amount plus interest"
          />
          <Figure
            label="Typical deposit"
            value={<Money paise={insights.medianDepositPaise} decimals={false} />}
            hint={`Average ${formatPaise(insights.averageDepositPaise, { decimals: false })}`}
          />
        </div>
      </Glass>

          <Glass className="px-5 py-4 sm:px-6">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]">
              Briefing
            </p>
            <p className="mt-2 text-[0.9375rem] leading-relaxed">
              At {formatBpsAsPercent(rateBps)}%,{' '}
              <span className="font-semibold">{formatPaise(insights.depositedPaise, { decimals: false })}</span>
              {' '}deposited becomes{' '}
              <span className="font-semibold">{formatPaise(insights.maturityPaise, { decimals: false })}</span>
              {' '}— {formatPaise(insights.interestPaise, { decimals: false })} of interest across{' '}
              {insights.customerCount} customer{insights.customerCount === 1 ? '' : 's'}.
              {insights.largest ? (
                <>
                  {' '}The largest holding is{' '}
                  <span className="font-semibold">{insights.largest.name}</span>
                  {' '}at {formatPaise(insights.largest.depositedPaise, { decimals: false })}{' '}
                  ({formatShare(insights.largest.shareBps)} of the book). The top 5 hold{' '}
                  {formatShare(insights.top5ShareBps)}; the top 10 hold {formatShare(insights.top10ShareBps)}.
                </>
              ) : null}
              {' '}After interest, {insights.dailyCadenceCount === 1
                ? '1 deposit sits'
                : `${insights.dailyCadenceCount} deposits sit`}{' '}
              at or above ₹1,00,000 and would pay every working day
              {insights.alternateCadenceCount === 0
                ? '.'
                : `; ${insights.alternateCadenceCount} would pay on alternate working days inside the same window.`}
              {insights.nextOn ? (
                <>
                  {' '}The next dated maturity is {formatDMY(insights.nextOn)}
                  {insights.latestOn && insights.latestOn !== insights.nextOn
                    ? `, running through ${formatDMY(insights.latestOn)}`
                    : ''}
                  {' '}({insights.datedCount} dated
                  {insights.undatedCount > 0 ? `, ${insights.undatedCount} without a date` : ''}).
                </>
              ) : insights.earliestOn ? (
                <>
                  {' '}Dated maturities ran {formatDMY(insights.earliestOn)}
                  {insights.latestOn && insights.latestOn !== insights.earliestOn
                    ? ` to ${formatDMY(insights.latestOn)}`
                    : ''}
                  .
                </>
              ) : insights.undatedCount > 0 ? (
                <> None of the rows have a maturity date yet.</>
              ) : null}
            </p>
            {skewed && (
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[var(--muted-fg)]">
                The average is more than twice the median — a few large deposits are pulling the
                book up. The median is the better picture of a typical customer.
              </p>
            )}
          </Glass>

          <div className="grid gap-3 lg:grid-cols-3">
            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">Book shape</h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">Deposits grouped by size</p>
              </div>
              <ul className="divide-y">
                {insights.bands.map((band) => (
                  <li key={band.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[0.8125rem] font-medium">{band.label}</p>
                      <p className="tnum text-[0.8125rem] text-[var(--muted-fg)]">
                        {band.count} · {formatShare(band.shareBps)}
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg-subtle)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-brand-600)]"
                        style={{ width: `${Math.max(band.shareBps === 0 ? 0 : 4, band.shareBps / 100)}%` }}
                      />
                    </div>
                    <p className="mt-1.5 tnum text-[0.75rem] text-[var(--faint-fg)]">
                      {formatPaise(band.depositedPaise, { decimals: false })}
                    </p>
                  </li>
                ))}
              </ul>
            </Glass>

            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">Concentration</h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">How much of the book sits with a few names</p>
              </div>
              <dl className="divide-y">
                <InsightRow
                  label="Largest customer"
                  value={insights.largest ? formatPaise(insights.largest.depositedPaise, { decimals: false }) : '—'}
                  hint={insights.largest ? `${insights.largest.name} · ${formatShare(insights.largest.shareBps)}` : undefined}
                />
                <InsightRow label="Top 5 share" value={formatShare(insights.top5ShareBps)} />
                <InsightRow label="Top 10 share" value={formatShare(insights.top10ShareBps)} />
                <InsightRow
                  label="Customers"
                  value={String(insights.customerCount)}
                  hint={
                    insights.customerCount !== insights.lineCount
                      ? `${insights.lineCount} deposit lines — some customers appear more than once`
                      : 'One line each'
                  }
                />
              </dl>
            </Glass>

            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">Payout cadence</h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">
                  ₹1 lakh rule, applied to amount with interest
                </p>
              </div>
              <dl className="divide-y">
                <InsightRow
                  label="Every working day"
                  value={`${insights.dailyCadenceCount}`}
                  hint={formatPaise(insights.dailyCadenceMaturityPaise, { decimals: false })}
                />
                <InsightRow
                  label="Alternate working days"
                  value={`${insights.alternateCadenceCount}`}
                  hint={formatPaise(insights.alternateCadenceMaturityPaise, { decimals: false })}
                />
                <InsightRow
                  label={`+0.25% interest`}
                  value={formatPaise(plusDelta, { decimals: false })}
                  hint={`Total interest ${formatPaise(insights.plus25BpsInterestPaise, { decimals: false })}`}
                />
                <InsightRow
                  label={`−0.25% interest`}
                  value={formatPaise(minusDelta, { decimals: false })}
                  hint={`Total interest ${formatPaise(insights.minus25BpsInterestPaise, { decimals: false })}`}
                />
              </dl>
            </Glass>
          </div>

          {insights.months.length > 0 && (
            <Glass className="p-0">
              <div className="border-b px-5 py-3">
                <h2 className="text-[0.9375rem] font-semibold tracking-tight">When they mature</h2>
                <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">
                  Dated deposits by month
                  {insights.pastCount > 0 ? ` · ${insights.pastCount} already past` : ''}
                  {insights.undatedCount > 0 ? ` · ${insights.undatedCount} without a date` : ''}
                </p>
              </div>
              <ul className="divide-y">
                {insights.months.map((month) => (
                  <li key={month.month} className="flex items-baseline justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-[0.8125rem] font-medium">{month.label}</p>
                      <p className="tnum mt-0.5 text-[0.75rem] text-[var(--faint-fg)]">
                        {month.count} deposit{month.count === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="tnum text-[0.875rem] font-semibold">
                      {formatPaise(month.depositedPaise, { decimals: false })}
                    </p>
                  </li>
                ))}
              </ul>
            </Glass>
          )}
        </>
      )}

      <Glass className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold tracking-tight">Deposit book</h2>
            <p className="mt-0.5 text-[0.75rem] text-[var(--muted-fg)]">
              Customer name, maturity date, deposited amount, amount with interest at {formatBpsAsPercent(rateBps)}%
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a customer"
                className="h-8 pl-10 text-[0.8125rem]"
              />
            </div>
            <Button
              type="button"
              variant={sort === 'amount' ? 'glass' : 'ghost'}
              size="sm"
              onClick={() => setSort('amount')}
            >
              By amount
            </Button>
            <Button
              type="button"
              variant={sort === 'name' ? 'glass' : 'ghost'}
              size="sm"
              onClick={() => setSort('name')}
            >
              A–Z
            </Button>
            <Button
              type="button"
              variant={sort === 'date' ? 'glass' : 'ghost'}
              size="sm"
              onClick={() => setSort('date')}
            >
              By date
            </Button>
            {seed.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rowsFromSeed(seed))}>
                Load upcoming
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRows(blankRows(BLANK_COUNT))}
              disabled={!rows.some(isFilled)}
            >
              Clear
            </Button>
            <Button type="button" variant="glass" size="sm" onClick={() => setRows((current) => [...current, ...blankRows(1)])}>
              <Plus className="h-3.5 w-3.5" />
              Row
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] table-fixed text-left">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr className="border-b text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                <th className="px-4 py-2.5 sm:px-5">Customer name</th>
                <th className="px-3 py-2.5">Agent name</th>
                <th className="px-3 py-2.5">Maturity date</th>
                <th className="px-3 py-2.5 text-right">Total deposited</th>
                <th className="px-3 py-2.5 text-right">With {formatBpsAsPercent(rateBps)}%</th>
                <th className="px-2 py-2.5"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, line }) => {
                const amountError =
                  row.amountDraft.trim() !== '' && tryParseRupeesToPaise(row.amountDraft) == null;
                return (
                  <tr key={row.id} className="border-b border-[var(--hairline)] last:border-0">
                    <td className="px-3 py-1.5 sm:px-4">
                      <input
                        aria-label="Customer name"
                        value={row.name}
                        onChange={(event) => updateRow(row.id, { name: event.target.value })}
                        placeholder="Customer name"
                        className="mf-input h-9 border-transparent bg-transparent px-2 text-[0.9375rem] hover:border-[var(--input-border)]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        aria-label={`Agent for ${row.name || 'this customer'}`}
                        value={row.agentName}
                        onChange={(event) => updateRow(row.id, { agentName: event.target.value })}
                        placeholder="Agent name"
                        className="mf-input h-9 border-transparent bg-transparent px-2 text-[0.8125rem] hover:border-[var(--input-border)]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        aria-label={`Maturity date for ${row.name || 'this customer'}`}
                        value={row.maturityOn}
                        onChange={(event) => updateRow(row.id, { maturityOn: event.target.value })}
                        className="mf-input tnum h-9 border-transparent bg-transparent px-2 text-[0.8125rem] hover:border-[var(--input-border)]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[0.8125rem] text-[var(--faint-fg)]">
                          ₹
                        </span>
                        <input
                          aria-label={`Total deposited amount for ${row.name || 'this customer'}`}
                          inputMode="decimal"
                          autoComplete="off"
                          value={row.amountDraft}
                          onChange={(event) => updateRow(row.id, { amountDraft: event.target.value })}
                          placeholder="Amount"
                          aria-invalid={amountError}
                          className="mf-input tnum h-9 border-transparent bg-transparent py-0 pl-6 pr-2 text-right text-[0.9375rem] font-medium hover:border-[var(--input-border)]"
                        />
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {line ? (
                        <div className="flex items-baseline justify-end gap-2 pr-1">
                          <Money paise={line.maturityPaise} decimals={false} className="text-[0.9375rem] font-semibold" />
                          <span
                            className="tnum text-[0.6875rem] text-[var(--color-money-700)] dark:text-[var(--color-money-400)]"
                            title={line.largeCase ? 'At or above ₹1,00,000 — daily payout cadence' : undefined}
                          >
                            +{formatPaise(line.interestPaise, { decimals: false })}
                          </span>
                        </div>
                      ) : (
                        <span className="pr-1 text-[0.8125rem] text-[var(--faint-fg)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {isFilled(row) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Remove ${row.name || 'row'}`}
                          onClick={() => removeRow(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Glass>
    </div>

      <section className="hidden print:block">
        <h1 className="text-xl font-semibold">Deposit interest at {formatBpsAsPercent(rateBps)}%</h1>
        <p className="mt-1 text-sm">
          Deposited {formatPaise(insights.depositedPaise, { decimals: false })} · Interest{' '}
          {formatPaise(insights.interestPaise, { decimals: false })} · With interest{' '}
          {formatPaise(insights.maturityPaise, { decimals: false })}
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Agent</th>
              <th>Maturity</th>
              <th className="text-right">Deposited</th>
              <th className="text-right">With interest</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter(isFilled).map((row) => {
              const depositedPaise = tryParseRupeesToPaise(row.amountDraft);
              const line =
                row.name.trim() && depositedPaise != null && depositedPaise > 0n
                  ? applyInterest(
                      [
                        {
                          name: row.name,
                          agentName: row.agentName.trim() || null,
                          depositedPaise,
                          maturityOn: ISO.test(row.maturityOn) ? (row.maturityOn as ISODate) : null,
                        },
                      ],
                      rateBps,
                    )[0]
                  : null;
              return (
                <tr key={`print-${row.id}`}>
                  <td>{row.name}</td>
                  <td>{row.agentName}</td>
                  <td>{row.maturityOn ? formatDMY(row.maturityOn) : ''}</td>
                  <td className="text-right">
                    {depositedPaise != null ? formatPaise(depositedPaise, { decimals: false }) : ''}
                  </td>
                  <td className="text-right">
                    {line ? formatPaise(line.maturityPaise, { decimals: false }) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="px-5 py-4 sm:px-6">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]">
        {label}
      </p>
      <div className="mt-1.5 text-[1.35rem] font-semibold tracking-[-0.02em]">{value}</div>
      {hint && <p className="mt-1 text-[0.75rem] leading-snug text-[var(--muted-fg)]">{hint}</p>}
    </div>
  );
}

function InsightRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 py-3">
      <dt className="min-w-0 text-[0.8125rem] text-[var(--muted-fg)]">{label}</dt>
      <dd className="text-right">
        <p className="tnum text-[0.875rem] font-semibold">{value}</p>
        {hint && <p className="mt-0.5 text-[0.6875rem] text-[var(--faint-fg)]">{hint}</p>}
      </dd>
    </div>
  );
}
