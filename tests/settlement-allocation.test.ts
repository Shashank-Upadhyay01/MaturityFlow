import { describe, expect, it } from 'vitest';

import {
  planSettlement,
  type SettleableInstalment,
  type SettlementContext,
} from '@/lib/payment-rules';

const TODAY = '2026-09-02';
const R = (rupees: number): bigint => BigInt(rupees) * 100n;

function inst(
  id: string,
  seq: number,
  dueOn: string,
  amount: number,
  paidCash = 0,
  paidOnline = 0,
): SettleableInstalment {
  return {
    id,
    seq,
    dueOn,
    amountPaise: R(amount),
    paidCashPaise: R(paidCash),
    paidOnlinePaise: R(paidOnline),
  };
}

/** Two days of ₹13,000: yesterday unpaid, today unpaid. Nothing paid on the case yet. */
function ctx(over: Partial<SettlementContext> = {}): SettlementContext {
  const instalments = over.instalments ?? [
    inst('i1', 1, '2026-09-01', 13_000),
    inst('i2', 2, TODAY, 13_000),
    inst('i3', 3, '2026-09-03', 13_000),
  ];
  const scheduled = instalments.reduce((s, i) => s + i.amountPaise, 0n);
  return {
    instalments,
    today: TODAY,
    caseTotalPaise: scheduled,
    casePaidTotalPaise: instalments.reduce((s, i) => s + i.paidCashPaise + i.paidOnlinePaise, 0n),
    caseIsPayable: true,
    cashAlreadyPaidTodayPaise: 0n,
    cashCapPerDayPaise: null,
    ...over,
  };
}

describe('planSettlement — one figure at the counter, spread over the days it pays', () => {
  it('is the bug this was written for: yesterday and today in one entry', () => {
    const plan = planSettlement({ cashPaise: R(26_000), onlinePaise: 0n }, ctx());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.lines).toHaveLength(2);
    expect(plan.lines[0]).toMatchObject({ dueOn: '2026-09-01', totalPaise: R(13_000), settlesInstalment: true });
    expect(plan.lines[1]).toMatchObject({ dueOn: TODAY, totalPaise: R(13_000), settlesInstalment: true });
    expect(plan.arrearsClearedPaise).toBe(R(13_000));
    expect(plan.paidAheadPaise).toBe(0n);
  });

  it('clears the oldest day first — today never goes green while yesterday is red', () => {
    const plan = planSettlement({ cashPaise: R(13_000), onlinePaise: 0n }, ctx());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].dueOn).toBe('2026-09-01');
  });

  it('part-pays the oldest open day when the customer brings less than one instalment', () => {
    const plan = planSettlement({ cashPaise: R(5_000), onlinePaise: 0n }, ctx());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toMatchObject({ dueOn: '2026-09-01', settlesInstalment: false });
  });

  it('counts what a day has already taken, not just its face value', () => {
    const plan = planSettlement(
      { cashPaise: R(21_000), onlinePaise: 0n },
      ctx({ instalments: [inst('i1', 1, '2026-09-01', 13_000, 5_000), inst('i2', 2, TODAY, 13_000)] }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines[0].totalPaise).toBe(R(8_000));
    expect(plan.lines[1].totalPaise).toBe(R(13_000));
  });

  it('refuses to reach past today without a reason', () => {
    const plan = planSettlement({ cashPaise: R(39_000), onlinePaise: 0n }, ctx());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('EXCEEDS_DUE_TODAY');
    expect(plan.message).toContain('type a reason');
  });

  it('allows paying ahead once a reason is typed, and marks the future day as such', () => {
    const plan = planSettlement(
      { cashPaise: R(39_000), onlinePaise: 0n, reason: 'Customer relocating, settled in full' },
      ctx(),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(3);
    expect(plan.lines[2]).toMatchObject({ dueOn: '2026-09-03', isAhead: true });
    expect(plan.paidAheadPaise).toBe(R(13_000));
    expect(plan.settlesCase).toBe(true);
  });

  it('treats a day with nothing scheduled today as arrears-only, still needing a reason to go further', () => {
    const alternate = ctx({
      instalments: [inst('i1', 1, '2026-09-01', 13_000), inst('i2', 2, '2026-09-03', 13_000)],
    });
    expect(planSettlement({ cashPaise: R(13_000), onlinePaise: 0n }, alternate).ok).toBe(true);
    const over = planSettlement({ cashPaise: R(14_000), onlinePaise: 0n }, alternate);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.code).toBe('EXCEEDS_DUE_TODAY');
  });

  it('does not refuse cash because of a per-customer cash cap', () => {
    const plan = planSettlement(
      { cashPaise: R(26_000), onlinePaise: 0n },
      ctx({ cashCapPerDayPaise: R(25_000), cashAlreadyPaidTodayPaise: R(20_000) }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.totalPaise).toBe(R(26_000));
  });

  it('still refuses an online leg with no reference', () => {
    const plan = planSettlement({ cashPaise: 0n, onlinePaise: R(1_000) }, ctx());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('ONLINE_LEG_NEEDS_REFERENCE');
  });

  it('INV-4 — no reason and no cap gets past the maturity amount', () => {
    const plan = planSettlement(
      { cashPaise: R(40_000), onlinePaise: 0n, reason: 'settle in full' },
      ctx(),
    );
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('EXCEEDS_CASE_TOTAL');
  });

  it('refuses a case that is not payable', () => {
    const plan = planSettlement({ cashPaise: R(100), onlinePaise: 0n }, ctx({ caseIsPayable: false }));
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('CASE_NOT_PAYABLE');
  });

  it('pays only the days the clerk ticked, even if an older unpaid day is left', () => {
    const plan = planSettlement(
      { cashPaise: R(13_000), onlinePaise: 0n },
      ctx({ allowedInstalmentIds: ['i2'] }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]?.instalmentId).toBe('i2');
  });

  it('spreads a custom amount over the ticked days, oldest first among them', () => {
    const plan = planSettlement(
      { cashPaise: R(20_000), onlinePaise: 0n },
      ctx({ allowedInstalmentIds: ['i1', 'i2'] }),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.lines.map((l) => l.instalmentId)).toEqual(['i1', 'i2']);
    expect(plan.lines[0]?.totalPaise).toBe(R(13_000));
    expect(plan.lines[1]?.totalPaise).toBe(R(7_000));
  });
});

describe('planSettlement — invariants under 20,000 random settlements', () => {
  it('never loses a paisa, never overfills a day, always pays oldest first', () => {
    let seed = 987654321;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };

    for (let run = 0; run < 20_000; run++) {
      const days = 1 + rnd(12);
      const instalments: SettleableInstalment[] = [];
      for (let d = 0; d < days; d++) {
        const amount = 1 + rnd(20_000);
        const paid = rnd(amount + 1);
        instalments.push({
          id: `i${d}`,
          seq: d + 1,
          // spread across 2026-08-28 … 2026-09-08, straddling TODAY
          dueOn: `2026-0${d % 2 === 0 ? 8 : 9}-${String(1 + rnd(28)).padStart(2, '0')}`,
          amountPaise: R(amount),
          paidCashPaise: R(paid),
          paidOnlinePaise: 0n,
        });
      }
      const scheduled = instalments.reduce((s, i) => s + i.amountPaise, 0n);
      const paidSoFar = instalments.reduce((s, i) => s + i.paidCashPaise + i.paidOnlinePaise, 0n);
      const outstanding = scheduled - paidSoFar;
      if (outstanding <= 0n) continue;

      const total = 1n + BigInt(rnd(Number(outstanding / 100n) + 1)) * 100n;
      const cash = (total / 100n / 2n) * 100n;
      const plan = planSettlement(
        { cashPaise: cash, onlinePaise: total - cash, reference: 'UTR', reason: 'fuzz' },
        {
          instalments,
          today: TODAY,
          caseTotalPaise: scheduled,
          casePaidTotalPaise: paidSoFar,
          caseIsPayable: true,
          cashAlreadyPaidTodayPaise: 0n,
          cashCapPerDayPaise: null,
        },
      );
      if (!plan.ok) continue;

      // Every paisa entered is placed on exactly one day.
      const placed = plan.lines.reduce((s, l) => s + l.totalPaise, 0n);
      expect(placed).toBe(cash + (total - cash));

      // INV-3 holds line by line: a line is its cash leg plus its online leg.
      for (const l of plan.lines) expect(l.cashPaise + l.onlinePaise).toBe(l.totalPaise);

      // No day is filled past what it still owes.
      const byId = new Map(instalments.map((i) => [i.id, i]));
      for (const l of plan.lines) {
        const i = byId.get(l.instalmentId)!;
        expect(l.totalPaise).toBeLessThanOrEqual(i.amountPaise - i.paidCashPaise - i.paidOnlinePaise);
      }

      // Oldest first, always.
      for (let k = 1; k < plan.lines.length; k++) {
        expect(plan.lines[k - 1].dueOn <= plan.lines[k].dueOn).toBe(true);
      }
    }
  });
});
