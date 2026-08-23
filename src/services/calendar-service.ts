import 'server-only';

import { eq, gte, isNull, or, and, lte } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import { branches, holidays } from '@/db/schema';
import {
  type SaturdayRule,
  type WorkingDayCalendar,
  addDays,
  fixedHolidaysForYear,
  makeCalendar,
  todayISO,
} from '@/lib/working-days';

export interface BranchPolicy {
  id: string;
  code: string;
  name: string;
  defaultRoundingPaise: bigint;
  defaultWindowDays: number;
  dailyCashComfortPaise: bigint;
  calendar: WorkingDayCalendar;
}

/**
 * Build the payout calendar for a branch: its weekend rule plus every holiday that applies
 * to it (branch-specific or bank-wide), padded with the fixed national holidays so a fresh
 * install still refuses to schedule money on 15 August.
 */
export async function getBranchPolicy(
  branchId: string,
  qx: Queryable = db,
): Promise<BranchPolicy> {
  const [branch] = await qx.select().from(branches).where(eq(branches.id, branchId)).limit(1);
  if (!branch) throw new Error(`Branch ${branchId} not found`);

  const from = addDays(todayISO(), -400);
  const to = addDays(todayISO(), 800);

  const rows = await qx
    .select({ date: holidays.date })
    .from(holidays)
    .where(
      and(
        or(isNull(holidays.branchId), eq(holidays.branchId, branchId)),
        gte(holidays.date, from),
        lte(holidays.date, to),
      ),
    );

  const year = Number(todayISO().slice(0, 4));
  const dates = new Set<string>([
    ...rows.map((r) => r.date),
    ...fixedHolidaysForYear(year),
    ...fixedHolidaysForYear(year + 1),
  ]);

  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    defaultRoundingPaise: branch.defaultRoundingPaise,
    defaultWindowDays: branch.defaultWindowDays,
    dailyCashComfortPaise: branch.dailyCashComfortPaise,
    calendar: makeCalendar(dates, {
      sundaysOff: branch.sundaysOff,
      saturdayRule: branch.saturdayRule as SaturdayRule,
    }),
  };
}

/** The holiday set as plain data, for shipping to the browser's live calculator. */
export async function getCalendarSnapshot(branchId: string): Promise<{
  holidays: string[];
  sundaysOff: boolean;
  saturdayRule: SaturdayRule;
}> {
  const policy = await getBranchPolicy(branchId);
  return {
    holidays: [...policy.calendar.holidays].sort(),
    sundaysOff: policy.calendar.weekend.sundaysOff,
    saturdayRule: policy.calendar.weekend.saturdayRule,
  };
}
