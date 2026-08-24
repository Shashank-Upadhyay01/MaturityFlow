import { describe, expect, it } from 'vitest';
import {
  groupByCustomer,
  paidOf,
  remainingOf,
  settlementOf,
  summariseBook,
  type BookCase,
} from '../src/lib/agent-book';

function mk(over: Partial<BookCase> = {}): BookCase {
  return {
    caseId: 'c1',
    caseNumber: 'AZM/2026/000001',
    customerId: 'cus1',
    customerName: 'Ram Kumar',
    accountNumber: '00100160',
    phone: null,
    schemeName: null,
    status: 'APPROVED',
    maturityAmountPaise: '10000000', // ₹1,00,000
    paidCashPaise: '0',
    paidOnlinePaise: '0',
    instrumentMaturityOn: '2026-08-01',
    formSubmittedOn: '2026-08-02',
    approvedOn: '2026-08-03',
    deadlineOn: '2026-08-24',
    paymentOn: null,
    cadence: 'DAILY',
    ...over,
  };
}

describe('settlementOf', () => {
  it('is settled once the rupees have all gone out, whatever the status says', () => {
    expect(settlementOf(mk({ paidCashPaise: '10000000', status: 'IN_PROGRESS' }))).toBe('SETTLED');
    expect(settlementOf(mk({ paidCashPaise: '6000000', paidOnlinePaise: '4000000' }))).toBe('SETTLED');
  });

  it('counts an over-payment as settled rather than as something still owed', () => {
    expect(settlementOf(mk({ paidCashPaise: '10000001' }))).toBe('SETTLED');
    expect(remainingOf(mk({ paidCashPaise: '10000001' }))).toBe(0n);
  });

  it('separates part-paid from nothing-paid', () => {
    expect(settlementOf(mk({ paidCashPaise: '1' }))).toBe('PARTLY_PAID');
    expect(settlementOf(mk())).toBe('NOTHING_YET');
  });

  it('does not blame a case that has not been approved yet', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'ON_HOLD']) {
      expect(settlementOf(mk({ status }))).toBe('NOT_STARTED');
    }
    // Approved and nothing has moved IS somebody's problem.
    expect(settlementOf(mk({ status: 'APPROVED' }))).toBe('NOTHING_YET');
  });

  it('adds both legs when reporting what was paid', () => {
    expect(paidOf(mk({ paidCashPaise: '300', paidOnlinePaise: '200' }))).toBe(500n);
  });
});

describe('groupByCustomer', () => {
  it('puts every maturity of one customer together', () => {
    const g = groupByCustomer([
      mk({ caseId: 'a', caseNumber: 'A1' }),
      mk({ caseId: 'b', caseNumber: 'A2' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].cases).toHaveLength(2);
    expect(g[0].maturityPaise).toBe(20000000n);
  });

  it('is only "all received" when every one of them is', () => {
    const partly = groupByCustomer([
      mk({ caseId: 'a', paidCashPaise: '10000000' }),
      mk({ caseId: 'b', paidCashPaise: '0' }),
    ]);
    expect(partly[0].allReceived).toBe(false);

    const all = groupByCustomer([
      mk({ caseId: 'a', paidCashPaise: '10000000' }),
      mk({ caseId: 'b', paidCashPaise: '10000000' }),
    ]);
    expect(all[0].allReceived).toBe(true);
    expect(all[0].remainingPaise).toBe(0n);
  });

  it('keeps a real account number when another row of the same customer is blank', () => {
    const g = groupByCustomer([
      mk({ caseId: 'a', accountNumber: null }),
      mk({ caseId: 'b', accountNumber: '00100160' }),
    ]);
    expect(g[0].accountNumber).toBe('00100160');
  });

  it('sorts customers by name', () => {
    const g = groupByCustomer([
      mk({ customerId: 'z', customerName: 'Zoya' }),
      mk({ customerId: 'a', customerName: 'Anil' }),
    ]);
    expect(g.map((x) => x.customerName)).toEqual(['Anil', 'Zoya']);
  });

  it('handles an empty book', () => {
    expect(groupByCustomer([])).toEqual([]);
  });
});

describe('summariseBook', () => {
  it('counts customers, not cases, when saying how many are settled', () => {
    const groups = groupByCustomer([
      // Anil: two maturities, both paid -> settled
      mk({ customerId: 'a', customerName: 'Anil', caseId: '1', paidCashPaise: '10000000' }),
      mk({ customerId: 'a', customerName: 'Anil', caseId: '2', paidCashPaise: '10000000' }),
      // Zoya: one paid, one not -> outstanding
      mk({ customerId: 'z', customerName: 'Zoya', caseId: '3', paidCashPaise: '10000000' }),
      mk({ customerId: 'z', customerName: 'Zoya', caseId: '4', paidCashPaise: '0' }),
    ]);
    const s = summariseBook(groups);
    expect(s.customers).toBe(2);
    expect(s.cases).toBe(4);
    expect(s.settledCustomers).toBe(1);
    expect(s.outstandingCustomers).toBe(1);
    expect(s.maturityPaise).toBe(40000000n);
    expect(s.paidPaise).toBe(30000000n);
    expect(s.remainingPaise).toBe(10000000n);
  });

  it('an empty book totals zero, not NaN', () => {
    const s = summariseBook([]);
    expect(s.customers).toBe(0);
    expect(s.maturityPaise).toBe(0n);
    expect(s.remainingPaise).toBe(0n);
  });
});
