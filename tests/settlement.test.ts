import { describe, expect, it } from 'vitest';

import { SMALL_BALANCE_SETTLEMENT_PAISE, settlementState } from '../src/lib/settlement';

describe('small balance settlement', () => {
  it('waives a positive residue of ₹100 or less without changing the paid total', () => {
    expect(settlementState(100_000n, 90_000n)).toEqual({
      complete: true,
      adjustmentPaise: SMALL_BALANCE_SETTLEMENT_PAISE,
      remainingPaise: 0n,
    });
    expect(settlementState(100_000n, 99_999n)).toEqual({
      complete: true,
      adjustmentPaise: 1n,
      remainingPaise: 0n,
    });
  });

  it('does not waive ₹100.01 or a zero balance', () => {
    expect(settlementState(100_001n, 90_000n)).toEqual({
      complete: false,
      adjustmentPaise: 0n,
      remainingPaise: 10_001n,
    });
    expect(settlementState(100_000n, 100_000n)).toEqual({
      complete: true,
      adjustmentPaise: 0n,
      remainingPaise: 0n,
    });
  });

  it('rejects impossible totals', () => {
    expect(() => settlementState(0n, 0n)).toThrow();
    expect(() => settlementState(100n, 101n)).toThrow();
  });
});
