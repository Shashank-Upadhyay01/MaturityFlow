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

export type CellPos = { r: number; c: number };

export function cellsInRange(range: SheetRange): CellPos[] {
  const out: CellPos[] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    for (let c = range.c0; c <= range.c1; c++) out.push({ r, c });
  }
  return out;
}

export function cellKey(r: number, c: number): string {
  return `${r}:${c}`;
}

export function parseCellKey(key: string): CellPos | null {
  const match = /^(\d+):(\d+)$/.exec(key);
  if (!match) return null;
  return { r: Number(match[1]), c: Number(match[2]) };
}

export function rangeKeys(range: SheetRange): string[] {
  return cellsInRange(range).map((pos) => cellKey(pos.r, pos.c));
}

/** Ctrl-click: keep the current block, then add or remove this cell. */
export function toggleCellInSelection(
  extra: Iterable<string>,
  range: SheetRange | null,
  r: number,
  c: number,
): Set<string> {
  const next = new Set(extra);
  if (range) for (const key of rangeKeys(range)) next.add(key);
  const key = cellKey(r, c);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function unionSelection(range: SheetRange | null, extra: Iterable<string>): CellPos[] {
  const keys = new Set(extra);
  if (range) for (const key of rangeKeys(range)) keys.add(key);
  const out: CellPos[] = [];
  for (const key of keys) {
    const pos = parseCellKey(key);
    if (pos) out.push(pos);
  }
  out.sort((a, b) => a.r - b.r || a.c - b.c);
  return out;
}

export function selectionBounds(cells: readonly CellPos[]): SheetRange | null {
  if (cells.length === 0) return null;
  let r0 = cells[0]!.r;
  let c0 = cells[0]!.c;
  let r1 = r0;
  let c1 = c0;
  for (const pos of cells) {
    if (pos.r < r0) r0 = pos.r;
    if (pos.c < c0) c0 = pos.c;
    if (pos.r > r1) r1 = pos.r;
    if (pos.c > c1) c1 = pos.c;
  }
  return { r0, c0, r1, c1 };
}

export function cellInSelection(r: number, c: number, range: SheetRange | null, extra: ReadonlySet<string>): boolean {
  if (extra.has(cellKey(r, c))) return true;
  if (!range) return false;
  return r >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
}

export function rowMatchesFilter(
  haystack: readonly string[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return haystack.some((part) => part.toLowerCase().includes(q));
}

/**
 * Spreadsheet capacity, same ceiling as the daily cashbook.
 *
 * 500 rows are always available to type or paste into. The DOM only renders what has been
 * reached so a quiet day does not mount thousands of empty inputs. Live cases are never hidden
 * if the register is already longer than 500.
 */
export const MAX_SHEET_ROWS = 500;
export const INITIAL_SHEET_ROWS = 20;
export const ROW_REVEAL_BUFFER = 10;
/**
 * Each pasted row is still the audited single-row write, so a paste is a loop, not one UPDATE.
 * The loop runs on the server in chunks: one request per `PASTE_CHUNK_ROWS` rows, so a big
 * paste is a handful of round-trips instead of one per row, and no single request runs long
 * enough to hit a serverless timeout.
 */
export const MAX_PASTE_ROWS = 100;

/**
 * The register sheet pastes through one batched server action per chunk rather than one call
 * per row, so it can afford the whole 500-row capacity in a single paste.
 */
export const MAX_REGISTER_PASTE_ROWS = 500;
export const PASTE_CHUNK_ROWS = 25;

/**
 * Empty rows on the register sheet.
 *
 * The register is a book that grows: unlike a cashbook day it can already hold hundreds of live
 * rows, so capacity measured as "500 rows in total" quietly becomes "no empty rows at all" on a
 * branch that passed 500 cases — which is what sent clerks back to the Add rows button. Capacity
 * is therefore counted in EMPTY rows: 500 of them are always available underneath whatever is on
 * screen, however long the live list is.
 *
 * All 500 exist from the first paint. The register sheet virtualises them, so holding them costs
 * a number rather than the six thousand inputs that a dozen typed columns would otherwise mount.
 */
export const MAX_BLANK_ROWS = 500;

/**
 * Row height the virtualiser assumes for an empty row, in pixels.
 *
 * Empty rows are uniform — one line of inputs, no expander, no arrears sub-rows — so the
 * virtualiser never has to measure them, and the scrollbar is the right length on the first
 * paint rather than growing under the clerk's hand as rows are measured.
 */
export const BLANK_ROW_HEIGHT_PX = 28;

/**
 * How the OPERATIONS sheet sizes itself: live rows plus a runway of empty ones, capped at 500.
 *
 * The register no longer uses these — it holds all 500 empty rows and virtualises them. This
 * pair stays for the Operations grid, which renders every row it shows and so still reveals
 * them progressively.
 */
export function initialSheetLength(filledCount: number, max = MAX_SHEET_ROWS): number {
  const filled = Math.max(0, filledCount);
  if (filled >= max) return filled;
  return Math.min(max, Math.max(INITIAL_SHEET_ROWS, filled + INITIAL_SHEET_ROWS));
}

/**
 * How many rows the sheet should show once the highlight has moved onto `targetIndex`.
 *
 * Empty rows exist only in the browser. Walking off the bottom (or scrolling into it) reveals
 * another buffer of rows, up to `max`. Never shorter than the live rows; never shrinks.
 */
export function growSheetLength(input: {
  currentLength: number;
  filledCount: number;
  targetIndex: number;
  max?: number;
  buffer?: number;
}): number {
  const max = input.max ?? MAX_SHEET_ROWS;
  const buffer = input.buffer ?? ROW_REVEAL_BUFFER;
  const filled = Math.max(0, input.filledCount);
  const cap = Math.max(filled, max);
  const current = Math.max(filled, input.currentLength);
  const needed = Math.max(0, input.targetIndex) + 1;
  if (needed <= current) return Math.min(cap, current);
  return Math.min(cap, Math.max(current, needed + buffer));
}

export function blankRowCount(input: {
  sheetLength: number;
  filledCount: number;
  allowBlanks: boolean;
}): number {
  if (!input.allowBlanks) return 0;
  return Math.max(0, input.sheetLength - input.filledCount);
}

/**
 * Does this row carry enough to be a case?
 *
 * A maturity case is a person and their money. A pasted line that brought only an amount, or only
 * a date, has no one attached to it — creating a row from it burns a case number and puts a
 * placeholder name in the register, in exports and in the counts, which is exactly the litter the
 * Add row button used to produce. Amounts and dates are things you fill in AFTER a row exists.
 */
/**
 * Is there enough on this line to create a case for it?
 *
 * A customer NAME is the minimum. An account number on its own is not: a clerk tabbing across a
 * blank row, or a paste that lands one column out, leaves an account and nothing else — and this
 * used to answer yes to that, so the sheet filled with rows called "New customer" holding ₹1.
 * Seventy-five of them appeared in one afternoon, none of them deletable from the grid, and the
 * real rows were lost among them.
 *
 * Money and dates still do not count on their own, for the same reason they never did: they say
 * something about a case without saying whose it is.
 */
export function identifiesNewRow(fields: {
  customerName?: string | null;
  accountNumber?: string | null;
}): boolean {
  return Boolean(fields.customerName?.trim());
}

export type SheetShortcut =
  | { action: 'copy' }
  | { action: 'cut' }
  | { action: 'paste' }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'selectAll' }
  | { action: 'selectRow' }
  | { action: 'selectColumn' }
  | { action: 'clear' }
  | { action: 'backspace' }
  | { action: 'fillDown' }
  | { action: 'fillRight' }
  | { action: 'fillSelection' }
  | { action: 'home'; extent: 'row' | 'sheet'; shift: boolean }
  | { action: 'end'; extent: 'row' | 'sheet'; shift: boolean }
  | { action: 'jump'; dir: 'up' | 'down' | 'left' | 'right'; shift: boolean }
  | { action: 'find' }
  | { action: 'save' };

/**
 * Spreadsheet keys. Alt is ignored. The grid decides whether to steal a key from a focused
 * input (for example Backspace only clears a cell when the whole value is selected).
 */
export function matchSheetShortcut(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}): SheetShortcut | null {
  if (event.altKey) return null;
  const meta = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (meta && key === 'c' && !event.shiftKey) return { action: 'copy' };
  if (meta && key === 'x' && !event.shiftKey) return { action: 'cut' };
  if (meta && key === 'v' && !event.shiftKey) return { action: 'paste' };
  if (meta && key === 'z' && !event.shiftKey) return { action: 'undo' };
  if (meta && (key === 'y' || (key === 'z' && event.shiftKey))) return { action: 'redo' };
  if (meta && key === 'a' && !event.shiftKey) return { action: 'selectAll' };
  if (meta && key === 'd' && !event.shiftKey) return { action: 'fillDown' };
  if (meta && key === 'r' && !event.shiftKey) return { action: 'fillRight' };
  if (meta && key === 'f' && !event.shiftKey) return { action: 'find' };
  if (meta && key === 's' && !event.shiftKey) return { action: 'save' };
  if (meta && key === 'Enter') return { action: 'fillSelection' };
  if (meta && (event.key === ' ' || event.code === 'Space')) return { action: 'selectColumn' };
  if (!meta && event.shiftKey && (event.key === ' ' || event.code === 'Space')) return { action: 'selectRow' };
  if (key === 'Delete') return { action: 'clear' };
  if (key === 'Backspace') return { action: 'backspace' };
  if (key === 'Home') return { action: 'home', extent: meta ? 'sheet' : 'row', shift: event.shiftKey };
  if (key === 'End') return { action: 'end', extent: meta ? 'sheet' : 'row', shift: event.shiftKey };
  if (meta && (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight')) {
    const dir = key === 'ArrowUp' ? 'up' : key === 'ArrowDown' ? 'down' : key === 'ArrowLeft' ? 'left' : 'right';
    return { action: 'jump', dir, shift: event.shiftKey };
  }
  return null;
}

export function jumpToEdge(input: {
  from: CellPos;
  dir: 'up' | 'down' | 'left' | 'right';
  lastRow: number;
  lastCol: number;
  filled: (r: number, c: number) => boolean;
}): CellPos {
  const dr = input.dir === 'down' ? 1 : input.dir === 'up' ? -1 : 0;
  const dc = input.dir === 'right' ? 1 : input.dir === 'left' ? -1 : 0;
  const { lastRow, lastCol, filled } = input;
  let r = input.from.r + dr;
  let c = input.from.c + dc;
  if (r < 0 || c < 0 || r > lastRow || c > lastCol) return input.from;
  const lookingForFilled = !filled(r, c);
  while (r >= 0 && c >= 0 && r <= lastRow && c <= lastCol) {
    const nr = r + dr;
    const nc = c + dc;
    const atEdge = nr < 0 || nc < 0 || nr > lastRow || nc > lastCol;
    if (lookingForFilled) {
      if (filled(r, c) || atEdge) return { r, c };
    } else if (!filled(r, c)) {
      return { r: r - dr, c: c - dc };
    } else if (atEdge) {
      return { r, c };
    }
    r = nr;
    c = nc;
  }
  return {
    r: Math.max(0, Math.min(lastRow, r)),
    c: Math.max(0, Math.min(lastCol, c)),
  };
}

export function fillDownPairs(range: SheetRange): { from: CellPos; to: CellPos }[] {
  const pairs: { from: CellPos; to: CellPos }[] = [];
  if (range.r0 === range.r1) {
    if (range.r0 === 0) return pairs;
    for (let c = range.c0; c <= range.c1; c++) {
      pairs.push({ from: { r: range.r0 - 1, c }, to: { r: range.r0, c } });
    }
    return pairs;
  }
  for (let c = range.c0; c <= range.c1; c++) {
    for (let r = range.r0 + 1; r <= range.r1; r++) {
      pairs.push({ from: { r: range.r0, c }, to: { r, c } });
    }
  }
  return pairs;
}

export function fillRightPairs(range: SheetRange): { from: CellPos; to: CellPos }[] {
  const pairs: { from: CellPos; to: CellPos }[] = [];
  if (range.c0 === range.c1) {
    if (range.c0 === 0) return pairs;
    for (let r = range.r0; r <= range.r1; r++) {
      pairs.push({ from: { r, c: range.c0 - 1 }, to: { r, c: range.c0 } });
    }
    return pairs;
  }
  for (let r = range.r0; r <= range.r1; r++) {
    for (let c = range.c0 + 1; c <= range.c1; c++) {
      pairs.push({ from: { r, c: range.c0 }, to: { r, c } });
    }
  }
  return pairs;
}
