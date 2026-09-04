import { describe, expect, it } from 'vitest';

import {
  blankRowCount,
  cellAddress,
  cellInSelection,
  cellsInRange,
  columnLetter,
  fillDownPairs,
  fillRightPairs,
  growSheetLength,
  initialSheetLength,
  jumpToEdge,
  matchSheetShortcut,
  MAX_PASTE_ROWS,
  BLANK_ROW_HEIGHT_PX,
  identifiesNewRow,
  MAX_BLANK_ROWS,
  MAX_REGISTER_PASTE_ROWS,
  PASTE_CHUNK_ROWS,
  MAX_SHEET_ROWS,
  normalizeRange,
  parseClipboardGrid,
  pasteIsoDate,
  pasteRupees,
  rowMatchesFilter,
  selectionBounds,
  serializeClipboardGrid,
  toggleCellInSelection,
  unionSelection,
} from '@/lib/sheet-grid';

describe('column letters', () => {
  it('matches Excel: 0 is A, 25 is Z, 26 is AA', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(cellAddress(0, 0)).toBe('A1');
    expect(cellAddress(2, 6)).toBe('C7');
  });
});

describe('clipboard paste from Excel', () => {
  it('splits tab-separated rows the way Excel copies them', () => {
    const grid = parseClipboardGrid('1606075\tKRISHNA CHAND PATEL\tPREMA\n1611936\tHARIS MUMTAZ KHAN\tRAMASHRY');
    expect(grid).toEqual([
      ['1606075', 'KRISHNA CHAND PATEL', 'PREMA'],
      ['1611936', 'HARIS MUMTAZ KHAN', 'RAMASHRY'],
    ]);
  });

  it('reads Indian rupee text and D/M/Y dates', () => {
    expect(pasteRupees('₹1,00,000')).toBe('100000');
    expect(pasteRupees('88000')).toBe('88000');
    expect(pasteIsoDate('01/09/2026')).toBe('2026-09-01');
    expect(pasteIsoDate('2026-09-03')).toBe('2026-09-03');
    expect(pasteIsoDate('3-9-26')).toBe('2026-09-03');
  });

  it('round-trips a copied block', () => {
    const block = [['A', 'B'], ['1', '2']];
    expect(parseClipboardGrid(serializeClipboardGrid(block))).toEqual(block);
  });
});

describe('selection and filter', () => {
  it('expands a dragged range inclusive of both corners', () => {
    expect(normalizeRange({ r: 4, c: 2 }, { r: 1, c: 0 })).toEqual({ r0: 1, c0: 0, r1: 4, c1: 2 });
    expect(cellsInRange({ r0: 0, c0: 0, r1: 1, c1: 1 })).toHaveLength(4);
  });

  it('filters a row by any visible cell', () => {
    expect(rowMatchesFilter(['1606075', 'KRISHNA CHAND PATEL', 'PREMA'], 'prema')).toBe(true);
    expect(rowMatchesFilter(['1606075', 'KRISHNA CHAND PATEL', 'PREMA'], 'zz')).toBe(false);
  });

  it('Shift-range plus Ctrl-click keeps individual cells', () => {
    const block = normalizeRange({ r: 0, c: 0 }, { r: 1, c: 1 });
    const extra = toggleCellInSelection([], block, 3, 2);
    expect(cellInSelection(0, 0, { r0: 3, c0: 2, r1: 3, c1: 2 }, extra)).toBe(true);
    expect(cellInSelection(3, 2, { r0: 3, c0: 2, r1: 3, c1: 2 }, extra)).toBe(true);
    const toggledOff = toggleCellInSelection(extra, null, 0, 0);
    expect(toggledOff.has('0:0')).toBe(false);
    expect(toggledOff.has('1:1')).toBe(true);
  });

  it('copy bounds cover a sparse selection with holes', () => {
    const cells = unionSelection({ r0: 0, c0: 0, r1: 0, c1: 0 }, ['2:2']);
    expect(selectionBounds(cells)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 });
  });
});

describe('auto-growing empty rows', () => {
  it('starts with live rows plus a 20-row runway, capped at 500', () => {
    expect(initialSheetLength(0)).toBe(20);
    expect(initialSheetLength(10)).toBe(30);
    expect(initialSheetLength(107)).toBe(127);
    expect(initialSheetLength(490)).toBe(500);
    expect(initialSheetLength(520)).toBe(520);
  });

  it('does not open blanks while the highlight stays inside already-shown rows', () => {
    expect(growSheetLength({ currentLength: 30, filledCount: 10, targetIndex: 3 })).toBe(30);
    expect(growSheetLength({ currentLength: 30, filledCount: 10, targetIndex: 29 })).toBe(30);
  });

  it('reveals another buffer of rows when the highlight walks off the bottom, up to 500', () => {
    expect(growSheetLength({ currentLength: 30, filledCount: 10, targetIndex: 30, buffer: 10 })).toBe(41);
    expect(growSheetLength({ currentLength: 495, filledCount: 10, targetIndex: 495, buffer: 10 })).toBe(500);
  });

  it('never hides live rows and never grows past 500 unless live cases already exceed it', () => {
    expect(growSheetLength({ currentLength: 200, filledCount: 10, targetIndex: 50 })).toBe(200);
    expect(growSheetLength({ currentLength: 520, filledCount: 520, targetIndex: 520 })).toBe(520);
    expect(blankRowCount({ sheetLength: 500, filledCount: 80, allowBlanks: true })).toBe(420);
    expect(blankRowCount({ sheetLength: 500, filledCount: 80, allowBlanks: false })).toBe(0);
    expect(MAX_PASTE_ROWS).toBe(100);
  });
});

describe('a new row has to identify somebody', () => {
  it('accepts a name or an account number', () => {
    expect(identifiesNewRow({ customerName: 'SUNITA DEVI' })).toBe(true);
    expect(identifiesNewRow({ accountNumber: '1611937' })).toBe(true);
    expect(identifiesNewRow({ customerName: 'SUNITA DEVI', accountNumber: '1611937' })).toBe(true);
  });

  it('refuses money and dates on their own', () => {
    // This is the "New customer / Unassigned / Rs1" litter: a pasted line that carried an amount
    // and a date but no name used to become a real case with a placeholder for a customer.
    expect(identifiesNewRow({})).toBe(false);
    expect(identifiesNewRow({ customerName: '   ', accountNumber: '' })).toBe(false);
    expect(identifiesNewRow({ customerName: null, accountNumber: null })).toBe(false);
  });
});

describe('the register sheet always keeps 500 empty rows under the book', () => {
  it('counts capacity in empty rows, not in rows on the sheet', () => {
    // The whole point of counting blanks: a branch past 500 live cases still gets somewhere to
    // type, which is what sent clerks back to the Add rows button.
    expect(MAX_BLANK_ROWS).toBe(500);
  });

  it('gives the virtualiser a fixed height, so the scrollbar is honest on the first paint', () => {
    expect(BLANK_ROW_HEIGHT_PX).toBeGreaterThan(0);
    // 500 uniform rows must add up to a scrollable sheet rather than a few hundred pixels.
    expect(MAX_BLANK_ROWS * BLANK_ROW_HEIGHT_PX).toBeGreaterThan(10_000);
  });

  it('lets one paste cover the whole capacity, written in chunks', () => {
    expect(MAX_REGISTER_PASTE_ROWS).toBe(MAX_BLANK_ROWS);
    expect(PASTE_CHUNK_ROWS).toBeGreaterThan(0);
    expect(PASTE_CHUNK_ROWS).toBeLessThan(MAX_REGISTER_PASTE_ROWS);
  });
});

const keys = (partial: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; code: string }>) => ({
  key: 'a',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...partial,
});

describe('spreadsheet shortcuts', () => {
  it('recognises copy, cut, paste, undo, redo, select-all', () => {
    expect(matchSheetShortcut(keys({ key: 'c', ctrlKey: true }))).toEqual({ action: 'copy' });
    expect(matchSheetShortcut(keys({ key: 'x', metaKey: true }))).toEqual({ action: 'cut' });
    expect(matchSheetShortcut(keys({ key: 'v', ctrlKey: true }))).toEqual({ action: 'paste' });
    expect(matchSheetShortcut(keys({ key: 'z', ctrlKey: true }))).toEqual({ action: 'undo' });
    expect(matchSheetShortcut(keys({ key: 'y', ctrlKey: true }))).toEqual({ action: 'redo' });
    expect(matchSheetShortcut(keys({ key: 'z', ctrlKey: true, shiftKey: true }))).toEqual({ action: 'redo' });
    expect(matchSheetShortcut(keys({ key: 'a', ctrlKey: true }))).toEqual({ action: 'selectAll' });
  });

  it('recognises fill, clear, home, jump and find', () => {
    expect(matchSheetShortcut(keys({ key: 'd', ctrlKey: true }))).toEqual({ action: 'fillDown' });
    expect(matchSheetShortcut(keys({ key: 'r', ctrlKey: true }))).toEqual({ action: 'fillRight' });
    expect(matchSheetShortcut(keys({ key: 'Delete' }))).toEqual({ action: 'clear' });
    expect(matchSheetShortcut(keys({ key: 'Home', ctrlKey: true }))).toEqual({ action: 'home', extent: 'sheet', shift: false });
    expect(matchSheetShortcut(keys({ key: 'ArrowDown', ctrlKey: true, shiftKey: true }))).toEqual({
      action: 'jump', dir: 'down', shift: true,
    });
    expect(matchSheetShortcut(keys({ key: 'f', ctrlKey: true }))).toEqual({ action: 'find' });
  });

  it('Ctrl+Arrow skips empty cells to the next filled edge', () => {
    const filled = (r: number, c: number) => r === 0 || r === 4;
    expect(jumpToEdge({ from: { r: 0, c: 0 }, dir: 'down', lastRow: 9, lastCol: 2, filled })).toEqual({ r: 4, c: 0 });
    expect(jumpToEdge({ from: { r: 4, c: 0 }, dir: 'down', lastRow: 9, lastCol: 2, filled })).toEqual({ r: 9, c: 0 });
  });

  it('Ctrl+D copies the top of the block down, Ctrl+R copies the left across', () => {
    expect(fillDownPairs({ r0: 1, c0: 0, r1: 3, c1: 0 })).toEqual([
      { from: { r: 1, c: 0 }, to: { r: 2, c: 0 } },
      { from: { r: 1, c: 0 }, to: { r: 3, c: 0 } },
    ]);
    expect(fillRightPairs({ r0: 0, c0: 1, r1: 0, c1: 3 })).toEqual([
      { from: { r: 0, c: 1 }, to: { r: 0, c: 2 } },
      { from: { r: 0, c: 1 }, to: { r: 0, c: 3 } },
    ]);
  });
});
