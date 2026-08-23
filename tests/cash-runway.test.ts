import { describe, expect, it } from 'vitest';
import { buildRunway, splitCashCap } from '../src/lib/cash-runway';
import { parseRupeesToPaise } from '../src/lib/money';
import { collectWorkingDays, makeCalendar } from '../src/lib/working-days';

const cal = makeCalendar();
const cap = parseRupeesToPaise('25000');
const rupees = (n: string) => parseRupeesToPaise(n);

function baseCase(over: Partial<Parameters<typeof buildRunway>[0]['cases'][0]> = {}) {
  return {
    id: 'c1',
    customerName: 'Ram',
    agentName: 'Suresh',
    remainingPaise: rupees('90000'),
    todayApprovedPaise: 0n,
    todayCashPaise: 0n,
    todayOnlinePaise: 0n,
    windowDays: 3,
    committed: true,
    cashCapPaise: cap,
    ...over,
  };
}

describe('splitCashCap', () => {
  it('keeps the whole amount in cash under the cap', () => {
    expect(splitCashCap(rupees('20000'), cap)).toEqual({ cash: rupees('20000'), online: 0n });
  });
  it('pushes the rest online once the cap binds', () => {
    expect(splitCashCap(rupees('40000'), cap)).toEqual({ cash: cap, online: rupees('15000') });
  });
});

describe('buildRunway', () => {
  const days = collectWorkingDays('2026-08-20', 10, cal); // Thu 20 Aug 2026

  it('places remaining exactly and splits at the cash cap (smooth)', () => {
    const r = buildRunway({
      cases: [baseCase()],
      workingDays: days,
      distribution: 'EVEN',
      roundingPaise: 100n,
      defaultCashCapPaise: cap,
      calendar: cal,
      openings: new Map(),
      defaultOpeningPaise: rupees('500000'),
      comfortPaise: rupees('500000'),
    });
    expect(r.remainingPaise).toBe(rupees('90000'));
    expect(r.cashPaise + r.onlinePaise + r.beyondPaise).toBe(rupees('90000'));
    expect(r.liveCases).toBe(1);
    // 90,000 / 3 = 30,000 → cash 25k + online 5k each of first 3 working days
    expect(r.days[0].cashPaise).toBe(cap);
    expect(r.days[0].onlinePaise).toBe(rupees('5000'));
    expect(r.days[1].cashPaise).toBe(cap);
    expect(r.days[2].cashPaise).toBe(cap);
    expect(r.days.slice(3).every((d) => d.cashPaise === 0n && d.onlinePaise === 0n)).toBe(true);
  });

  it('pins today’s approved amount on the first working day', () => {
    const r = buildRunway({
      cases: [
        baseCase({
          remainingPaise: rupees('100000'),
          todayApprovedPaise: rupees('40000'),
          todayCashPaise: cap,
          todayOnlinePaise: rupees('15000'),
          windowDays: 5,
        }),
      ],
      workingDays: days,
      distribution: 'EVEN',
      roundingPaise: 100n,
      defaultCashCapPaise: cap,
      calendar: cal,
      openings: new Map(),
      defaultOpeningPaise: rupees('500000'),
      comfortPaise: rupees('500000'),
    });
    expect(r.days[0].cashPaise + r.days[0].onlinePaise).toBe(rupees('40000'));
    expect(r.days[0].cashPaise).toBe(cap);
    expect(r.cashPaise + r.onlinePaise + r.beyondPaise).toBe(rupees('100000'));
  });

  it('queue-at-start peak is at least the smooth peak', () => {
    const even = buildRunway({
      cases: [baseCase({ remainingPaise: rupees('150000'), windowDays: 15 })],
      workingDays: days,
      distribution: 'EVEN',
      roundingPaise: 100n,
      defaultCashCapPaise: cap,
      calendar: cal,
      openings: new Map(),
      defaultOpeningPaise: rupees('500000'),
      comfortPaise: rupees('500000'),
    });
    const front = buildRunway({
      cases: [baseCase({ remainingPaise: rupees('150000'), windowDays: 15 })],
      workingDays: days,
      distribution: 'FRONT_LOADED',
      roundingPaise: 100n,
      defaultCashCapPaise: cap,
      calendar: cal,
      openings: new Map(),
      defaultOpeningPaise: rupees('500000'),
      comfortPaise: rupees('500000'),
    });
    expect(front.peakCashPaise >= even.peakCashPaise).toBe(true);
    expect(even.cashPaise + even.onlinePaise).toBe(front.cashPaise + front.onlinePaise);
  });

  it('flags extra cash when the drawer is short', () => {
    const r = buildRunway({
      cases: [baseCase({ remainingPaise: rupees('80000'), windowDays: 1 })],
      workingDays: days,
      distribution: 'EVEN',
      roundingPaise: 100n,
      defaultCashCapPaise: cap,
      calendar: cal,
      openings: new Map([[days[0], rupees('10000')]]),
      defaultOpeningPaise: rupees('500000'),
      comfortPaise: rupees('500000'),
    });
    // 80k in one day → cash 25k, extra vs 10k opening = 15k
    expect(r.days[0].cashPaise).toBe(cap);
    expect(r.days[0].extraCashPaise).toBe(rupees('15000'));
    expect(r.nextCashPaise).toBe(cap);
  });
});
