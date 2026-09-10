import { describe, expect, it } from 'vitest';

import { settlementState } from '../src/lib/settlement';

describe('small balance settlement', () => {
  it('waives only the maturity amount remainder below ₹100 at final settlement', () => {
    expect(settlementState(12_903_700n, 12_900_000n)).toEqual({
      complete: true,
      adjustmentPaise: 3_700n,
      remainingPaise: 0n,
    });
    expect(settlementState(12_999_200n, 12_990_000n)).toEqual({
      complete: true,
      adjustmentPaise: 9_200n,
      remainingPaise: 0n,
    });
  });

  it('does not waive a temporary small balance or any amount from an exact ₹100 maturity', () => {
    expect(settlementState(12_903_700n, 12_900_100n)).toEqual({
      complete: false,
      adjustmentPaise: 0n,
      remainingPaise: 3_600n,
    });
    expect(settlementState(100_000n, 99_999n)).toEqual({
      complete: false,
      adjustmentPaise: 0n,
      remainingPaise: 1n,
    });
  });

  it('completes an exact maturity only after the whole amount is paid', () => {
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
