import { describe, expect, it } from 'vitest';

import { searchTips, tipsForPath } from '@/lib/workspace-guide';

describe('workspace guide', () => {
  it('puts Operations sheet tips first on that screen', () => {
    const ids = tipsForPath('/maturity-operations').map((t) => t.id);
    expect(ids[0]).toBe('sheet-type');
    expect(ids).toContain('ops-review');
  });

  it('answers a paste question without inventing money advice', () => {
    const hits = searchTips('paste excel', '/maturity-operations');
    expect(hits[0]?.id).toBe('sheet-copy-paste');
    expect(hits[0]?.body).toMatch(/Ctrl\+V/);
  });
});
