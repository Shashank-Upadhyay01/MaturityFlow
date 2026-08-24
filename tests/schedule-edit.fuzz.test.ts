import { describe, expect, it } from 'vitest';
import { rebalanceAfter, type EditableInstalment } from '../src/lib/schedule-edit';

/**
 * Property sweep over schedule edits.
 *
 * The one property that matters: an edit may move money between days, but it may never change how
 * much money there is, and it may never rewrite a rupee that has already gone out of the drawer.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = [1n, 100n, 10_000n, 100_000n, 1_000_000n];
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 20_000);

describe(`rebalanceAfter — ${ITERATIONS.toLocaleString('en-IN')} randomised edits`, () => {
  it('never moves the total and never rewrites money already paid', async () => {
    const rand = mulberry32(20260824);
    let applied = 0;
    let refused = 0;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const n = 2 + Math.floor(rand() * 12);
      const step = STEPS[Math.floor(rand() * STEPS.length)];
      const rows: EditableInstalment[] = Array.from({ length: n }, (_, i) => {
        const amount = BigInt(1 + Math.floor(rand() * 500)) * step;
        // Some rows already carry money: none, part, or all of it.
        const roll = rand();
        const paid = roll < 0.6 ? 0n : roll < 0.85 ? amount / 2n : amount;
        return {
          id: `i${i + 1}`,
          seq: i + 1,
          dueOn: `2026-09-${String(i + 1).padStart(2, '0')}`,
          amountPaise: amount,
          paidPaise: paid,
          isFinal: i === n - 1,
        };
      });

      const before = rows.reduce((a, r) => a + r.amountPaise, 0n);
      const pick = rows[Math.floor(rand() * rows.length)];
      const newAmount = BigInt(Math.floor(rand() * 800)) * step;

      const res = rebalanceAfter(rows, pick.id, newAmount, step);
      const ctx = `#${iter}: n=${n} step=${step} pick=${pick.id} new=${newAmount}`;

      if (!res.ok) {
        refused++;
        continue;
      }
      applied++;

      const after = res.instalments.reduce((a, r) => a + r.amountPaise, 0n);
      if (after !== before) throw new Error(`Total moved: ${before} -> ${after}. ${ctx}`);

      for (let i = 0; i < rows.length; i++) {
        const was = rows[i];
        const now = res.instalments[i];
        if (now.amountPaise < now.paidPaise) {
          throw new Error(`Row ${now.id} fell below what was paid. ${ctx}`);
        }
        if (now.amountPaise < 0n) throw new Error(`Negative row ${now.id}. ${ctx}`);
        // Rows before the edited one never move.
        if (was.seq < pick.seq && now.amountPaise !== was.amountPaise) {
          throw new Error(`Row ${now.id} before the edit changed. ${ctx}`);
        }
        // A fully paid row is never rewritten.
        if (was.paidPaise >= was.amountPaise && now.amountPaise !== was.amountPaise) {
          throw new Error(`Fully paid row ${now.id} was rewritten. ${ctx}`);
        }
      }

      // The edit actually took effect.
      const edited = res.instalments.find((r) => r.id === pick.id);
      if (!edited || edited.amountPaise !== newAmount) {
        throw new Error(`Edit not applied: ${edited?.amountPaise} != ${newAmount}. ${ctx}`);
      }

      if (applied % 5_000 === 0) await new Promise((r) => setImmediate(r));
    }

    // The sweep must exercise both outcomes, or it is not testing what it claims to.
    expect(applied).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
