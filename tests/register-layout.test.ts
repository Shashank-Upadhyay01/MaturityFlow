import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTER_LAYOUT,
  excelHeadersForLayout,
  parseRegisterLayout,
  visibleRegisterCols,
} from '../src/lib/register-layout';

describe('register layout', () => {
  it('fills missing columns from the default order', () => {
    const layout = parseRegisterLayout({ order: ['agent', 'customer'], hidden: ['perDay'] });
    expect(layout.order[0]).toBe('agent');
    expect(layout.order[1]).toBe('customer');
    expect(layout.order).toContain('amount');
    expect(layout.hidden).toContain('perDay');
  });

  it('cannot hide required columns', () => {
    const layout = parseRegisterLayout({ order: [], hidden: ['customer', 'amount', 'agent'] });
    const vis = visibleRegisterCols(layout).map((c) => c.id);
    expect(vis).toContain('customer');
    expect(vis).toContain('amount');
    expect(vis).not.toContain('agent');
  });

  it('template headers follow the visible order', () => {
    const layout = parseRegisterLayout({
      order: ['customer', 'account', 'amount'],
      hidden: ['perDay', 'cash', 'online'],
    });
    const headers = excelHeadersForLayout(layout);
    expect(headers[0]).toBe('Customer Name');
    expect(headers[1]).toBe('Savings Account Number');
    expect(headers.some((h) => h.includes('Per Day'))).toBe(false);
  });

  it('default layout includes the classic register headers', () => {
    const headers = excelHeadersForLayout(DEFAULT_REGISTER_LAYOUT);
    expect(headers).toContain('Form Submission Date');
    expect(headers).toContain('Maturity Amount');
  });
});
