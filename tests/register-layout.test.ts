import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTER_LAYOUT,
  REGISTER_COL_DEFS,
  REGISTER_LAYOUT_VERSION,
  colWidthRem,
  columnsThatFit,
  excelHeadersForLayout,
  parseRegisterLayout,
  visibleRegisterCols,
} from '../src/lib/register-layout';

describe('register layout', () => {
  it('fills missing columns from the default order', () => {
    const layout = parseRegisterLayout({ version: REGISTER_LAYOUT_VERSION, order: ['agent', 'customer'], hidden: ['total'] });
    expect(layout.order[0]).toBe('agent');
    expect(layout.order[1]).toBe('customer');
    expect(layout.order).toContain('amount');
    // Total is what the customer can walk out with; it is not an admin's to hide.
    expect(layout.hidden).not.toContain('total');
  });

  it('lets an admin hide Recommended, which the office layout does not carry', () => {
    const layout = parseRegisterLayout({ version: REGISTER_LAYOUT_VERSION, order: [], hidden: ['perDay'] });
    expect(layout.hidden).toContain('perDay');
    expect(visibleRegisterCols(layout).map((c) => c.id)).not.toContain('perDay');
  });

  it('cannot hide required columns', () => {
    const layout = parseRegisterLayout({ version: REGISTER_LAYOUT_VERSION, order: [], hidden: ['customer', 'amount', 'agent'] });
    const vis = visibleRegisterCols(layout).map((c) => c.id);
    expect(vis).toContain('customer');
    expect(vis).toContain('amount');
    expect(vis).not.toContain('agent');
  });

  it('template headers follow the visible order', () => {
    const layout = parseRegisterLayout({
      version: REGISTER_LAYOUT_VERSION,
      order: ['customer', 'account', 'amount'],
      hidden: ['perDay', 'cash', 'online'],
    });
    const headers = excelHeadersForLayout(layout);
    expect(headers[0]).toBe('Customer Name');
    expect(headers[1]).toBe('Savings Account Number');
    expect(headers.some((h) => h.includes('Per Day'))).toBe(false);
  });

  it('default layout matches the register the office fixed', () => {
    // The thirteenth column, Given, is the tick furniture beside the grid rather than a data
    // column, so it carries no Excel header and does not appear here.
    const headers = excelHeadersForLayout(DEFAULT_REGISTER_LAYOUT);
    expect(headers).toEqual([
      'Savings Account Number',
      'Customer Name',
      "Customer's Agent Name",
      'Maturity Amount',
      'Date of Maturity',
      'Payment Date',
      'Remaining Amount',
      'Paid Maturity',
      'Missed Amount',
      'Due Payment',
      'Total Amount',
      'Paid Today',
    ]);
  });

  it('keeps the arrears columns beside the day they explain', () => {
    const ids = visibleRegisterCols(DEFAULT_REGISTER_LAYOUT).map((c) => c.id);
    // Missed, today, total read left to right as the sentence they are: what was not collected,
    // what today asks for, what the two come to.
    expect(ids.slice(ids.indexOf('missed'), ids.indexOf('missed') + 3)).toEqual(['missed', 'today', 'total']);
  });

  it('upgrades a saved pre-grid layout to the current cashier sheet once', () => {
    const layout = parseRegisterLayout({
      order: ['customer', 'amount', 'remaining', 'today'],
      hidden: ['account'],
    });
    expect(layout.version).toBe(REGISTER_LAYOUT_VERSION);
    expect(excelHeadersForLayout(layout)).toEqual(excelHeadersForLayout(DEFAULT_REGISTER_LAYOUT));
  });
});

describe('columnsThatFit', () => {
  const all = visibleRegisterCols(DEFAULT_REGISTER_LAYOUT);
  const totalRem = all.reduce((sum, c) => sum + colWidthRem(c), 0);

  it('every column carries a width and a priority', () => {
    for (const c of Object.values(REGISTER_COL_DEFS)) {
      expect(colWidthRem(c)).toBeGreaterThan(0);
      expect(typeof c.priority).toBe('number');
    }
  });

  it('keeps every column when there is room', () => {
    const { shown, dropped } = columnsThatFit(all, (totalRem + 10) * 16);
    expect(shown).toHaveLength(all.length);
    expect(dropped).toHaveLength(0);
  });

  it('never drops a required column, however narrow the screen', () => {
    const { shown } = columnsThatFit(all, 120);
    const ids = shown.map((c) => c.id);
    for (const c of all.filter((x) => x.required)) expect(ids).toContain(c.id);
  });

  it('drops the lowest priority first and keeps the money columns', () => {
    // Half the width: the reference columns go, what the counter pays does not.
    const { shown, dropped } = columnsThatFit(all, (totalRem / 2) * 16);
    const kept = shown.map((c) => c.id);
    const gone = dropped.map((c) => c.id);
    expect(kept).toContain('customer');
    expect(kept).toContain('today');
    expect(gone.length).toBeGreaterThan(0);
    // Among the columns that *may* be dropped, nothing dropped outranks anything kept.
    // Required columns are exempt: they survive however badly they rank.
    const worstKept = Math.max(...shown.filter((c) => !c.required).map((c) => c.priority));
    const bestDropped = Math.min(...dropped.map((c) => c.priority));
    expect(bestDropped).toBeGreaterThanOrEqual(worstKept);
  });

  it('what it shows actually fits the width it was given', () => {
    for (const px of [640, 900, 1280, 1440, 1920]) {
      const { shown } = columnsThatFit(all, px);
      const usedRem = shown.reduce((sum, c) => sum + colWidthRem(c), 0);
      const required = all.filter((c) => c.required);
      const floorRem = required.reduce((sum, c) => sum + colWidthRem(c), 0);
      // Either it fits, or we are already down to the columns that can never be dropped.
      expect(usedRem * 16 <= px || usedRem <= floorRem).toBe(true);
    }
  });

  it('preserves the given order rather than reordering by priority', () => {
    const { shown } = columnsThatFit(all, (totalRem * 0.7) * 16);
    const order = all.map((c) => c.id).filter((id) => shown.some((s) => s.id === id));
    expect(shown.map((c) => c.id)).toEqual(order);
  });

  it('a bigger reservation leaves room for fewer columns', () => {
    // The caller reserves space for the row furniture it renders — select box, ticks, Given,
    // the overflow expander. Under-reserving is what squeezes trailing columns to zero width.
    const px = 1200;
    const lean = columnsThatFit(all, px, 6.5);
    const withFurniture = columnsThatFit(all, px, 6.5 + 7);
    expect(withFurniture.shown.length).toBeLessThanOrEqual(lean.shown.length);
    const leanRem = lean.shown.reduce((s, c) => s + colWidthRem(c), 0);
    const fullRem = withFurniture.shown.reduce((s, c) => s + colWidthRem(c), 0);
    expect(fullRem).toBeLessThanOrEqual(leanRem);
  });

  it('shown and dropped together account for every column, once', () => {
    const { shown, dropped } = columnsThatFit(all, 800);
    const ids = [...shown, ...dropped].map((c) => c.id).sort();
    expect(ids).toEqual(all.map((c) => c.id).sort());
  });
});
