import { describe, expect, it } from 'vitest';

import {
  cellAddress,
  cellsInRange,
  columnLetter,
  normalizeRange,
  parseClipboardGrid,
  pasteIsoDate,
  pasteRupees,
  rowMatchesFilter,
  serializeClipboardGrid,
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
});
