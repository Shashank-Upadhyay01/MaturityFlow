import { describe, expect, it } from 'vitest';

import { defaultLandingPage } from '@/lib/landing-page';

describe('defaultLandingPage', () => {
  it('opens Summary for the CMD and CEO', () => {
    expect(defaultLandingPage({ role: 'CMD' })).toBe('/dashboard');
    expect(defaultLandingPage({ role: 'CEO' })).toBe('/dashboard');
  });

  it('opens Maturities for legacy and migrated Operations Head accounts', () => {
    expect(defaultLandingPage({ role: 'OPS_HEAD' })).toBe('/maturity-operations');
    expect(defaultLandingPage({ role: 'ADMIN', username: 'OPS' })).toBe('/maturity-operations');
  });

  it('keeps other roles on the Register', () => {
    expect(defaultLandingPage({ role: 'ADMIN', username: 'admin' })).toBe('/maturities');
    expect(defaultLandingPage({ role: 'BRANCH_MANAGER' })).toBe('/maturities');
    expect(defaultLandingPage({ role: 'CASHIER' })).toBe('/maturities');
  });
});
