/**
 * agent-book.ts — the pure rules behind an agent's customer list.
 *
 * "Has this customer had everything they are owed?" is the question the whole screen exists to
 * answer, so it lives here with tests rather than as an inline comparison in three places.
 *
 * Nothing here touches the DOM, the clock, or the database. bigint paise only.
 */

export type SettlementState = 'SETTLED' | 'PARTLY_PAID' | 'NOTHING_YET' | 'NOT_STARTED';

export interface BookCase {
  caseId: string;
  caseNumber: string;
  customerId: string;
  customerName: string;
  accountNumber: string | null;
  phone: string | null;
  schemeName: string | null;
  status: string;
  maturityAmountPaise: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  instrumentMaturityOn: string | null;
  formSubmittedOn: string | null;
  approvedOn: string | null;
  deadlineOn: string | null;
  paymentOn: string | null;
  cadence: string;
}

/** Statuses where no schedule exists yet, so "nothing paid" is expected rather than a problem. */
const BEFORE_APPROVAL = new Set(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'ON_HOLD']);

export const paidOf = (c: BookCase): bigint =>
  BigInt(c.paidCashPaise) + BigInt(c.paidOnlinePaise);

export const remainingOf = (c: BookCase): bigint => {
  const left = BigInt(c.maturityAmountPaise) - paidOf(c);
  return left > 0n ? left : 0n;
};

/**
 * Where this maturity stands.
 *
 * SETTLED is decided on the money, not on the status column: a case whose rupees have all gone
 * out is settled whatever anyone forgot to tick. NOT_STARTED separates "waiting for approval"
 * from "approved and nothing has moved", because only the second one is somebody's problem.
 */
export function settlementOf(c: BookCase): SettlementState {
  const paid = paidOf(c);
  const total = BigInt(c.maturityAmountPaise);
  if (total > 0n && paid >= total) return 'SETTLED';
  if (paid > 0n) return 'PARTLY_PAID';
  return BEFORE_APPROVAL.has(c.status) ? 'NOT_STARTED' : 'NOTHING_YET';
}

export const SETTLEMENT_LABEL: Record<SettlementState, string> = {
  SETTLED: 'Received in full',
  PARTLY_PAID: 'Part received',
  NOTHING_YET: 'Nothing received',
  NOT_STARTED: 'Not approved yet',
};

export interface CustomerGroup {
  customerId: string;
  customerName: string;
  accountNumber: string | null;
  phone: string | null;
  cases: BookCase[];
  maturityPaise: bigint;
  paidPaise: bigint;
  remainingPaise: bigint;
  /** True only when every one of this customer's maturities is settled. */
  allReceived: boolean;
}

/**
 * Group an agent's cases by customer.
 *
 * A customer with three maturities counts as received only when all three are — reporting
 * "received" off the first one would be the kind of half-truth that gets someone paid twice.
 */
export function groupByCustomer(cases: readonly BookCase[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();
  for (const c of cases) {
    let g = map.get(c.customerId);
    if (!g) {
      g = {
        customerId: c.customerId,
        customerName: c.customerName,
        accountNumber: c.accountNumber,
        phone: c.phone,
        cases: [],
        maturityPaise: 0n,
        paidPaise: 0n,
        remainingPaise: 0n,
        allReceived: true,
      };
      map.set(c.customerId, g);
    }
    g.cases.push(c);
    g.maturityPaise += BigInt(c.maturityAmountPaise);
    g.paidPaise += paidOf(c);
    g.remainingPaise += remainingOf(c);
    if (settlementOf(c) !== 'SETTLED') g.allReceived = false;
    // The account number is on the customer, but a blank on one row should not erase a real one.
    g.accountNumber ??= c.accountNumber;
    g.phone ??= c.phone;
  }
  return [...map.values()].sort((a, b) => a.customerName.localeCompare(b.customerName, 'en-IN'));
}

export interface BookSummary {
  customers: number;
  cases: number;
  maturityPaise: bigint;
  paidPaise: bigint;
  remainingPaise: bigint;
  settledCustomers: number;
  outstandingCustomers: number;
}

/** The line an agent's statement opens with. */
export function summariseBook(groups: readonly CustomerGroup[]): BookSummary {
  let maturityPaise = 0n;
  let paidPaise = 0n;
  let remainingPaise = 0n;
  let cases = 0;
  let settled = 0;
  for (const g of groups) {
    maturityPaise += g.maturityPaise;
    paidPaise += g.paidPaise;
    remainingPaise += g.remainingPaise;
    cases += g.cases.length;
    if (g.allReceived) settled += 1;
  }
  return {
    customers: groups.length,
    cases,
    maturityPaise,
    paidPaise,
    remainingPaise,
    settledCustomers: settled,
    outstandingCustomers: groups.length - settled,
  };
}
