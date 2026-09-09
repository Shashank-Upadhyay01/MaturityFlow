/** Final residue the bank waives instead of recording fictional cash. */
export const SMALL_BALANCE_SETTLEMENT_PAISE = 10_000n;

export function settlementState(maturityPaise: bigint, paidPaise: bigint) {
  if (maturityPaise <= 0n || paidPaise < 0n || paidPaise > maturityPaise) {
    throw new Error('Invalid maturity settlement totals.');
  }
  const rawRemainingPaise = maturityPaise - paidPaise;
  const adjustmentPaise = rawRemainingPaise > 0n && rawRemainingPaise <= SMALL_BALANCE_SETTLEMENT_PAISE
    ? rawRemainingPaise
    : 0n;
  const complete = rawRemainingPaise === 0n || adjustmentPaise > 0n;
  return {
    complete,
    adjustmentPaise,
    remainingPaise: complete ? 0n : rawRemainingPaise,
  };
}
