import { describe, expect, it } from 'vitest';
import {
  CalendarError,
  addDays,
  collectWorkingDays,
  countWorkingDaysBetween,
  daysBetween,
  formatDMY,
  isWorkingDay,
  makeCalendar,
  nextWorkingDay,
  parseISODate,
  saturdayOrdinal,
  toISODateString,
  whyNotWorking,
} from '../src/lib/working-days';

const cal = makeCalendar();

describe('Indian display dates', () => {
  it('always prints dd/mm/yyyy with leading zeros', () => {
    expect(formatDMY('2026-06-29')).toBe('29/06/2026');
    expect(formatDMY('2026-08-03')).toBe('03/08/2026');
  });
  it('does not shift a calendar day when a UTC ISO timestamp is IST midnight', () => {
    expect(toISODateString('2026-06-28T18:30:00.000Z')).toBe('2026-06-29');
    expect(formatDMY('2026-06-28T18:30:00.000Z')).toBe('29/06/2026');
  });
});

describe('date primitives', () => {
  it('rejects malformed and impossible dates', () => {
    expect(() => parseISODate('2026-13-01')).toThrow();
    expect(() => parseISODate('2026-02-30')).toThrow();
    expect(() => parseISODate('18-08-2026')).toThrow();
  });
  it('handles leap years', () => {
    expect(() => parseISODate('2024-02-29')).not.toThrow();
    expect(() => parseISODate('2026-02-29')).toThrow();
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('Indian bank weekend rules', () => {
  // August 2026: Sat 1st(1st), 8th(2nd), 15th(3rd), 22nd(4th), 29th(5th)
  it('identifies the ordinal Saturday of the month', () => {
    expect(saturdayOrdinal('2026-08-01')).toBe(1);
    expect(saturdayOrdinal('2026-08-08')).toBe(2);
    expect(saturdayOrdinal('2026-08-22')).toBe(4);
    expect(saturdayOrdinal('2026-08-18')).toBe(0); // a Tuesday
  });

  it('closes 2nd and 4th Saturdays but not 1st/3rd/5th', () => {
    expect(isWorkingDay('2026-08-01', cal)).toBe(true);
    expect(isWorkingDay('2026-08-08', cal)).toBe(false);
    expect(isWorkingDay('2026-08-22', cal)).toBe(false);
    expect(isWorkingDay('2026-08-29', cal)).toBe(true);
  });

  it('closes every Sunday', () => {
    expect(isWorkingDay('2026-08-16', cal)).toBe(false);
    expect(whyNotWorking('2026-08-16', cal)).toBe('SUNDAY');
  });

  it('honours declared holidays', () => {
    const withHoliday = makeCalendar(['2026-08-15']);
    expect(isWorkingDay('2026-08-15', withHoliday)).toBe(false);
    expect(whyNotWorking('2026-08-15', withHoliday)).toBe('HOLIDAY');
  });

  it('supports an all-Saturdays-off policy', () => {
    const c = makeCalendar([], { sundaysOff: true, saturdayRule: 'ALL' });
    expect(isWorkingDay('2026-08-01', c)).toBe(false);
    expect(isWorkingDay('2026-08-29', c)).toBe(false);
  });

  it('supports a no-weekend policy', () => {
    const c = makeCalendar([], { sundaysOff: false, saturdayRule: 'NONE' });
    expect(isWorkingDay('2026-08-16', c)).toBe(true);
  });
});

describe('working-day traversal', () => {
  it('rolls forward off a non-working day', () => {
    expect(nextWorkingDay('2026-08-16', cal)).toBe('2026-08-17'); // Sun -> Mon
    expect(nextWorkingDay('2026-08-17', cal)).toBe('2026-08-17'); // already working
  });

  it('treats a 3rd Saturday as a working day under the 2nd/4th rule', () => {
    // 1 Aug 2026 is a Saturday, so 15 Aug is the 3rd Saturday -> open.
    expect(nextWorkingDay('2026-08-15', cal)).toBe('2026-08-15');
  });

  it('skips a run of holidays and a Sunday together', () => {
    const c = makeCalendar(['2026-08-15', '2026-08-17']);
    expect(nextWorkingDay('2026-08-15', c)).toBe('2026-08-18');
  });

  it('collects exactly N working days and never lands on a closed day', () => {
    const days = collectWorkingDays('2026-08-17', 15, cal);
    expect(days).toHaveLength(15);
    expect(new Set(days).size).toBe(15);
    for (const d of days) expect(isWorkingDay(d, cal)).toBe(true);
    for (let i = 1; i < days.length; i++) expect(days[i] > days[i - 1]).toBe(true);
  });

  it('produces a stable known sequence', () => {
    // Mon 17 Aug 2026 onward, skipping Sun 23rd and 4th-Sat 22nd
    expect(collectWorkingDays('2026-08-17', 7, cal)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-24',
      '2026-08-25',
    ]);
  });

  it('counts working days in a range inclusively', () => {
    expect(countWorkingDaysBetween('2026-08-17', '2026-08-21', cal)).toBe(5);
    expect(countWorkingDaysBetween('2026-08-22', '2026-08-23', cal)).toBe(0);
    expect(countWorkingDaysBetween('2026-08-21', '2026-08-17', cal)).toBe(0);
  });

  it('throws rather than hanging on an impossible calendar', () => {
    const allHolidays = new Set<string>();
    for (let i = 0; i < 4000; i++) allHolidays.add(addDays('2026-01-01', i));
    const dead = makeCalendar(allHolidays);
    expect(() => nextWorkingDay('2026-08-17', dead)).toThrow();
  });
});

describe('collectWorkingDays with a stride', () => {
  // 2026-08-24 is a Monday. Sundays and 2nd/4th Saturdays are off by default.
  it('stride 1 is exactly the old behaviour', () => {
    const a = collectWorkingDays('2026-08-24', 6, cal);
    const b = collectWorkingDays('2026-08-24', 6, cal, 1);
    expect(b).toEqual(a);
  });

  it('stride 2 takes every other working day', () => {
    const every = collectWorkingDays('2026-08-24', 11, cal);
    const alternate = collectWorkingDays('2026-08-24', 6, cal, 2);
    expect(alternate).toEqual([every[0], every[2], every[4], every[6], every[8], every[10]]);
  });

  it('stride 2 counts working days, not calendar days, across a weekend', () => {
    const dates = collectWorkingDays('2026-08-24', 4, cal, 2);
    for (const d of dates) expect(isWorkingDay(d, cal)).toBe(true);
    // Consecutive picks are two working days apart, inclusive count of 3.
    for (let i = 0; i + 1 < dates.length; i++) {
      expect(countWorkingDaysBetween(dates[i], dates[i + 1], cal)).toBe(3);
    }
  });

  it('stride 2 steps over a holiday without landing on it', () => {
    const withHoliday = makeCalendar(['2026-08-26']); // the Wednesday
    const dates = collectWorkingDays('2026-08-24', 3, withHoliday, 2);
    expect(dates).not.toContain('2026-08-26');
    for (const d of dates) expect(isWorkingDay(d, withHoliday)).toBe(true);
  });

  it('rejects a stride that is not a positive whole number', () => {
    expect(() => collectWorkingDays('2026-08-24', 3, cal, 0)).toThrow(CalendarError);
    expect(() => collectWorkingDays('2026-08-24', 3, cal, -1)).toThrow(CalendarError);
    expect(() => collectWorkingDays('2026-08-24', 3, cal, 1.5)).toThrow(CalendarError);
  });
});
