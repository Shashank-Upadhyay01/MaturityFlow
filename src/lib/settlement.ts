/** Cash payouts settle to whole ₹100 units; only the maturity's own sub-₹100 tail is waived. */
export const SETTLEMENT_ROUNDING_UNIT_PAISE = 10_000n;

export function settlementState(maturityPaise: bigint, paidPaise: bigint) {
  if (maturityPaise <= 0n || paidPaise < 0n || paidPaise > maturityPaise) {
    throw new Error('Invalid maturity settlement totals.');
  }
  const rawRemainingPaise = maturityPaise - paidPaise;
  const maturityRemainderPaise = maturityPaise % SETTLEMENT_ROUNDING_UNIT_PAISE;
  const adjustmentPaise = maturityRemainderPaise > 0n && rawRemainingPaise === maturityRemainderPaise
    ? maturityRemainderPaise
    : 0n;
  const complete = rawRemainingPaise === 0n || adjustmentPaise > 0n;
  return {
    complete,
    adjustmentPaise,
    remainingPaise: complete ? 0n : rawRemainingPaise,
  };
}
