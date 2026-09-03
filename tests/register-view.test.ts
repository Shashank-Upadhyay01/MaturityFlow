import { describe, expect, it } from 'vitest';

import {
  EMPTY_RANGE,
  activeDatePreset,
  autoSortFor,
  bulkTodayAmount,
  compareTodayFigures,
  dayStateOf,
  DAY_STATE_LABEL,
  endOfMonth,
  groupIndian,
  hasMissedPayment,
  isDueToday,
  isOnTodaysList,
  isTodayButUnset,
  nextDay,
  leftoverOnPayoutDay,
  allocateVisitPaise,
  legsAfterPayment,
  orderPaidCorrections,
  paidOnDate,
  parsePaidByDate,
  plannedOnDate,
  prevDay,
  recommendedPerDay,
  splitVisitTender,
  todayPaidUntickedPaise,
  unpaidPayoutDays,
  visitReplacePlan,
  resolveDatePreset,
  rowStateOf,
  rowInDateRange,
  rowOnDate,
  startOfMonth,
  startOfWeek,
  summariseDueToday,
  summariseSelection,
  todayPlannedPaise,
  todayPlannedSplit,
  SORT_LABEL,
  type DateField,
} from '@/lib/register-view';

const TODAY = '2026-08-22';

function row(over: Partial<Parameters<typeof isDueToday>[0]> = {}) {
  return {
    paymentOn: TODAY,
    formSubmittedOn: '2026-08-12',
    instrumentMaturityOn: '2026-08-05',
    todayPaise: '0',
    remainingPaise: '0',
    ...over,
  };
}

function full(over: Partial<Parameters<typeof summariseDueToday>[0][number]> = {}) {
  return { ...row(), todayCashPaise: '0', todayOnlinePaise: '0', ...over };
}

describe('isDueToday', () => {
  it('needs both an amount for today and money still owed', () => {
    expect(isDueToday(row({ todayPaise: '3400000', remainingPaise: '50000000' }))).toBe(true);
    expect(isDueToday(row({ todayPaise: '0', remainingPaise: '50000000' }))).toBe(false);
    expect(isDueToday(row({ todayPaise: '3400000', remainingPaise: '0' }))).toBe(false);
  });

  it('does not count a leftover amount on a settled case', () => {
    // The realistic failure: a case is paid off but today's amount was never cleared.
    // Counting it would tell the branch to open with cash it does not need.
    expect(isDueToday(row({ todayPaise: '2500000', remainingPaise: '0' }))).toBe(false);
  });

  it('handles amounts past Number.MAX_SAFE_INTEGER without losing paise', () => {
    const huge = '9007199254740993'; // 2^53 + 1
    expect(isDueToday(row({ todayPaise: huge, remainingPaise: huge }))).toBe(true);
  });
});

describe('isTodayButUnset', () => {
  it('flags a row dated today whose amount nobody set', () => {
    expect(isTodayButUnset(row({ remainingPaise: '20000000' }), TODAY)).toBe(true);
  });
  it('stays quiet once an amount exists', () => {
    expect(isTodayButUnset(row({ todayPaise: '1', remainingPaise: '20000000' }), TODAY)).toBe(false);
  });
  it('stays quiet for another day, and for a settled case', () => {
    expect(isTodayButUnset(row({ paymentOn: '2026-08-23', remainingPaise: '1' }), TODAY)).toBe(false);
    expect(isTodayButUnset(row({ remainingPaise: '0' }), TODAY)).toBe(false);
  });
});

describe('summariseDueToday', () => {
  it('totals only the rows that are genuinely due, in exact paise', () => {
    const s = summariseDueToday(
      [
        full({ todayPaise: '3400000', todayCashPaise: '2040000', todayOnlinePaise: '1360000', remainingPaise: '50000000' }),
        full({ todayPaise: '2500000', todayCashPaise: '1500000', todayOnlinePaise: '1000000', remainingPaise: '25000000' }),
        full({ todayPaise: '9900000', remainingPaise: '0' }), // settled leftover — excluded
        full({ remainingPaise: '18000000' }), // dated today, amount never set
        full({ paymentOn: '2026-08-30', remainingPaise: '18000000' }), // another day entirely
      ],
      TODAY,
    );
    expect(s.count).toBe(2);
    expect(s.total).toBe(5900000n);
    expect(s.cash).toBe(3540000n);
    expect(s.online).toBe(2360000n);
    expect(s.unsetCount).toBe(1);
  });

  it('the cash and online legs always reconcile with the total', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      full({
        todayPaise: String((i + 1) * 137),
        todayCashPaise: String(Math.floor(((i + 1) * 137 * 6) / 10)),
        todayOnlinePaise: String((i + 1) * 137 - Math.floor(((i + 1) * 137 * 6) / 10)),
        remainingPaise: '100000000',
      }),
    );
    const s = summariseDueToday(rows, TODAY);
    expect(s.cash + s.online).toBe(s.total);
    expect(s.count).toBe(50);
  });

  it('is empty, not broken, when nothing is due', () => {
    const s = summariseDueToday([], TODAY);
    expect(s).toEqual({ count: 0, total: 0n, cash: 0n, online: 0n, unsetCount: 0 });
  });
});

describe('autoSortFor', () => {
  it('puts the biggest payout first on Due today', () => {
    expect(autoSortFor('due', '', 'payment')).toEqual({ key: 'today', dir: 'desc' });
  });

  it('shows the longest-waiting form first on Pending', () => {
    expect(autoSortFor('pending', '', 'payment')).toEqual({ key: 'formDate', dir: 'asc' });
  });

  it('never sorts by the very date the user filtered to', () => {
    // Every row shares that date, so the key would order nothing.
    for (const field of ['payment', 'form', 'maturity'] as DateField[]) {
      const s = autoSortFor('all', '2026-08-23', field);
      expect(['today', 'remaining']).toContain(s.key);
      expect(s.dir).toBe('desc');
    }
  });

  it('a chosen day outranks the tab', () => {
    expect(autoSortFor('pending', '2026-08-23', 'payment').key).toBe('today');
  });

  it('only ever names a column the sort box offers', () => {
    const offered = Object.keys(SORT_LABEL);
    for (const tab of ['due', 'today', 'all', 'pending'] as const) {
      for (const date of ['', '2026-08-23']) {
        for (const field of ['payment', 'form', 'maturity'] as DateField[]) {
          expect(offered).toContain(autoSortFor(tab, date, field).key);
        }
      }
    }
  });
});

describe('rowOnDate', () => {
  it('reads the field the filter names', () => {
    const r = row({ paymentOn: '2026-08-22', formSubmittedOn: '2026-08-12', instrumentMaturityOn: '2026-08-05' });
    expect(rowOnDate(r, 'payment')).toBe('2026-08-22');
    expect(rowOnDate(r, 'form')).toBe('2026-08-12');
    expect(rowOnDate(r, 'maturity')).toBe('2026-08-05');
  });
  it('passes a missing date through as null rather than guessing', () => {
    expect(rowOnDate(row({ paymentOn: null }), 'payment')).toBeNull();
  });
});

describe('nextDay', () => {
  it('steps one day', () => {
    expect(nextDay('2026-08-22')).toBe('2026-08-23');
  });
  it('crosses month and year ends', () => {
    expect(nextDay('2026-08-31')).toBe('2026-09-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });
  it('handles a leap day', () => {
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('2028-02-29')).toBe('2028-03-01');
  });
});

describe('groupIndian', () => {
  it('groups in the Indian style, not the western one', () => {
    expect(groupIndian('1000000')).toBe('10,00,000');
    expect(groupIndian('500000')).toBe('5,00,000');
    expect(groupIndian('1234')).toBe('1,234');
  });
  it('keeps paise', () => {
    expect(groupIndian('1234.50')).toBe('1,234.50');
  });
  it('leaves a half-typed value exactly as typed', () => {
    // The cell is grouped only at rest, but this must never corrupt input.
    for (const v of ['', '-', '12.', 'abc', '1,00,000', '12.345']) {
      expect(groupIndian(v)).toBe(v);
    }
  });
  it('does not lose precision on very large amounts', () => {
    // 2^53 + 1. Routed through Number() this would come back ...740,992 — the last rupee gone.
    expect(groupIndian('9007199254740993')).toBe('9,00,71,99,25,47,40,993');
    expect(groupIndian('9007199254740993').endsWith('40,993')).toBe(true);
  });
});

// ── Date filtering ─────────────────────────────────────────────────────────

describe('date presets', () => {
  // 2026-08-22 is a Saturday. Week starts Monday, so this week is Mon 17th – Sun 23rd.
  it('resolves each preset to the span it names', () => {
    expect(resolveDatePreset('today', TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(resolveDatePreset('tomorrow', TODAY)).toEqual({ from: '2026-08-23', to: '2026-08-23' });
    expect(resolveDatePreset('thisWeek', TODAY)).toEqual({ from: '2026-08-17', to: '2026-08-23' });
    expect(resolveDatePreset('next7', TODAY)).toEqual({ from: TODAY, to: '2026-08-28' });
    expect(resolveDatePreset('thisMonth', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('leaves "overdue" open at the bottom — a three-month-old payment date is still overdue', () => {
    expect(resolveDatePreset('overdue', TODAY)).toEqual({ from: '', to: '2026-08-21' });
  });

  it('gets month ends right, February and leap years included', () => {
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29'); // leap
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31');
    expect(startOfMonth('2026-12-31')).toBe('2026-12-01');
  });

  it('starts the week on Monday, whichever day you ask from', () => {
    expect(startOfWeek('2026-08-17')).toBe('2026-08-17'); // Monday itself
    expect(startOfWeek('2026-08-23')).toBe('2026-08-17'); // Sunday belongs to the week before
    expect(startOfWeek('2026-08-24')).toBe('2026-08-24'); // next Monday
  });

  it('crosses a month boundary without drifting', () => {
    expect(resolveDatePreset('next7', '2026-08-30')).toEqual({ from: '2026-08-30', to: '2026-09-05' });
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });

  it('recognises the preset a range came from, so the chip lights up', () => {
    expect(activeDatePreset(resolveDatePreset('thisWeek', TODAY), TODAY)).toBe('thisWeek');
    expect(activeDatePreset({ from: TODAY, to: '2026-09-04' }, TODAY)).toBeNull();
    expect(activeDatePreset(EMPTY_RANGE, TODAY)).toBeNull();
  });
});

describe('rowInDateRange', () => {
  const r = row({ paymentOn: '2026-08-22', formSubmittedOn: '2026-08-12', instrumentMaturityOn: '2026-08-05' });

  it('lets everything through when no bound is set', () => {
    expect(rowInDateRange(r, 'payment', EMPTY_RANGE)).toBe(true);
  });

  it('matches a single day on the chosen column, and only that column', () => {
    const oneDay = { from: '2026-08-22', to: '2026-08-22' };
    expect(rowInDateRange(r, 'payment', oneDay)).toBe(true);
    expect(rowInDateRange(r, 'form', oneDay)).toBe(false);
    expect(rowInDateRange(r, 'maturity', oneDay)).toBe(false);
  });

  it('is inclusive at both ends of a span', () => {
    expect(rowInDateRange(r, 'payment', { from: '2026-08-22', to: '2026-08-30' })).toBe(true);
    expect(rowInDateRange(r, 'payment', { from: '2026-08-10', to: '2026-08-22' })).toBe(true);
    expect(rowInDateRange(r, 'payment', { from: '2026-08-23', to: '2026-08-30' })).toBe(false);
  });

  it('honours an open-ended bound', () => {
    expect(rowInDateRange(r, 'payment', { from: '', to: '2026-08-22' })).toBe(true);
    expect(rowInDateRange(r, 'payment', { from: '', to: '2026-08-21' })).toBe(false);
    expect(rowInDateRange(r, 'payment', { from: '2026-08-01', to: '' })).toBe(true);
  });

  it('excludes a row that has no date in the chosen column', () => {
    // The realistic failure: "what goes out on the 22nd" quietly including rows with no payment
    // date at all, so the counter counts out cash for customers nobody scheduled.
    const undated = row({ paymentOn: null });
    expect(rowInDateRange(undated, 'payment', { from: TODAY, to: TODAY })).toBe(false);
    expect(rowInDateRange(undated, 'payment', EMPTY_RANGE)).toBe(true);
  });
});

// ── Bulk actions ───────────────────────────────────────────────────────────

describe('bulkTodayAmount', () => {
  const rem = (remaining: bigint, windowDays = 15) => ({ remaining, windowDays });

  it('divides the remainder over the days that can carry a payout, not the whole window', () => {
    // ₹10,000 is below the ₹1 lakh line, so it pays on alternate days: a 15-working-day window
    // is 3 processing days + 12 payout days, of which 6 are used. NOT remaining / 15 — that
    // would under-fill every day and leave the case short at its own deadline.
    expect(bulkTodayAmount('perDay', rem(10_000_00n, 15))).toBe(1_000_000n / 6n);

    // ₹2,00,000 is at or above the line, so it pays daily: 12 payout days in the same window.
    expect(
      bulkTodayAmount('perDay', { remaining: 200_000_00n, windowDays: 15, maturityPaise: 200_000_00n }),
    ).toBe(20_000_000n / 12n);
  });

  it('a part-paid large case still spreads over its 12 payout days', () => {
    // Remaining is small but the maturity is large, so the cadence stays daily.
    expect(
      bulkTodayAmount('perDay', { remaining: 12_000n, windowDays: 15, maturityPaise: 200_000_00n }),
    ).toBe(1_000n);
  });

  it('treats a zero or nonsense window as the shortest payable one', () => {
    // Clamped to the minimum window (4 working days => 1 payout day), so the whole remainder
    // is offered rather than dividing by zero.
    expect(bulkTodayAmount('perDay', rem(50_000n, 0))).toBe(50_000n);
    expect(bulkTodayAmount('perDay', rem(50_000n, -4))).toBe(50_000n);
  });

  it('never approves more than the case still owes', () => {
    expect(bulkTodayAmount('remaining', rem(4_500_00n))).toBe(4_500_00n);
    expect(bulkTodayAmount('amount', { ...rem(4_500_00n), amount: 9_999_00n })).toBe(4_500_00n);
    expect(bulkTodayAmount('amount', { ...rem(4_500_00n), amount: 1_000_00n })).toBe(1_000_00n);
  });

  it('is zero for a settled row, whatever the mode', () => {
    for (const m of ['perDay', 'remaining', 'clear'] as const) {
      expect(bulkTodayAmount(m, rem(0n))).toBe(0n);
    }
    expect(bulkTodayAmount('amount', { ...rem(0n), amount: 5_000_00n })).toBe(0n);
    expect(bulkTodayAmount('remaining', rem(-500n))).toBe(0n); // an over-paid row cannot go negative
  });

  it('clear means zero even on a live row', () => {
    expect(bulkTodayAmount('clear', rem(50_000_00n))).toBe(0n);
  });

  it('holds exact paise past Number.MAX_SAFE_INTEGER', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    expect(bulkTodayAmount('remaining', rem(huge))).toBe(huge);
  });
});

describe('summariseSelection', () => {
  function selRow(over: Record<string, string> = {}) {
    return {
      ...full(),
      maturityPaise: '0',
      paidPaise: '0',
      ...over,
    };
  }

  it('adds up exactly, and counts only the rows genuinely due', () => {
    const s = summariseSelection([
      selRow({ maturityPaise: '50000000', paidPaise: '10000000', remainingPaise: '40000000', todayPaise: '3400000', todayCashPaise: '2000000', todayOnlinePaise: '1400000' }),
      selRow({ maturityPaise: '25000000', paidPaise: '0', remainingPaise: '25000000', todayPaise: '2500000', todayCashPaise: '2500000' }),
      selRow({ maturityPaise: '9000000', paidPaise: '9000000', remainingPaise: '0', todayPaise: '900000' }), // settled leftover
    ]);
    expect(s.count).toBe(3);
    expect(s.maturity).toBe(84000000n);
    expect(s.paid).toBe(19000000n);
    expect(s.remaining).toBe(65000000n);
    expect(s.today).toBe(6800000n);
    expect(s.cash).toBe(4500000n);
    expect(s.online).toBe(1400000n);
    expect(s.dueCount).toBe(2);
  });

  it('is all zeroes for an empty selection', () => {
    const s = summariseSelection([]);
    expect(s).toEqual({ count: 0, maturity: 0n, paid: 0n, remaining: 0n, today: 0n, cash: 0n, online: 0n, dueCount: 0 });
  });
});

describe('dayStateOf', () => {
  function day(over: Partial<Parameters<typeof dayStateOf>[0]> = {}) {
    return { todayInstalmentId: 'inst_1', todayStatus: 'PENDING', overdueCount: 0, ...over };
  }

  it('is green only once a clerk has said the customer took it', () => {
    expect(dayStateOf(day({ todayStatus: 'PAID' }))).toBe('taken');
  });

  it('is red only once a clerk has said they did not', () => {
    expect(dayStateOf(day({ todayStatus: 'MISSED' }))).toBe('missed');
  });

  it('leaves an unanswered day uncoloured', () => {
    // The whole point of the two buttons: a day nobody has looked at yet must not read as a
    // failure. 'due' is what the counter is being asked about, not a verdict on it.
    expect(dayStateOf(day({ todayStatus: 'PENDING' }))).toBe('due');
  });

  it('distinguishes a part payment from a full one', () => {
    expect(dayStateOf(day({ todayStatus: 'PARTIAL' }))).toBe('partial');
  });

  it('does not turn an alternate-schedule off day into today\'s missed day', () => {
    expect(dayStateOf(day({ todayInstalmentId: null, overdueCount: 3 }))).toBe('none');
  });

  it('says nothing about an off day with a clean history', () => {
    expect(dayStateOf(day({ todayInstalmentId: null, overdueCount: 0 }))).toBe('none');
  });

  it('describes today only, leaving backlog precedence to rowStateOf', () => {
    expect(dayStateOf(day({ todayStatus: 'PAID', overdueCount: 2 }))).toBe('taken');
    expect(dayStateOf(day({ todayStatus: 'PENDING', overdueCount: 2 }))).toBe('due');
  });

  it('has a label for every state', () => {
    for (const s of ['taken', 'partial', 'missed', 'due', 'none'] as const) {
      expect(DAY_STATE_LABEL[s]).toBeTruthy();
    }
  });
});

describe('missed-payment visibility', () => {
  const row = (over: Partial<Parameters<typeof dayStateOf>[0]> = {}) => ({
    todayInstalmentId: 'inst_1',
    todayStatus: 'PENDING',
    overdueCount: 0,
    ...over,
  });

  it('keeps an older missed payment in the Not taken tab even when another payment is due today', () => {
    expect(hasMissedPayment(row({ overdueCount: 2 }))).toBe(true);
  });

  it('keeps the row red until its older unpaid days are cleared', () => {
    expect(rowStateOf(row({ overdueCount: 2 }))).toBe('missed');
    expect(rowStateOf(row({ todayStatus: 'PAID', overdueCount: 2 }))).toBe('missed');
  });

  it('uses today\'s answer when there is no backlog', () => {
    expect(rowStateOf(row({ todayStatus: 'PAID' }))).toBe('taken');
    expect(rowStateOf(row({ todayStatus: 'PARTIAL' }))).toBe('partial');
  });
});

describe('todayPlannedPaise — the figure the ✓ button will actually pay', () => {
  it('follows the schedule wherever there is one', () => {
    // The typed figure is deliberately different, and deliberately ignored. The Taken button
    // pays the instalment, so a sheet that displayed anything else would be showing the clerk
    // one number and handing over another.
    expect(
      todayPlannedPaise({
        ...row({ todayPaise: '9900000', remainingPaise: '50000000' }),
        todayInstalmentId: 'inst_1',
        todayDuePaise: '2500000',
        todayPaidTakenPaise: '0',
      }),
    ).toBe(2500000n);
  });

  it('counts only what is still to be handed over', () => {
    // Half of today has already gone out, so the drawer only needs the other half.
    expect(
      todayPlannedPaise({
        ...row({ remainingPaise: '50000000' }),
        todayInstalmentId: 'inst_1',
        todayDuePaise: '2500000',
        todayPaidTakenPaise: '1000000',
      }),
    ).toBe(1500000n);
  });

  it('is nothing once today is settled', () => {
    expect(
      todayPlannedPaise({
        ...row({ remainingPaise: '50000000' }),
        todayInstalmentId: 'inst_1',
        todayDuePaise: '2500000',
        todayPaidTakenPaise: '2500000',
      }),
    ).toBe(0n);
  });

  it('falls back to the typed figure on a row with no schedule', () => {
    // A row typed into the sheet but not yet submitted has no plan to read, and the manual
    // figure is the only thing anyone knows about it.
    expect(
      todayPlannedPaise({
        ...row({ todayPaise: '3000000', remainingPaise: '50000000' }),
        todayInstalmentId: null,
        todayDuePaise: '0',
        todayPaidTakenPaise: '0',
      }),
    ).toBe(3000000n);
  });

  it('splits by the legs the engine planned', () => {
    const s = todayPlannedSplit({
      ...row({ remainingPaise: '50000000' }),
      todayInstalmentId: 'inst_1',
      todayDuePaise: '2500000',
      todayPaidTakenPaise: '0',
      todayCashDuePaise: '2000000',
      todayOnlineDuePaise: '500000',
      todayCashPaise: '0',
      todayOnlinePaise: '0',
    });
    expect(s).toEqual({ total: 2500000n, cash: 2000000n, online: 500000n });
  });

  it('never splits further than what is left of today', () => {
    // ₹20,000 of the ₹25,000 has gone out. Only ₹5,000 is still owed today, and the split may
    // not add up to more than that or the branch would over-fund its drawer.
    const s = todayPlannedSplit({
      ...row({ remainingPaise: '50000000' }),
      todayInstalmentId: 'inst_1',
      todayDuePaise: '2500000',
      todayPaidTakenPaise: '2000000',
      todayCashDuePaise: '2000000',
      todayOnlineDuePaise: '500000',
      todayCashPaise: '0',
      todayOnlinePaise: '0',
    });
    expect(s.total).toBe(500000n);
    expect(s.cash + s.online).toBe(500000n);
  });
});

describe('schedule-backed Today sorting', () => {
  const scheduled = (due: string, cash: string, online: string, legacyToday: string) => ({
    ...full({ todayPaise: legacyToday, todayCashPaise: legacyToday, todayOnlinePaise: '0' }),
    todayInstalmentId: `inst_${due}`,
    todayDuePaise: due,
    todayPaidTakenPaise: '0',
    todayCashDuePaise: cash,
    todayOnlineDuePaise: online,
  });

  it('orders the schedule figures printed on screen, not stale typed values', () => {
    const smallerOnScreen = scheduled('2000000', '1500000', '500000', '9900000');
    const largerOnScreen = scheduled('3000000', '1000000', '2000000', '1000000');

    expect(compareTodayFigures(smallerOnScreen, largerOnScreen, 'today')).toBeLessThan(0);
    expect(compareTodayFigures(smallerOnScreen, largerOnScreen, 'cash')).toBeGreaterThan(0);
    expect(compareTodayFigures(smallerOnScreen, largerOnScreen, 'online')).toBeLessThan(0);
  });
});

describe('recommendation on a selected payout day', () => {
  it('uses the exact rounded instalment instead of a generic quotient', () => {
    const r = {
      ...full({ remainingPaise: '88073800' }),
      todayInstalmentId: 'inst_sep_1',
      todayDuePaise: '8800000',
      todayPaidTakenPaise: '0',
      todayCashDuePaise: '8800000',
      todayOnlineDuePaise: '0',
      payoutDays: [
        {
          id: 'inst_sep_1',
          dueOn: '2026-09-01',
          amountPaise: '8800000',
          cashPaise: '8800000',
          onlinePaise: '0',
          paidPaise: '0',
          status: 'PENDING',
        },
      ],
    };

    expect(recommendedPerDay(88_073_800n, 88_073_800n, 13)).toBe(8_807_380n);
    expect(plannedOnDate(r, '2026-09-01').total).toBe(8_800_000n);
    // The recommendation is not today's due figure — those two numbers must be allowed to differ.
    expect(recommendedPerDay(88_073_800n, 88_073_800n, 13)).not.toBe(plannedOnDate(r, '2026-09-01').total);
  });

  it('lists unpaid days on or before today, never a future day', () => {
    const days = [
      { id: 'a', dueOn: '2026-09-01', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
      { id: 'b', dueOn: '2026-09-02', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '500000', status: 'PARTIAL' },
      { id: 'c', dueOn: '2026-09-02', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '1000000', status: 'PAID' },
      { id: 'd', dueOn: '2026-09-03', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
    ];
    expect(unpaidPayoutDays(days, '2026-09-02').map((d) => d.id)).toEqual(['a', 'b']);
    expect(leftoverOnPayoutDay(days[1]!)).toBe(500000n);
  });

  it('splits one visit onto ticked days oldest first, leftover unpaid stays on later ticked days', () => {
    const days = [
      { id: 'a', amountPaise: '8800000' },
      { id: 'b', amountPaise: '8800000' },
      { id: 'c', amountPaise: '8800000' },
    ];
    const out = allocateVisitPaise(days, 10_000_000n);
    expect(out.map((d) => d.paidPaise)).toEqual([8_800_000n, 1_200_000n, 0n]);
  });

  it('records a ₹1 lakh visit against three ₹88,000 days without stacking on today', () => {
    // 1 Sep and 2 Sep missed; today already shows the planned ₹88,000 paid.
    // Ops Head approved ₹1,00,000 for the whole visit, not ₹1,00,000 extra.
    const days = [
      { id: 'sep1', amountPaise: '8800000', paidPaise: '0' },
      { id: 'sep2', amountPaise: '8800000', paidPaise: '0' },
      { id: 'today', amountPaise: '8800000', paidPaise: '8800000' },
    ];
    const plan = visitReplacePlan(days, 10_000_000n);
    expect(plan.map((row) => row.paidPaise)).toEqual([8_800_000n, 1_200_000n, 0n]);
    const unpaid = days.map((day, i) => BigInt(day.amountPaise) - plan[i]!.paidPaise);
    expect(unpaid).toEqual([0n, 7_600_000n, 8_800_000n]);
    expect(unpaid.reduce((sum, row) => sum + row, 0n)).toBe(16_400_000n);

    const ordered = orderPaidCorrections(plan);
    expect(ordered.map((row) => row.id)).toEqual(['today', 'sep1', 'sep2']);

    const stacked = todayPaidUntickedPaise(
      [
        { id: 'sep1', dueOn: '2026-09-01', amountPaise: '8800000', cashPaise: '8800000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
        { id: 'sep2', dueOn: '2026-09-02', amountPaise: '8800000', cashPaise: '8800000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
        { id: 'today', dueOn: '2026-09-03', amountPaise: '8800000', cashPaise: '8800000', onlinePaise: '0', paidPaise: '8800000', status: 'PAID' },
      ],
      { sep1: true, sep2: true },
      '2026-09-03',
    );
    expect(stacked).toBe(8_800_000n);
  });

  it('puts cash on the oldest allocated days and online on what remains', () => {
    const legs = splitVisitTender(
      [
        { id: 'a', paidPaise: 8_800_000n },
        { id: 'b', paidPaise: 1_200_000n },
        { id: 'c', paidPaise: 0n },
      ],
      10_000_000n,
    );
    expect(legs).toEqual([
      { id: 'a', cashPaise: 8_800_000n, onlinePaise: 0n },
      { id: 'b', cashPaise: 1_200_000n, onlinePaise: 0n },
      { id: 'c', cashPaise: 0n, onlinePaise: 0n },
    ]);
  });

  it('grows the last ticked day when the visit is larger than the ticked plans', () => {
    const out = allocateVisitPaise(
      [
        { id: 'a', amountPaise: '1000000' },
        { id: 'b', amountPaise: '1000000' },
      ],
      3_500_000n,
    );
    expect(out.map((d) => d.paidPaise)).toEqual([1_000_000n, 2_500_000n]);
  });

  it('zeros every ticked day when the visit amount is 0', () => {
    const out = allocateVisitPaise(
      [
        { id: 'a', amountPaise: '8800000' },
        { id: 'b', amountPaise: '8800000' },
      ],
      0n,
    );
    expect(out.map((d) => d.paidPaise)).toEqual([0n, 0n]);
  });

  it('moves a cash visit onto the Cash column so it cannot keep showing as Online', () => {
    expect(legsAfterPayment(8_800_000n, 8_800_000n, 0n)).toEqual({
      cashPaise: 8_800_000n,
      onlinePaise: 0n,
    });
    expect(legsAfterPayment(8_800_000n, 1_200_000n, 0n)).toEqual({
      cashPaise: 8_800_000n,
      onlinePaise: 0n,
    });
    expect(legsAfterPayment(8_800_000n, 0n, 8_800_000n)).toEqual({
      cashPaise: 0n,
      onlinePaise: 8_800_000n,
    });
  });

  it('reads what was actually paid on a chosen calendar day, not only today', () => {
    const r = {
      paidTodayActualPaise: '10000000',
      paidCashTodayPaise: '10000000',
      paidOnlineTodayPaise: '0',
      paidByDate: parsePaidByDate({
        '2026-09-03': { cash: '10000000', online: '0' },
        '2026-09-04': { cash: '0', online: '5000000' },
      }),
    };
    expect(paidOnDate(r, '2026-09-04', '2026-09-04')).toEqual({
      total: 10_000_000n,
      cash: 10_000_000n,
      online: 0n,
    });
    expect(paidOnDate(r, '2026-09-03', '2026-09-04')).toEqual({
      total: 10_000_000n,
      cash: 10_000_000n,
      online: 0n,
    });
    expect(paidOnDate(r, '2026-09-02', '2026-09-04').total).toBe(0n);
  });

  it('returns zero on an alternate off-day and the exact amount on tomorrow', () => {
    const r = {
      ...full({ remainingPaise: '6000000' }),
      payoutDays: [
        { id: 'a', dueOn: '2026-09-01', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
        { id: 'b', dueOn: '2026-09-03', amountPaise: '1000000', cashPaise: '1000000', onlinePaise: '0', paidPaise: '0', status: 'PENDING' },
      ],
    };
    expect(plannedOnDate(r, '2026-09-02').total).toBe(0n);
    expect(plannedOnDate(r, '2026-09-03').total).toBe(1_000_000n);
  });
});

describe('summariseDueToday, once the schedule exists', () => {
  it('adds up what the schedule says, not what was typed', () => {
    const s = summariseDueToday(
      [
        {
          ...full({ todayPaise: '9900000', remainingPaise: '50000000' }),
          todayInstalmentId: 'inst_1',
          todayDuePaise: '2500000',
          todayPaidTakenPaise: '0',
          todayCashDuePaise: '2500000',
          todayOnlineDuePaise: '0',
        },
        {
          ...full({ todayPaise: '0', remainingPaise: '20000000' }),
          todayInstalmentId: 'inst_2',
          todayDuePaise: '1000000',
          todayPaidTakenPaise: '0',
          todayCashDuePaise: '600000',
          todayOnlineDuePaise: '400000',
        },
      ],
      TODAY,
    );
    expect(s.total).toBe(3500000n);
    expect(s.cash).toBe(3100000n);
    expect(s.online).toBe(400000n);
    expect(s.count).toBe(2);
  });

  it('drops a day that has already been taken out of the opening cash', () => {
    const s = summariseDueToday(
      [
        {
          ...full({ remainingPaise: '50000000' }),
          todayInstalmentId: 'inst_1',
          todayDuePaise: '2500000',
          todayPaidTakenPaise: '2500000',
          todayCashDuePaise: '2500000',
          todayOnlineDuePaise: '0',
        },
      ],
      TODAY,
    );
    expect(s.total).toBe(0n);
    expect(s.count).toBe(0);
  });
});

describe("isOnTodaysList — the day's worklist, not just what is still owed", () => {
  function sched(over: Record<string, unknown> = {}) {
    return {
      ...full({ remainingPaise: '50000000' }),
      todayInstalmentId: 'inst_1',
      todayDuePaise: '2500000',
      todayPaidTakenPaise: '0',
      todayStatus: 'PENDING',
      overdueCount: 0,
      ...over,
    };
  }

  it('keeps a row on the list after the customer has taken it', () => {
    // The whole point of the green tint is that the clerk sees it. A row that vanished the
    // moment it was marked would never be green on the screen anybody is looking at.
    const r = sched({ todayStatus: 'PAID', todayPaidTakenPaise: '2500000' });
    expect(isDueToday(r)).toBe(false); // nothing left to fund
    expect(isOnTodaysList(r)).toBe(true); // still today's work
  });

  it('keeps a row on the list after it is marked not taken', () => {
    expect(isOnTodaysList(sched({ todayStatus: 'MISSED' }))).toBe(true);
  });

  it('includes an unscheduled row that has money marked against today', () => {
    expect(
      isOnTodaysList({
        ...full({ todayPaise: '3000000', remainingPaise: '50000000' }),
        todayInstalmentId: null,
        todayDuePaise: '0',
        todayPaidTakenPaise: '0',
        todayStatus: null,
        overdueCount: 0,
      }),
    ).toBe(true);
  });

  it('leaves out a day the schedule skips', () => {
    expect(
      isOnTodaysList({
        ...full({ todayPaise: '0', remainingPaise: '50000000' }),
        todayInstalmentId: null,
        todayDuePaise: '0',
        todayPaidTakenPaise: '0',
        todayStatus: null,
        overdueCount: 0,
      }),
    ).toBe(false);
  });
});
