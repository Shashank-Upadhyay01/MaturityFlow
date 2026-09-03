import { describe, expect, it } from 'vitest';
import {
  ScheduleEditIntegrityError,
  rebalanceAfter,
  type EditableInstalment,
} from '../src/lib/schedule-edit';

const STEP = 100_000n; // ₹1,000

/** Six equal ₹10,000 days, none paid. */
function sixDays(overrides: Record<number, Partial<EditableInstalment>> = {}) {
  return Array.from({ length: 6 }, (_, i) => ({
    id: `i${i + 1}`,
    seq: i + 1,
    dueOn: `2026-09-0${i + 1}`,
    amountPaise: 1_000_000n,
    paidPaise: 0n,
    isFinal: i === 5,
    ...(overrides[i + 1] ?? {}),
  })) as EditableInstalment[];
}

const total = (rows: readonly EditableInstalment[]) =>
  rows.reduce((a, r) => a + r.amountPaise, 0n);

describe('rebalanceAfter', () => {
  it('spreads an increase across the later days only', () => {
    const before = sixDays();
    const res = rebalanceAfter(before, 'i2', 4_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);

    expect(res.instalments[0].amountPaise).toBe(1_000_000n); // day 1 untouched
    expect(res.instalments[1].amountPaise).toBe(4_000_000n); // the edit
    expect(total(res.instalments)).toBe(total(before)); // total never moves
    // Days 3-6 absorbed the ₹30,000 between them.
    expect(total(res.instalments.slice(2))).toBe(1_000_000n);
  });

  it('spreads a decrease across the later days only', () => {
    const res = rebalanceAfter(sixDays(), 'i1', 400_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[0].amountPaise).toBe(400_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('never touches a row before the edited one', () => {
    const before = sixDays();
    const res = rebalanceAfter(before, 'i4', 2_000_000n, STEP);
    if (!res.ok) throw new Error('expected ok');
    for (let i = 0; i < 3; i++) {
      expect(res.instalments[i].amountPaise).toBe(before[i].amountPaise);
    }
  });

  it('leaves every row a whole multiple of the rounding step', () => {
    const res = rebalanceAfter(sixDays(), 'i2', 1_500_000n, STEP);
    if (!res.ok) throw new Error('expected ok');
    for (const r of res.instalments) expect(r.amountPaise % STEP).toBe(0n);
  });

  it('refuses to cut a fully paid row below what went out', () => {
    const rows = sixDays({ 1: { paidPaise: 1_000_000n } });
    const res = rebalanceAfter(rows, 'i1', 500_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('AMOUNT_BELOW_ALREADY_PAID');
  });

  it('lets a fully paid row be increased; later unpaid days absorb it', () => {
    const rows = sixDays({ 1: { paidPaise: 1_000_000n } });
    const res = rebalanceAfter(rows, 'i1', 2_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[0].amountPaise).toBe(2_000_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('lets a part-paid row be cut to exactly what went out', () => {
    const rows = sixDays({ 1: { paidPaise: 500_000n } });
    const res = rebalanceAfter(rows, 'i1', 500_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[0].amountPaise).toBe(500_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('refuses to cut a part-paid row below what went out', () => {
    const rows = sixDays({ 1: { paidPaise: 500_000n } });
    const res = rebalanceAfter(rows, 'i1', 400_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('AMOUNT_BELOW_ALREADY_PAID');
  });

  it('refuses a negative amount but allows zero', () => {
    expect(rebalanceAfter(sixDays(), 'i2', -1n, STEP).ok).toBe(false);
    const zero = rebalanceAfter(sixDays(), 'i2', 0n, STEP);
    if (!zero.ok) throw new Error(`expected ok, got ${zero.error}`);
    expect(zero.instalments[1].amountPaise).toBe(0n);
    expect(total(zero.instalments)).toBe(6_000_000n);
  });

  it('uses earlier unpaid days when the edited day is the last one', () => {
    const res = rebalanceAfter(sixDays(), 'i6', 2_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[5].amountPaise).toBe(2_000_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('refuses when every other day is already paid', () => {
    const rows = sixDays({
      1: { paidPaise: 1_000_000n },
      2: { paidPaise: 1_000_000n },
      3: { paidPaise: 1_000_000n },
      4: { paidPaise: 1_000_000n },
      5: { paidPaise: 1_000_000n },
    });
    const res = rebalanceAfter(rows, 'i6', 2_000_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('NO_LATER_UNPAID_DAYS');
  });

  it('is a no-op, not an error, when the amount is unchanged', () => {
    const res = rebalanceAfter(sixDays(), 'i6', 1_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('refuses when the later rows cannot absorb the increase', () => {
    // Days 3-6 hold ₹40,000 between them; asking day 2 for ₹60,000 cannot be paid for.
    const res = rebalanceAfter(sixDays(), 'i2', 6_000_000n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('AMOUNT_EXCEEDS_REMAINING');
  });

  it('later fully paid rows absorb nothing and are left alone', () => {
    const rows = sixDays({ 5: { paidPaise: 1_000_000n }, 6: { paidPaise: 1_000_000n } });
    const res = rebalanceAfter(rows, 'i1', 400_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[4].amountPaise).toBe(1_000_000n);
    expect(res.instalments[5].amountPaise).toBe(1_000_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('a later part-paid row is only drawn down to what it has already paid', () => {
    const rows = sixDays({ 6: { paidPaise: 900_000n } });
    const res = rebalanceAfter(rows, 'i1', 5_000_000n, STEP);
    if (!res.ok) throw new Error(`expected ok, got ${res.error}`);
    expect(res.instalments[5].amountPaise).toBeGreaterThanOrEqual(900_000n);
    expect(total(res.instalments)).toBe(6_000_000n);
  });

  it('reports an unknown row rather than silently doing nothing', () => {
    const res = rebalanceAfter(sixDays(), 'nope', 1n, STEP);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('ROW_NOT_FOUND');
  });

  it('exports the integrity error it throws on an arithmetic bug', () => {
    expect(new ScheduleEditIntegrityError('x')).toBeInstanceOf(Error);
  });
});
