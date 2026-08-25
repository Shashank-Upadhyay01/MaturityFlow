import { describe, expect, it } from 'vitest';
import {
  bandOf,
  buildPlanRow,
  defaultPartsFor,
  summariseBand,
  summariseToday,
  type PlanCase,
  type PlanInstalment,
} from '../src/lib/plan-view';
import { countWorkingDaysBetween, makeCalendar } from '../src/lib/working-days';

const cal = makeCalendar();
const TODAY = '2026-08-25'; // a Tuesday
const LAKH = 10_000_000n;

function mk(over: Partial<PlanCase> = {}): PlanCase {
  return {
    caseId: 'c1',
    caseNumber: 'AZM/2026/000001',
    customerName: 'Ram Kumar',
    accountNumber: '001001',
    phone: null,
    agentName: 'Anil Barnwal',
    status: 'SUBMITTED',
    maturityAmountPaise: '12000000', // ₹1,20,000
    paidCashPaise: '0',
    paidOnlinePaise: '0',
    windowDays: 15,
    roundingPaise: '100000', // ₹1,000
    distribution: 'FRONT_LOADED',
    cadence: 'DAILY',
    cashPolicy: 'CASH_ONLY',
    cashCapPerDayPaise: null,
    startOnNextWorkingDay: false,
    approvedOn: null,
    deadlineOn: null,
    ...over,
  };
}

const inst = (over: Partial<PlanInstalment> = {}): PlanInstalment => ({
  caseId: 'c1',
  seq: 1,
  dueOn: TODAY,
  amountPaise: '1000000',
  paidCashPaise: '0',
  paidOnlinePaise: '0',
  status: 'PENDING',
  ...over,
});

const sum = (xs: readonly { amountPaise: bigint }[]) => xs.reduce((a, x) => a + x.amountPaise, 0n);

describe('the ₹1 lakh band', () => {
  it('puts exactly ₹1,00,000 in the large column', () => {
    expect(bandOf(LAKH)).toBe('LARGE');
    expect(bandOf(LAKH - 1n)).toBe('SMALL');
  });

  it('defaults to 12 parts above the line and 6 below it', () => {
    expect(defaultPartsFor(LAKH, 15)).toBe(12);
    expect(defaultPartsFor(LAKH - 1n, 15)).toBe(6);
  });
});

describe('projecting an unapproved case', () => {
  it('splits a large maturity across 12 consecutive working days', () => {
    const r = buildPlanRow(mk(), [], cal, TODAY);
    expect(r.band).toBe('LARGE');
    expect(r.parts).toBe(12);
    expect(r.days).toHaveLength(12);
    expect(r.isProjection).toBe(true);
    expect(sum(r.days)).toBe(12_000_000n);
    for (let i = 0; i + 1 < r.days.length; i++) {
      expect(countWorkingDaysBetween(r.days[i].dueOn, r.days[i + 1].dueOn, cal)).toBe(2);
    }
  });

  it('splits a small maturity across 6 alternate working days', () => {
    const r = buildPlanRow(mk({ maturityAmountPaise: '6000000', cadence: 'ALTERNATE' }), [], cal, TODAY);
    expect(r.band).toBe('SMALL');
    expect(r.parts).toBe(6);
    expect(sum(r.days)).toBe(6_000_000n);
    for (let i = 0; i + 1 < r.days.length; i++) {
      expect(countWorkingDaysBetween(r.days[i].dueOn, r.days[i + 1].dueOn, cal)).toBe(3);
    }
  });

  it('treats a small amount as alternate-day even if the stored cadence says otherwise', () => {
    // The amount is the rule. A stale cadence column must not put a ₹50,000 case on daily payouts.
    const r = buildPlanRow(mk({ maturityAmountPaise: '5000000', cadence: 'DAILY' }), [], cal, TODAY);
    expect(r.band).toBe('SMALL');
    expect(r.cadence).toBe('ALTERNATE');
  });

  it('leaves the first three working days clear for processing', () => {
    const r = buildPlanRow(mk(), [], cal, TODAY);
    expect(countWorkingDaysBetween(TODAY, r.days[0].dueOn, cal)).toBe(4); // W0..W3 inclusive
  });

  it('still sums to the maturity amount on an amount that does not divide evenly', () => {
    const r = buildPlanRow(mk({ maturityAmountPaise: '12345678' }), [], cal, TODAY);
    expect(sum(r.days)).toBe(12_345_678n);
  });
});

describe('a custom number of parts', () => {
  it('splits across exactly the number asked for', () => {
    const r = buildPlanRow(mk(), [], cal, TODAY, 5);
    expect(r.parts).toBe(5);
    expect(r.days).toHaveLength(5);
    expect(sum(r.days)).toBe(12_000_000n);
  });

  it('projects even when a real schedule exists — changing the days is a reschedule', () => {
    const real = [inst({ seq: 1 }), inst({ seq: 2, dueOn: '2026-08-26' })];
    const withReal = buildPlanRow(mk({ approvedOn: '2026-08-20' }), real, cal, TODAY);
    expect(withReal.isProjection).toBe(false);
    expect(withReal.parts).toBe(2);

    const whatIf = buildPlanRow(mk({ approvedOn: '2026-08-20' }), real, cal, TODAY, 4);
    expect(whatIf.isProjection).toBe(true);
    expect(whatIf.parts).toBe(4);
  });

  it('reports a bad part count instead of throwing', () => {
    expect(buildPlanRow(mk(), [], cal, TODAY, 0).error).toBeTruthy();
    expect(buildPlanRow(mk(), [], cal, TODAY, 1.5).error).toBeTruthy();
    expect(buildPlanRow(mk(), [], cal, TODAY, 0).days).toHaveLength(0);
  });

  it('reports a row with no amount instead of throwing', () => {
    const r = buildPlanRow(mk({ maturityAmountPaise: '0' }), [], cal, TODAY);
    expect(r.error).toBeTruthy();
    expect(r.days).toHaveLength(0);
    expect(r.perDayPaise).toBe(0n);
  });
});

describe('a real schedule is shown as fact', () => {
  it('uses the stored rows and marks what has been paid', () => {
    const real = [
      inst({ seq: 1, dueOn: '2026-08-20', paidCashPaise: '1000000' }),
      inst({ seq: 2, dueOn: '2026-08-21', paidCashPaise: '400000' }),
      inst({ seq: 3, dueOn: TODAY }),
      inst({ seq: 4, dueOn: '2026-08-26' }),
    ];
    const r = buildPlanRow(mk({ approvedOn: '2026-08-19' }), real, cal, TODAY);
    expect(r.isProjection).toBe(false);
    expect(r.days.map((d) => d.state)).toEqual(['PAID', 'PARTIAL', 'DUE_TODAY', 'UPCOMING']);
  });

  it('marks an unpaid day in the past as overdue', () => {
    const r = buildPlanRow(mk(), [inst({ dueOn: '2026-08-10' })], cal, TODAY);
    expect(r.days[0].state).toBe('OVERDUE');
  });

  it('only takes the instalments belonging to this case', () => {
    const mixed = [inst({ caseId: 'other', seq: 1 }), inst({ caseId: 'c1', seq: 1 })];
    expect(buildPlanRow(mk(), mixed, cal, TODAY).days).toHaveLength(1);
  });
});

describe('the recommendation', () => {
  it('spreads what is LEFT over the days still to come, not the maturity over all of them', () => {
    // ₹1,20,000 with ₹90,000 already paid across three days: ₹30,000 left, one day to go.
    const real = [
      inst({ seq: 1, dueOn: '2026-08-20', amountPaise: '3000000', paidCashPaise: '3000000' }),
      inst({ seq: 2, dueOn: '2026-08-21', amountPaise: '3000000', paidCashPaise: '3000000' }),
      inst({ seq: 3, dueOn: '2026-08-24', amountPaise: '3000000', paidCashPaise: '3000000' }),
      inst({ seq: 4, dueOn: '2026-08-26', amountPaise: '3000000' }),
    ];
    const r = buildPlanRow(mk({ paidCashPaise: '9000000' }), real, cal, TODAY);
    expect(r.remainingPaise).toBe(3_000_000n);
    expect(r.perDayPaise).toBe(3_000_000n); // ₹30,000 over the single remaining day
  });

  it('is zero when everything has been paid', () => {
    const real = [inst({ amountPaise: '12000000', paidCashPaise: '12000000' })];
    const r = buildPlanRow(mk({ paidCashPaise: '12000000' }), real, cal, TODAY);
    expect(r.remainingPaise).toBe(0n);
    expect(r.perDayPaise).toBe(0n);
  });
});

describe('column one — today', () => {
  it('totals only what is actually due today, and says how much is merely projected', () => {
    const approved = buildPlanRow(
      mk({ caseId: 'a', approvedOn: '2026-08-19' }),
      [inst({ caseId: 'a', dueOn: TODAY, amountPaise: '2000000' })],
      cal,
      TODAY,
    );
    const projected = buildPlanRow(mk({ caseId: 'b' }), [], cal, TODAY);
    const t = summariseToday([approved, projected]);

    expect(t.count).toBe(1); // the projection's first day is three working days out
    expect(t.totalPaise).toBe(2_000_000n);
    expect(t.committedPaise).toBe(2_000_000n);
    expect(t.projectedPaise).toBe(0n);
    expect(t.lines[0].customerName).toBe('Ram Kumar');
  });

  it('counts a part-paid day only for what is still owed on it', () => {
    const row = buildPlanRow(
      mk({ approvedOn: '2026-08-19' }),
      [inst({ dueOn: TODAY, amountPaise: '2000000', paidCashPaise: '500000' })],
      cal,
      TODAY,
    );
    expect(summariseToday([row]).totalPaise).toBe(1_500_000n);
  });

  it('is empty, not broken, when nothing falls due today', () => {
    const t = summariseToday([buildPlanRow(mk(), [], cal, TODAY)]);
    expect(t.count).toBe(0);
    expect(t.totalPaise).toBe(0n);
    expect(t.lines).toEqual([]);
  });
});

describe('band summaries', () => {
  it('splits the rows and totals each side', () => {
    const rows = [
      buildPlanRow(mk({ caseId: 'a', maturityAmountPaise: '20000000' }), [], cal, TODAY),
      buildPlanRow(mk({ caseId: 'b', maturityAmountPaise: '5000000' }), [], cal, TODAY),
      buildPlanRow(mk({ caseId: 'c', maturityAmountPaise: String(LAKH) }), [], cal, TODAY),
    ];
    const large = summariseBand('LARGE', rows);
    const small = summariseBand('SMALL', rows);
    expect(large.count).toBe(2);
    expect(small.count).toBe(1);
    expect(large.maturityPaise).toBe(30_000_000n);
    expect(small.maturityPaise).toBe(5_000_000n);
  });
});
