import { describe, expect, it } from 'vitest';

import {
  EMPTY_CASHBOOK_DAY_FIGURES,
  calculateDailyCashbook,
  cashFlowDomain,
  cashFlowSeries,
  largestNoteHolding,
  noteMixRows,
  type CashbookAmountEntry,
} from '@/lib/daily-cashbook';

const rupees = (value: number | bigint) => BigInt(value) * 100n;

describe('daily cashbook reconciliation', () => {
  it('reproduces the attached 19-Aug-2026 working sheet exactly', () => {
    const entries: CashbookAmountEntry[] = [
      { category: 'OPENING_BALANCE', channel: 'CASH', amountPaise: rupees(455_108) },
      { category: 'NEW_LOAN', channel: 'CASH', amountPaise: rupees(6_174) },
      { category: 'SAVINGS_DEPOSIT', channel: 'CASH', amountPaise: rupees(279) },
      { category: 'RENEWAL', channel: 'CASH', amountPaise: rupees(637_100) },
      { category: 'OTHER_RECEIPT', channel: 'CASH', amountPaise: rupees(227_270) },
      { category: 'OTHER_RECEIPT', channel: 'ACCOUNT', amountPaise: rupees(180_087) },
      { category: 'WITHDRAWAL', channel: 'CASH', amountPaise: rupees(840_720) },
      { category: 'EXPENSE', channel: 'CASH', amountPaise: rupees(22_520) },
    ];

    const totals = calculateDailyCashbook(entries, {
      ...EMPTY_CASHBOOK_DAY_FIGURES,
      oldPortalTotalPaise: rupees(642_690),
      newBusinessPaise: rupees(4_750),
      membershipCollectionPaise: rupees(840),
      note500Count: 83,
      note200Count: 3,
      note100Count: 35,
      note50Count: 135,
      note20Count: 242,
      note10Count: 299,
      coinsPaise: rupees(744),
    }, [{ kind: 'GIVEN_CASH', amountPaise: rupees(8_500) }]);

    expect(totals.totalAmountPaise).toBe(rupees(1_104_251));
    expect(totals.deductionsPaise).toBe(rupees(1_043_327));
    expect(totals.expectedPhysicalCashPaise).toBe(rupees(60_924));
    expect(totals.countedCashPaise).toBe(rupees(60_924));
    expect(totals.cashDifferencePaise).toBe(0n);
    expect(totals.portalBreakdownPaise).toBe(rupees(642_690));
    expect(totals.portalVariancePaise).toBe(0n);
    expect(totals.state).toBe('BALANCED');
    expect(totals.receivingPaise).toBe(rupees(870_823));
    expect(totals.byAccountPaise).toBe(rupees(180_087));
    expect(totals.byCategory.RENEWAL).toBe(rupees(637_100));
    expect(totals.givenCashPaise).toBe(rupees(8_500));
  });

  it('uses the sign the clerk expects: negative is short and positive is excess', () => {
    const entries: CashbookAmountEntry[] = [
      { category: 'OPENING_BALANCE', channel: 'CASH', amountPaise: rupees(1_000) },
    ];

    const short = calculateDailyCashbook(entries, {
      ...EMPTY_CASHBOOK_DAY_FIGURES,
      note500Count: 1,
    });
    expect(short.cashDifferencePaise).toBe(rupees(-500));
    expect(short.state).toBe('SHORT');

    const excess = calculateDailyCashbook(entries, {
      ...EMPTY_CASHBOOK_DAY_FIGURES,
      note500Count: 3,
    });
    expect(excess.cashDifferencePaise).toBe(rupees(500));
    expect(excess.state).toBe('EXCESS');
  });

  it('keeps voided rows as history without counting them', () => {
    const totals = calculateDailyCashbook(
      [
        { category: 'OTHER_RECEIPT', channel: 'CASH', amountPaise: rupees(10_000) },
        { category: 'OTHER_RECEIPT', channel: 'CASH', amountPaise: rupees(99_999), voided: true },
      ],
      EMPTY_CASHBOOK_DAY_FIGURES,
    );
    expect(totals.receivingPaise).toBe(rupees(10_000));
  });

  it('does not call an untouched zero sheet balanced', () => {
    const totals = calculateDailyCashbook([], EMPTY_CASHBOOK_DAY_FIGURES);
    expect(totals.hasActivity).toBe(false);
    expect(totals.state).toBe('EMPTY');
  });

  it('warns when deductions exceed all available money', () => {
    const totals = calculateDailyCashbook(
      [{ category: 'WITHDRAWAL', channel: 'CASH', amountPaise: rupees(1) }],
      EMPTY_CASHBOOK_DAY_FIGURES,
    );
    expect(totals.expectedPhysicalCashPaise).toBe(rupees(-1));
    expect(totals.warnings).toEqual(['NEGATIVE_EXPECTED_CASH']);
  });

  it('enters a renewal once and projects it into the correct receipt channel', () => {
    const cash = calculateDailyCashbook(
      [{ category: 'RENEWAL', channel: 'CASH', amountPaise: rupees(500) }],
      { ...EMPTY_CASHBOOK_DAY_FIGURES, oldPortalTotalPaise: rupees(500) },
    );
    expect(cash.byCategory.RENEWAL).toBe(rupees(500));
    expect(cash.receivingPaise).toBe(rupees(500));
    expect(cash.byAccountPaise).toBe(0n);

    const account = calculateDailyCashbook(
      [{ category: 'RENEWAL', channel: 'ACCOUNT', amountPaise: rupees(500) }],
      { ...EMPTY_CASHBOOK_DAY_FIGURES, oldPortalTotalPaise: rupees(500) },
    );
    expect(account.byCategory.RENEWAL).toBe(rupees(500));
    expect(account.receivingPaise).toBe(0n);
    expect(account.byAccountPaise).toBe(rupees(500));
    expect(account.expectedPhysicalCashPaise).toBe(0n);
  });
});

describe('cash flow chart rules', () => {
  const inputs = {
    openingBalancePaise: rupees(455_108),
    oldPortalTotalPaise: rupees(637_100),
    newLoanPaise: rupees(6_174),
    savingsDepositPaise: rupees(279),
    byAccountPaise: rupees(180_087),
    withdrawalsPaise: rupees(840_720),
    expensesPaise: rupees(12_500),
    expectedPhysicalCashPaise: 0n,
  };
  // opening + portal + loan + savings − account − withdrawals − expenses
  const walked = rupees(455_108 + 637_100 + 6_174 + 279 - 180_087 - 840_720 - 12_500);

  it('walks opening balance through every movement to the expected cash', () => {
    const points = cashFlowSeries({ ...inputs, expectedPhysicalCashPaise: walked });
    expect(points.map((p) => p.shortLabel)).toEqual([
      'Open', 'Portal', 'Loan', 'Saving', 'Account', 'W/D', 'Expense', 'Expected',
    ]);
    expect(points[0].valuePaise).toBe(inputs.openingBalancePaise);
    // Receipts add, deductions subtract — the signs the sheet reports them with.
    expect(points[1].deltaPaise).toBe(inputs.oldPortalTotalPaise);
    expect(points[4].deltaPaise).toBe(-inputs.byAccountPaise);
    expect(points[5].deltaPaise).toBe(-inputs.withdrawalsPaise);
    expect(points[6].deltaPaise).toBe(-inputs.expensesPaise);
  });

  it('INVARIANT: the walk lands exactly on the book\u2019s expected physical cash', () => {
    // The picture must never disagree with the ledger. Cross-check the walk against
    // calculateDailyCashbook rather than against a number typed into this test.
    const entries: CashbookAmountEntry[] = [
      { category: 'OPENING_BALANCE', channel: 'CASH', amountPaise: rupees(455_108) },
      { category: 'NEW_LOAN', channel: 'CASH', amountPaise: rupees(6_174) },
      { category: 'SAVINGS_DEPOSIT', channel: 'CASH', amountPaise: rupees(279) },
      { category: 'OTHER_RECEIPT', channel: 'ACCOUNT', amountPaise: rupees(180_087) },
      { category: 'WITHDRAWAL', channel: 'CASH', amountPaise: rupees(840_720) },
      { category: 'EXPENSE', channel: 'CASH', amountPaise: rupees(12_500) },
    ];
    const totals = calculateDailyCashbook(entries, {
      ...EMPTY_CASHBOOK_DAY_FIGURES,
      oldPortalTotalPaise: rupees(637_100),
    });
    const points = cashFlowSeries({
      openingBalancePaise: totals.openingBalancePaise,
      oldPortalTotalPaise: rupees(637_100),
      newLoanPaise: totals.byCategory.NEW_LOAN,
      savingsDepositPaise: totals.byCategory.SAVINGS_DEPOSIT,
      byAccountPaise: totals.byAccountPaise,
      withdrawalsPaise: totals.byCategory.WITHDRAWAL,
      expensesPaise: totals.byCategory.EXPENSE,
      expectedPhysicalCashPaise: totals.expectedPhysicalCashPaise,
    });
    // The last COMPUTED step (before the reported figure) must equal the book's answer.
    expect(points[6].valuePaise).toBe(totals.expectedPhysicalCashPaise);
    expect(points[7].valuePaise).toBe(totals.expectedPhysicalCashPaise);
  });

  it('keeps the counted-cash line inside the range even when nothing else moved', () => {
    // The bug this pins: an all-zero series left the domain at [0, 4] and put a
    // \u20B93,57,000 count at y = -16,511,051px, so the panel looked dead.
    const flat = cashFlowSeries({
      openingBalancePaise: 0n, oldPortalTotalPaise: 0n, newLoanPaise: 0n,
      savingsDepositPaise: 0n, byAccountPaise: 0n, withdrawalsPaise: 0n,
      expensesPaise: 0n, expectedPhysicalCashPaise: 0n,
    });
    const [low, high] = cashFlowDomain(flat, rupees(357_000));
    expect(low).toBe(0);
    expect(high).toBeGreaterThanOrEqual(357_000);
  });

  it('covers the whole walk and the count together', () => {
    const points = cashFlowSeries({ ...inputs, expectedPhysicalCashPaise: walked });
    const [low, high] = cashFlowDomain(points, rupees(70_000));
    const values = points.map((p) => Number(p.valuePaise / 100n));
    expect(low).toBeLessThanOrEqual(Math.min(...values, 70_000));
    expect(high).toBeGreaterThanOrEqual(Math.max(...values, 70_000));
  });

  it('opens negative headroom only when the day is actually overdrawn', () => {
    const overdrawn = cashFlowSeries({
      openingBalancePaise: 0n, oldPortalTotalPaise: 0n, newLoanPaise: 0n,
      savingsDepositPaise: 0n, byAccountPaise: 0n, withdrawalsPaise: rupees(5_000),
      expensesPaise: 0n, expectedPhysicalCashPaise: rupees(-5_000),
    });
    expect(cashFlowDomain(overdrawn, 0n)[0]).toBeLessThan(-5_000);
    // ...and never below zero when it is not.
    const healthy = cashFlowSeries({ ...inputs, expectedPhysicalCashPaise: walked });
    expect(cashFlowDomain(healthy, 0n)[0]).toBe(0);
  });

  it('gives an all-zero day a flat baseline instead of a fabricated ramp', () => {
    const flat = cashFlowSeries({
      openingBalancePaise: 0n, oldPortalTotalPaise: 0n, newLoanPaise: 0n,
      savingsDepositPaise: 0n, byAccountPaise: 0n, withdrawalsPaise: 0n,
      expensesPaise: 0n, expectedPhysicalCashPaise: 0n,
    });
    expect(cashFlowDomain(flat, 0n)).toEqual([0, 1]);
  });
});

describe('note mix', () => {
  // The drawer from the 27-Aug-2026 count: ₹500 and ₹50 are BOTH 500 notes.
  const counted = {
    ...EMPTY_CASHBOOK_DAY_FIGURES,
    note500Count: 500,
    note200Count: 200,
    note100Count: 400,
    note50Count: 500,
    note20Count: 100,
    note10Count: 0,
  };

  it('ranks the denominations by how many notes are held', () => {
    const rows = noteMixRows(counted);
    expect(rows.map((r) => r.count)).toEqual([500, 500, 400, 200, 100, 0]);
  });

  it('breaks a tie on note value, so ₹500 outranks ₹50 at 500 notes each', () => {
    const rows = noteMixRows(counted);
    expect(rows.slice(0, 2).map((r) => r.label)).toEqual(['₹500', '₹50']);
  });

  it('measures each bar against the largest holding', () => {
    const rows = noteMixRows(counted);
    expect(rows[0].share).toBe(1);
    expect(rows[2].share).toBeCloseTo(400 / 500);
    expect(rows[5].share).toBe(0);
  });

  it('values each row at count × the note', () => {
    const rows = noteMixRows(counted);
    const five = rows.find((r) => r.label === '₹500')!;
    expect(five.valuePaise).toBe(rupees(2_50_000));
    // The rows must still add up to what the book counts as cash in hand, minus coins.
    const notes = rows.reduce((sum, r) => sum + r.valuePaise, 0n);
    const totals = calculateDailyCashbook([], counted);
    expect(notes).toBe(totals.countedCashPaise);
  });

  it('names the most-held note, and nothing at all on an uncounted day', () => {
    expect(largestNoteHolding(noteMixRows(counted))?.label).toBe('₹500');
    expect(largestNoteHolding(noteMixRows(EMPTY_CASHBOOK_DAY_FIGURES))).toBeNull();
  });

  it('draws no bars when nothing has been counted', () => {
    const rows = noteMixRows(EMPTY_CASHBOOK_DAY_FIGURES);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.share === 0 && r.count === 0)).toBe(true);
  });

  it('ranks by quantity, not by value — many small notes outrank few large ones', () => {
    const rows = noteMixRows({ ...EMPTY_CASHBOOK_DAY_FIGURES, note500Count: 2, note10Count: 90 });
    expect(rows[0].label).toBe('₹10');
    expect(largestNoteHolding(rows)?.count).toBe(90);
  });
});
