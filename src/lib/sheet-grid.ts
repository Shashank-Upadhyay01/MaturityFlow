/**
 * sheet-grid.ts — spreadsheet addressing and clipboard for the Operations / Register sheets.
 *
 * Pure: no DOM, no clock, no I/O. Money still saves through the audited single-row path;
 * this module only decides which cells a paste covers and how Excel text becomes values.
 */

/** 0 → A, 25 → Z, 26 → AA. Same numbering Excel uses. */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0) return '';
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** A1-style address. Row is 1-based. */
export function cellAddress(colIndex: number, rowIndex: number): string {
  if (rowIndex < 0) return columnLetter(colIndex);
  return `${columnLetter(colIndex)}${rowIndex + 1}`;
}

export function parseClipboardGrid(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (raw.trim() === '') return [];
  const lines = raw.endsWith('\n') ? raw.slice(0, -1).split('\n') : raw.split('\n');
  return lines.map((line) => splitTsvLine(line));
}

function splitTsvLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((cell) => cell.trim());
  if (line.includes(',') && !/^\d{1,3}(,\d{2,3})+$/.test(line.replace(/^₹/, ''))) {
    return splitCsvLine(line);
  }
  return [line.trim()];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function serializeClipboardGrid(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((cell) => cell.replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
}

/** Whole rupees from Excel / a typed cell. Strips ₹, commas and paise tails. */
export function pasteRupees(raw: string): string {
  const t = raw.trim().replace(/^[₹Rs.\s]+/i, '').replace(/,/g, '');
  if (t === '') return '';
  const n = t.replace(/\.0+$/, '');
  if (!/^\d+$/.test(n)) return '';
  return n;
}

/**
 * Dates staff paste from Excel: 2026-09-01, 01/09/2026, 1-9-26, 01-Sep-2026.
 * Ambiguous 01/02/2026 is read as Indian D/M/Y.
 */
export function pasteIsoDate(raw: string): string | null {
  const t = raw.trim();
  if (t === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const isoish = t.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (isoish) return ymd(Number(isoish[1]), Number(isoish[2]), Number(isoish[3]));
  const dmy = t.match(/^(\d{1,2})[/.+-](\d{1,2})[/.+-](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return ymd(year, Number(dmy[2]), Number(dmy[1]));
  }
  return null;
}

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

export interface SheetRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export function normalizeRange(a: { r: number; c: number }, b: { r: number; c: number }): SheetRange {
  return {
    r0: Math.min(a.r, b.r),
    c0: Math.min(a.c, b.c),
    r1: Math.max(a.r, b.r),
    c1: Math.max(a.c, b.c),
  };
}

export function cellsInRange(range: SheetRange): { r: number; c: number }[] {
  const out: { r: number; c: number }[] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    for (let c = range.c0; c <= range.c1; c++) out.push({ r, c });
  }
  return out;
}

export function rowMatchesFilter(
  haystack: readonly string[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return haystack.some((part) => part.toLowerCase().includes(q));
}
