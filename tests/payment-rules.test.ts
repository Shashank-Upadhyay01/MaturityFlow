import { describe, expect, it } from 'vitest';
import { rupees } from '../src/lib/money';
import { computeProgress, validatePayout, type PayoutContext } from '../src/lib/payment-rules';

const base: PayoutContext = {
  instalmentAmountPaise: rupees('34000'),
  instalmentPaidPaise: 0n,
  casePaidTotalPaise: 0n,
  caseTotalPaise: rupees('500000'),
  caseIsPayable: true,
  allowExceedInstalment: false,
};

describe('validatePayout', () => {
  it('accepts a clean full-cash payment', () => {
    const r = validatePayout({ cashPaise: rupees('34000'), onlinePaise: 0n }, base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalPaise).toBe(rupees('34000'));
      expect(r.settlesInstalment).toBe(true);
      expect(r.settlesCase).toBe(false);
    }
  });

  it('accepts a partial payment', () => {
    const r = validatePayout({ cashPaise: rupees('20000'), onlinePaise: 0n }, base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settlesInstalment).toBe(false);
  });

  it('accepts a split payment with a reference', () => {
    const r = validatePayout(
      { cashPaise: rupees('20000'), onlinePaise: rupees('14000'), reference: 'UTR123456' },
      base,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects an online leg without a UTR', () => {
    const r = validatePayout({ cashPaise: 0n, onlinePaise: rupees('14000') }, base);
    expect(r).toMatchObject({ ok: false, code: 'ONLINE_LEG_NEEDS_REFERENCE' });
    const blank = validatePayout(
      { cashPaise: 0n, onlinePaise: rupees('14000'), reference: '   ' },
      base,
    );
    expect(blank).toMatchObject({ ok: false, code: 'ONLINE_LEG_NEEDS_REFERENCE' });
  });

  it('rejects zero and negative amounts', () => {
    expect(validatePayout({ cashPaise: 0n, onlinePaise: 0n }, base)).toMatchObject({
      code: 'NON_POSITIVE_AMOUNT',
    });
    expect(validatePayout({ cashPaise: -1n, onlinePaise: 0n }, base)).toMatchObject({
      code: 'NEGATIVE_LEG',
    });
  });

  it('rejects paying more than the day plan unless authorised', () => {
    const over = { cashPaise: rupees('40000'), onlinePaise: 0n };
    expect(validatePayout(over, base)).toMatchObject({ code: 'EXCEEDS_INSTALMENT' });
    expect(validatePayout(over, { ...base, allowExceedInstalment: true }).ok).toBe(true);
  });

  it('rejects paying an already-settled instalment', () => {
    const r = validatePayout(
      { cashPaise: rupees('1000'), onlinePaise: 0n },
      { ...base, instalmentPaidPaise: rupees('34000') },
    );
    expect(r).toMatchObject({ code: 'INSTALMENT_ALREADY_SETTLED' });
  });

  it('INV-4: nobody, at any authority level, can exceed the maturity amount', () => {
    const ctx: PayoutContext = {
      ...base,
      instalmentAmountPaise: rupees('50000'),
      casePaidTotalPaise: rupees('480000'),
      allowExceedInstalment: true, // even with the override
    };
    const r = validatePayout({ cashPaise: rupees('25000'), onlinePaise: 0n }, ctx);
    expect(r).toMatchObject({ ok: false, code: 'EXCEEDS_CASE_TOTAL' });

    const exact = validatePayout({ cashPaise: rupees('20000'), onlinePaise: 0n }, ctx);
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.settlesCase).toBe(true);
  });

  it('refuses to pay a case that is not payable', () => {
    const r = validatePayout(
      { cashPaise: rupees('1000'), onlinePaise: 0n },
      { ...base, caseIsPayable: false },
    );
    expect(r).toMatchObject({ code: 'CASE_NOT_PAYABLE' });
  });
});

describe('computeProgress', () => {
  it('reports remaining and percentage without float drift', () => {
    const p = computeProgress(rupees('500000'), rupees('170000'), rupees('30000'));
    expect(p.paidPaise).toBe(rupees('200000'));
    expect(p.remainingPaise).toBe(rupees('300000'));
    expect(p.percent).toBe(40);
    expect(p.isComplete).toBe(false);
  });

  it('never reports negative remaining', () => {
    const p = computeProgress(rupees('1000'), rupees('1000'), rupees('500'));
    expect(p.remainingPaise).toBe(0n);
    expect(p.isComplete).toBe(true);
  });

  it('handles a zero-value case without dividing by zero', () => {
    expect(computeProgress(0n, 0n, 0n).percent).toBe(0);
  });
});
