/**
 * Daily branch cashbook arithmetic.
 *
 * Pure, deterministic and BigInt-only. The browser uses this for the live reconciliation and
 * the server uses the same function for close-day validation and reports. No database, clock or
 * I/O belongs here.
 */

import { paiseToRupeeNumber } from '@/lib/money';

export const CASHBOOK_ENTRY_CATEGORIES = [
  'OTHER_RECEIPT',
  'NEW_LOAN',
  'SAVINGS_DEPOSIT',
  'WITHDRAWAL',
  'EXPENSE',
  'RENEWAL',
  'OPENING_BALANCE',
] as const;

export type CashbookEntryCategory = (typeof CASHBOOK_ENTRY_CATEGORIES)[number];

export const CASHBOOK_ENTRY_CHANNELS = ['CASH', 'ACCOUNT'] as const;
export type CashbookEntryChannel = (typeof CASHBOOK_ENTRY_CHANNELS)[number];

export const CASHBOOK_COMMITMENT_KINDS = [
  'GIVEN_CASH',
  'DUE_AMOUNT',
  'PENDING_WITHDRAWAL',
] as const;
export type CashbookCommitmentKind = (typeof CASHBOOK_COMMITMENT_KINDS)[number];

export interface CashbookCategoryMeta {
  label: string;
  shortLabel: string;
  direction: 'IN' | 'OUT' | 'OPENING';
  description: string;
}

export const CASHBOOK_CATEGORY_META: Record<CashbookEntryCategory, CashbookCategoryMeta> = {
  OTHER_RECEIPT: {
    label: 'Receiving / other receipt',
    shortLabel: 'Receiving',
    direction: 'IN',
    description: 'Money received today that is not a loan, savings deposit or renewal.',
  },
  NEW_LOAN: {
    label: 'New loan',
    shortLabel: 'New loan',
    direction: 'IN',
    description: 'Loans received today for entry on the new portal.',
  },
  SAVINGS_DEPOSIT: {
    label: 'Savings deposit',
    shortLabel: 'Savings',
    direction: 'IN',
    description: 'Savings deposits received today.',
  },
  WITHDRAWAL: {
    label: 'Withdrawal',
    shortLabel: 'Withdrawal',
    direction: 'OUT',
    description: 'All withdrawals recorded for the day.',
  },
  EXPENSE: {
    label: 'Expenses',
    shortLabel: 'Expenses',
    direction: 'OUT',
    description: 'Branch expenses paid during the day.',
  },
  RENEWAL: {
    label: 'Renewal',
    shortLabel: 'Renewal',
    direction: 'IN',
    description: 'Recurring-deposit renewals. The selected channel also feeds Receiving or By account.',
  },
  OPENING_BALANCE: {
    label: 'Opening balance',
    shortLabel: 'Opening',
    direction: 'OPENING',
    description: 'Physical cash available when the branch opens.',
  },
};

export const CASHBOOK_COMMITMENT_META: Record<
  CashbookCommitmentKind,
  { label: string; shortLabel: string; description: string }
> = {
  GIVEN_CASH: {
    label: 'Given cash',
    shortLabel: 'Given cash',
    description: 'Cash temporarily handed to a named person.',
  },
  DUE_AMOUNT: {
    label: 'Due amount',
    shortLabel: 'Due',
    description: 'Money due from a named person.',
  },
  PENDING_WITHDRAWAL: {
    label: 'Pending withdrawal',
    shortLabel: 'Pending W/D',
    description: 'A withdrawal that is paid or prepared but still pending processing.',
  },
};

export const CASHBOOK_DENOMINATIONS = [
  { field: 'note500Count', label: '₹500', rupees: 500n, paise: 50_000n },
  { field: 'note200Count', label: '₹200', rupees: 200n, paise: 20_000n },
  { field: 'note100Count', label: '₹100', rupees: 100n, paise: 10_000n },
  { field: 'note50Count', label: '₹50', rupees: 50n, paise: 5_000n },
  { field: 'note20Count', label: '₹20', rupees: 20n, paise: 2_000n },
  { field: 'note10Count', label: '₹10', rupees: 10n, paise: 1_000n },
] as const;

export type CashbookDenominationField = (typeof CASHBOOK_DENOMINATIONS)[number]['field'];

export interface CashbookDayFigures {
  oldPortalTotalPaise: bigint;
  fixedDepositPaise: bigint;
  newBusinessPaise: bigint;
  membershipCollectionPaise: bigint;
  oldLoanPaise: bigint;
  note500Count: number;
  note200Count: number;
  note100Count: number;
  note50Count: number;
  note20Count: number;
  note10Count: number;
  /** The spreadsheet's “₹1” row means the aggregate value of every metal coin, not a count. */
  coinsPaise: bigint;
}

export const EMPTY_CASHBOOK_DAY_FIGURES: CashbookDayFigures = {
  oldPortalTotalPaise: 0n,
  fixedDepositPaise: 0n,
  newBusinessPaise: 0n,
  membershipCollectionPaise: 0n,
  oldLoanPaise: 0n,
  note500Count: 0,
  note200Count: 0,
  note100Count: 0,
  note50Count: 0,
  note20Count: 0,
  note10Count: 0,
  coinsPaise: 0n,
};

export interface CashbookAmountEntry {
  category: CashbookEntryCategory;
  channel: CashbookEntryChannel;
  amountPaise: bigint;
  /** Voided rows stay in storage and the audit trail but never affect a total. */
  voided?: boolean;
}

export interface CashbookCommitmentAmount {
  kind: CashbookCommitmentKind;
  amountPaise: bigint;
  voided?: boolean;
}

export type CashbookReconciliationState = 'EMPTY' | 'BALANCED' | 'SHORT' | 'EXCESS';

export interface DailyCashbookTotals {
  byCategory: Record<CashbookEntryCategory, bigint>;
  receivingPaise: bigint;
  byAccountPaise: bigint;
  openingBalancePaise: bigint;
  totalAmountPaise: bigint;
  deductionsPaise: bigint;
  expectedPhysicalCashPaise: bigint;
  countedCashPaise: bigint;
  /** Counted cash − expected physical cash: negative is short, positive is excess. */
  cashDifferencePaise: bigint;
  /** Renewal + the four manually reported business figures. A diagnostic, never cash flow. */
  portalBreakdownPaise: bigint;
  /** Old portal total − the reported breakdown. Zero means the two sources agree. */
  portalVariancePaise: bigint;
  givenCashPaise: bigint;
  dueAmountPaise: bigint;
  pendingWithdrawalPaise: bigint;
  hasActivity: boolean;
  state: CashbookReconciliationState;
  warnings: ('NEGATIVE_EXPECTED_CASH')[];
}

export class CashbookInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CashbookInputError';
  }
}

function assertNonNegativeMoney(label: string, value: bigint): void {
  if (value < 0n) throw new CashbookInputError(`${label} cannot be negative.`);
}

function assertCount(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CashbookInputError(`${label} must be a non-negative whole number.`);
  }
}

function emptyCategoryTotals(): Record<CashbookEntryCategory, bigint> {
  return Object.fromEntries(CASHBOOK_ENTRY_CATEGORIES.map((category) => [category, 0n])) as Record<
    CashbookEntryCategory,
    bigint
  >;
}

/**
 * The exact formula from the working sheet.
 *
 * available = opening + old portal + new loan + savings deposit
 * expected physical = available − by account − withdrawals − expenses
 * difference = counted denominations − expected physical
 *
 * Receiving and renewal are reporting totals: the old-portal number already carries the day's
 * accumulated source total, so adding them again would double count the same money.
 */
export function calculateDailyCashbook(
  entries: readonly CashbookAmountEntry[],
  figures: CashbookDayFigures,
  commitments: readonly CashbookCommitmentAmount[] = [],
): DailyCashbookTotals {
  for (const field of [
    ['Old portal total', figures.oldPortalTotalPaise],
    ['Fixed deposit', figures.fixedDepositPaise],
    ['New business', figures.newBusinessPaise],
    ['Membership collection', figures.membershipCollectionPaise],
    ['Old loan', figures.oldLoanPaise],
    ['Coins', figures.coinsPaise],
  ] as const) {
    assertNonNegativeMoney(field[0], field[1]);
  }

  for (const denomination of CASHBOOK_DENOMINATIONS) {
    assertCount(denomination.label, figures[denomination.field]);
  }

  const byCategory = emptyCategoryTotals();
  for (const entry of entries) {
    if (entry.voided) continue;
    assertNonNegativeMoney(CASHBOOK_CATEGORY_META[entry.category].label, entry.amountPaise);
    byCategory[entry.category] += entry.amountPaise;
  }

  /*
    Receiving and By account are the two ends of ONE category — a receipt that came over the
    counter and a receipt that came into the bank account. They used to sum every receipt
    category on their channel, which meant a new loan or a renewal was counted under Receiving as
    well as under its own column, and the sheet appeared to double count.

    Only Receiving is narrowed. `expectedPhysicalCash` never read `receivingPaise`, so that is a
    display correction and the 19-Aug working sheet still reconciles to the paisa. `byAccountPaise`
    is a DEDUCTION and stays wide: narrowing it would silently change expected cash for an
    account-channel renewal, which is a different decision from the one asked for.
  */
  const receivingPaise = entries.reduce(
    (sum, entry) =>
      !entry.voided && entry.channel === 'CASH' && entry.category === 'OTHER_RECEIPT'
        ? sum + entry.amountPaise
        : sum,
    0n,
  );
  const receiptCategories: ReadonlySet<CashbookEntryCategory> = new Set([
    'OTHER_RECEIPT',
    'NEW_LOAN',
    'SAVINGS_DEPOSIT',
    'RENEWAL',
  ]);
  const byAccountPaise = entries.reduce(
    (sum, entry) =>
      !entry.voided && entry.channel === 'ACCOUNT' && receiptCategories.has(entry.category)
        ? sum + entry.amountPaise
        : sum,
    0n,
  );

  const openingBalancePaise = byCategory.OPENING_BALANCE;
  const totalAmountPaise =
    openingBalancePaise +
    figures.oldPortalTotalPaise +
    byCategory.NEW_LOAN +
    byCategory.SAVINGS_DEPOSIT;
  const deductionsPaise = byAccountPaise + byCategory.WITHDRAWAL + byCategory.EXPENSE;
  const expectedPhysicalCashPaise = totalAmountPaise - deductionsPaise;

  const countedNotesPaise = CASHBOOK_DENOMINATIONS.reduce(
    (sum, denomination) =>
      sum + BigInt(figures[denomination.field]) * denomination.paise,
    0n,
  );
  const countedCashPaise = countedNotesPaise + figures.coinsPaise;
  const cashDifferencePaise = countedCashPaise - expectedPhysicalCashPaise;
  const portalBreakdownPaise =
    byCategory.RENEWAL +
    figures.fixedDepositPaise +
    figures.newBusinessPaise +
    figures.membershipCollectionPaise +
    figures.oldLoanPaise;
  const portalVariancePaise = figures.oldPortalTotalPaise - portalBreakdownPaise;

  const commitmentTotals = Object.fromEntries(
    CASHBOOK_COMMITMENT_KINDS.map((kind) => [kind, 0n]),
  ) as Record<CashbookCommitmentKind, bigint>;
  for (const commitment of commitments) {
    if (commitment.voided) continue;
    assertNonNegativeMoney(CASHBOOK_COMMITMENT_META[commitment.kind].label, commitment.amountPaise);
    commitmentTotals[commitment.kind] += commitment.amountPaise;
  }

  const hasActivity =
    entries.some((entry) => !entry.voided && entry.amountPaise > 0n) ||
    commitments.some((commitment) => !commitment.voided && commitment.amountPaise > 0n) ||
    Object.values(figures).some((value) =>
      typeof value === 'bigint' ? value > 0n : typeof value === 'number' ? value > 0 : false,
    );

  const state: CashbookReconciliationState = !hasActivity
    ? 'EMPTY'
    : cashDifferencePaise === 0n
      ? 'BALANCED'
      : cashDifferencePaise < 0n
        ? 'SHORT'
        : 'EXCESS';

  return {
    byCategory,
    receivingPaise,
    byAccountPaise,
    openingBalancePaise,
    totalAmountPaise,
    deductionsPaise,
    expectedPhysicalCashPaise,
    countedCashPaise,
    cashDifferencePaise,
    portalBreakdownPaise,
    portalVariancePaise,
    givenCashPaise: commitmentTotals.GIVEN_CASH,
    dueAmountPaise: commitmentTotals.DUE_AMOUNT,
    pendingWithdrawalPaise: commitmentTotals.PENDING_WITHDRAWAL,
    hasActivity,
    state,
    warnings: expectedPhysicalCashPaise < 0n ? ['NEGATIVE_EXPECTED_CASH'] : [],
  };
}

/* ── The cash-flow chart's rules ──────────────────────────────────────────────
   These live here, beside calculateDailyCashbook, because they are the same
   arithmetic seen from the side: the walk the chart draws has to land on the
   figure the book already computed. Keeping them in the component let the two
   drift silently — a picture disagreeing with the ledger is the worst bug this
   panel can have, and it would look perfectly normal on screen. */

export interface CashFlowPoint {
  label: string;
  /** Short form for the X axis — the panel is narrow and resizable. */
  shortLabel: string;
  deltaPaise: bigint;
  valuePaise: bigint;
}

export interface CashFlowInputs {
  openingBalancePaise: bigint;
  oldPortalTotalPaise: bigint;
  newLoanPaise: bigint;
  savingsDepositPaise: bigint;
  byAccountPaise: bigint;
  withdrawalsPaise: bigint;
  expensesPaise: bigint;
  expectedPhysicalCashPaise: bigint;
}

/**
 * The day's cash position, step by step: opening balance, each receipt added, each
 * deduction subtracted, ending on the expected physical cash the reconciliation reached.
 *
 * INVARIANT: the walk's last computed step equals `expectedPhysicalCashPaise`, because it
 * applies exactly the receipts and deductions `calculateDailyCashbook()` applies. If those
 * two ever disagree the chart is drawing a cash position the ledger denies, so
 * `tests/daily-cashbook.test.ts` pins it.
 */
export function cashFlowSeries(input: CashFlowInputs): CashFlowPoint[] {
  let running = input.openingBalancePaise;
  const points: CashFlowPoint[] = [
    {
      label: 'Opening balance',
      shortLabel: 'Open',
      deltaPaise: input.openingBalancePaise,
      valuePaise: running,
    },
  ];
  const step = (label: string, shortLabel: string, deltaPaise: bigint) => {
    running += deltaPaise;
    points.push({ label, shortLabel, deltaPaise, valuePaise: running });
  };
  step('Old portal total', 'Portal', input.oldPortalTotalPaise);
  step('New loan', 'Loan', input.newLoanPaise);
  step('Savings deposit', 'Saving', input.savingsDepositPaise);
  step('By account', 'Account', -input.byAccountPaise);
  step('Withdrawals', 'W/D', -input.withdrawalsPaise);
  step('Expenses', 'Expense', -input.expensesPaise);
  points.push({
    label: 'Expected physical cash',
    shortLabel: 'Expected',
    deltaPaise: 0n,
    valuePaise: input.expectedPhysicalCashPaise,
  });
  return points;
}

/**
 * The chart's Y range, in RUPEES — Recharts plots numbers, not BigInt.
 *
 * Computed here rather than left to the chart library. `<ReferenceLine ifOverflow="extendDomain">`
 * reads as though it stretches the axis to reach the counted-cash line, and it does not: against
 * an all-zero series the domain stayed [0, 4] and a ₹3,57,000 count was placed at
 * y = -16,511,051px — drawn, but sixteen million pixels off-canvas, so the panel looked dead.
 * Counted-versus-expected is the entire point of this chart, so the count is inside the range by
 * construction. Never hand this back to the library.
 */
export function cashFlowDomain(
  points: readonly CashFlowPoint[],
  countedCashPaise: bigint,
): [number, number] {
  const values = points.map((item) => paiseToRupeeNumber(item.valuePaise));
  values.push(paiseToRupeeNumber(countedCashPaise));
  const high = Math.max(...values, 0);
  const low = Math.min(...values, 0);
  // Everything is zero: a flat baseline, not a fabricated ₹0–₹4 ramp.
  if (high === low) return [0, 1];
  const pad = (high - low) * 0.08;
  // Cash only goes below zero when deductions overdraw the day; don't invent negative space.
  return [low < 0 ? low - pad : 0, high + pad];
}

/* ── The note mix ─────────────────────────────────────────────────────────────
   Which denomination the drawer actually holds most of. A cashier needs this to
   answer a different question from "how much is there": whether there are enough
   small notes left to make change. Ranked by COUNT, not by value — ninety ₹10
   notes outrank two ₹500s here, and that is the point. */

export interface NoteMixRow {
  field: CashbookDenominationField;
  /** '₹500' — already carries the rupee sign. */
  label: string;
  rupees: bigint;
  count: number;
  valuePaise: bigint;
  /** 0–1, this row's count against the largest holding. Zero on an uncounted day. */
  share: number;
}

/**
 * The counted notes, most numerous first.
 *
 * Coins are deliberately absent: `coinsPaise` is a lump value, not a count, so there is no
 * quantity to rank it by. The caller reports coins separately rather than inventing a bar.
 */
export function noteMixRows(figures: CashbookDayFigures): NoteMixRow[] {
  const rows: NoteMixRow[] = CASHBOOK_DENOMINATIONS.map((denomination) => {
    const count = Math.max(0, Math.trunc(figures[denomination.field]) || 0);
    return {
      field: denomination.field,
      label: denomination.label,
      rupees: denomination.rupees,
      count,
      valuePaise: BigInt(count) * denomination.paise,
      share: 0,
    };
  });
  // Most notes first. A tie goes to the larger note, so a drawer holding 500 × ₹500 and
  // 500 × ₹50 reports ₹500 as the headline rather than whichever the array happened to
  // list first — an unstable headline on a money screen reads as a bug.
  rows.sort((a, b) => b.count - a.count || Number(b.rupees - a.rupees));
  const highest = Math.max(...rows.map((row) => row.count), 0);
  if (highest === 0) return rows;
  return rows.map((row) => ({ ...row, share: row.count / highest }));
}

/** The denomination there are most of, or null when nothing has been counted yet. */
export function largestNoteHolding(rows: readonly NoteMixRow[]): NoteMixRow | null {
  const [first] = rows;
  return first && first.count > 0 ? first : null;
}
