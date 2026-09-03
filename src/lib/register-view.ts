/**
 * register-view.ts — the pure decision logic behind the Register sheet.
 *
 * Kept out of `register-sheet.tsx` for the same reason `storage-rules.ts` is kept out of
 * `storage.ts`: these are the rules that decide what a branch owes today and in what order
 * the clerk reads it, and rules about money need tests, not a browser.
 *
 * Nothing here touches the DOM, the clock, or the database.
 */

import { MIN_WINDOW_DAYS, payoutPlanFor } from './payout-policy';

/** Every sortable column in the register. */
export type SortKey =
  | 'formTick'
  | 'approved'
  | 'account'
  | 'customer'
  | 'maturityDate'
  | 'formDate'
  | 'paymentDate'
  | 'amount'
  | 'paid'
  | 'remaining'
  | 'agent'
  | 'days'
  | 'perDay'
  | 'today'
  | 'cash'
  | 'online'
  | 'paidToday'
  | 'paidCashToday'
  | 'paidOnlineToday'
  | 'given';

export type RegisterTab = 'due' | 'today' | 'missed' | 'all' | 'pending';
export type DateField = 'payout' | 'payment' | 'form' | 'maturity';

export const DATE_FIELD_LABEL: Record<DateField, string> = {
  payout: 'Payout date',
  payment: 'Payment date',
  form: 'Form in',
  maturity: 'Maturity date',
};

export const TAB_LABEL: Record<RegisterTab, string> = {
  due: 'Due today',
  today: 'Live',
  missed: 'Not paid',
  pending: 'Pending',
  all: 'All',
};

/** What each tab is actually a list of, for the title the counter reads on hover. */
export const TAB_HINT: Record<RegisterTab, string> = {
  due: 'Customers the schedule expects at the counter today',
  today: 'Every case that still owes money',
  missed: 'Customers who were not paid on a due day — still owed, still on the list',
  pending: 'Rows typed into the sheet that have not been submitted, so nothing is scheduled yet',
  all: 'Every row in the register, settled or not',
};

/**
 * One live instalment, as the sheet receives it. Money is a decimal string of paise so the
 * client never sees a Number.
 */
export interface PayoutDayView {
  dueOn: string;
  id: string;
  amountPaise: string;
  cashPaise: string;
  onlinePaise: string;
  paidPaise: string;
  status: string;
}

/** Only what the view rules actually read — so tests need not build a whole row. */
export interface RegisterViewRow {
  paymentOn: string | null;
  formSubmittedOn: string;
  instrumentMaturityOn: string | null;
  /** Paise, as a decimal string. */
  todayPaise: string;
  /** Paise, as a decimal string. */
  remainingPaise: string;
  /** Live instalments. Absent on an unscheduled row. */
  payoutDays?: PayoutDayView[];
}

export function rowOnDate(r: RegisterViewRow, field: DateField): string | null {
  if (field === 'payout') return null;
  if (field === 'payment') return r.paymentOn;
  if (field === 'form') return r.formSubmittedOn;
  return r.instrumentMaturityOn;
}

export function parsePayoutDays(raw: unknown): PayoutDayView[] {
  if (raw == null) return [];
  try {
    const v = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(v)) return [];
    const out: PayoutDayView[] = [];
    for (const item of v) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const dueOn = typeof o.dueOn === 'string' ? o.dueOn.slice(0, 10) : null;
      const id = typeof o.id === 'string' ? o.id : null;
      const amountPaise = o.amountPaise != null ? String(o.amountPaise) : null;
      if (!dueOn || !id || !amountPaise) continue;
      out.push({
        dueOn,
        id,
        amountPaise,
        cashPaise: o.cashPaise != null ? String(o.cashPaise) : '0',
        onlinePaise: o.onlinePaise != null ? String(o.onlinePaise) : '0',
        paidPaise: o.paidPaise != null ? String(o.paidPaise) : '0',
        status: typeof o.status === 'string' ? o.status : 'PENDING',
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function payoutOnDate(r: { payoutDays?: PayoutDayView[] }, day: string): PayoutDayView | null {
  return (r.payoutDays ?? []).find((d) => d.dueOn === day) ?? null;
}

/** What a scheduled day still owes. Paid / dropped days are zero. */
export function leftoverOnPayoutDay(d: PayoutDayView): bigint {
  if (d.status === 'PAID' || d.status === 'SUPERSEDED' || d.status === 'CANCELLED') return 0n;
  const due = BigInt(d.amountPaise);
  const paid = BigInt(d.paidPaise);
  return due > paid ? due - paid : 0n;
}

/**
 * Unpaid days that a cashier may tick without authorising a future payment: today and earlier.
 */
export function unpaidPayoutDays(days: readonly PayoutDayView[], asOf: string): PayoutDayView[] {
  return [...days]
    .filter((day) => leftoverOnPayoutDay(day) > 0n && day.dueOn <= asOf)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
}

function asPaise(value: string | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/**
 * One counter visit: a single amount split onto ticked days, oldest first, up to each day's plan.
 * Remainder after filling those plans stays on the last ticked day (later unpaid days rebalance).
 *
 * This is a REPLACE of what those days should show as paid, not an add-on. If today was already
 * recorded at the planned figure and the visit total is smaller, today can come out as ₹0.
 */
export function allocateVisitPaise(
  days: readonly { id: string; amountPaise: string | bigint }[],
  visitPaise: bigint,
): { id: string; paidPaise: bigint }[] {
  if (visitPaise < 0n || days.length === 0) return [];
  let left = visitPaise;
  return days.map((day, index) => {
    const cap = asPaise(day.amountPaise);
    const isLast = index === days.length - 1;
    const take = isLast ? left : left < cap ? left : cap;
    left -= take;
    return { id: day.id, paidPaise: take };
  });
}

export interface VisitReplaceLine {
  id: string;
  paidPaise: bigint;
  previousPaidPaise: bigint;
}

/**
 * HQ Taken: the custom amount is the whole visit for the ticked days.
 * Apply decreasing paid figures first so a reverse of today's receipt frees room
 * before missed days are written.
 */
export function visitReplacePlan(
  tickedDays: readonly { id: string; amountPaise: string | bigint; paidPaise: string | bigint }[],
  visitPaise: bigint,
): VisitReplaceLine[] {
  const alloc = allocateVisitPaise(tickedDays, visitPaise);
  return alloc.map((row, i) => ({
    id: row.id,
    paidPaise: row.paidPaise,
    previousPaidPaise: asPaise(tickedDays[i]!.paidPaise),
  }));
}

export function orderPaidCorrections<T extends { paidPaise: bigint; previousPaidPaise: bigint }>(
  rows: readonly T[],
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const deltaA = a.row.paidPaise - a.row.previousPaidPaise;
      const deltaB = b.row.paidPaise - b.row.previousPaidPaise;
      const aDown = deltaA < 0n;
      const bDown = deltaB < 0n;
      if (aDown !== bDown) return aDown ? -1 : 1;
      if (aDown && bDown) {
        return deltaA < deltaB ? -1 : deltaA > deltaB ? 1 : a.index - b.index;
      }
      return a.index - b.index;
    })
    .map((item) => item.row);
}

/** Put cash on the oldest allocated days first; leftover of each day is online. */
export function splitVisitTender(
  allocations: readonly { id: string; paidPaise: bigint }[],
  cashPaise: bigint,
): { id: string; cashPaise: bigint; onlinePaise: bigint }[] {
  let cashLeft = cashPaise < 0n ? 0n : cashPaise;
  return allocations.map((row) => {
    const cash = row.paidPaise < cashLeft ? row.paidPaise : cashLeft;
    cashLeft -= cash;
    return { id: row.id, cashPaise: cash, onlinePaise: row.paidPaise - cash };
  });
}

/** Paid already sitting on today when today is not in this visit — warn, or it stacks. */
export function todayPaidUntickedPaise(
  days: readonly PayoutDayView[],
  ticked: Readonly<Record<string, boolean>>,
  today: string,
): bigint {
  const day = days.find((row) => row.dueOn === today);
  if (!day || ticked[day.id]) return 0n;
  const paid = BigInt(day.paidPaise);
  return paid > 0n ? paid : 0n;
}

/**
 * A withdrawal is "due today" when something is still to be handed over today and the case
 * still owes money.
 *
 * Both halves matter. An amount standing against a fully-paid case is a leftover, not an
 * obligation — counting it would overstate the cash the branch has to open with, which is the
 * one number this page exists to get right.
 *
 * The first half reads `todayPlannedPaise`, so on a scheduled row this asks the schedule and
 * on an unscheduled one it asks the typed figure. Before auto-scheduling there was only the
 * latter, and a case whose plan said ₹25,000 counted as nothing until somebody typed it in.
 */
export function isDueToday(r: TodayFigureRow): boolean {
  return todayPlannedPaise(r) > 0n && BigInt(r.remainingPaise) > 0n;
}

/**
 * The payment date says today, but nobody has set today's amount.
 *
 * Not an error — it is the shape an omission takes. Someone scheduled the customer for today
 * and then never said how much, so the counter would never see them.
 */
export function isTodayButUnset(r: TodayFigureRow, today: string): boolean {
  return r.paymentOn === today && todayPlannedPaise(r) === 0n && BigInt(r.remainingPaise) > 0n;
}

// ── What happened to this row today ───────────────────────────────────────

/**
 * The state of a row's payment *today* — the single thing the register is asked to show.
 *
 * `'due'` is deliberately not a failure. The rule is that a row turns green or red only once a
 * clerk has marked it taken or not taken; colouring an unanswered day red would tell the counter
 * a customer failed to turn up when the truth is that nobody has looked yet.
 *
 * `'none'` covers a case with no schedule *and* a day the schedule skips — a maturity below
 * ₹1 lakh pays on alternate working days, and its off day is not an omission.
 */
export type DayState = 'taken' | 'partial' | 'missed' | 'due' | 'none';

export const DAY_STATE_LABEL: Record<DayState, string> = {
  taken: 'Taken today',
  partial: 'Part-taken today',
  missed: 'Not taken',
  due: 'Due — not marked yet',
  none: 'Nothing due today',
};

/** Only what the state rule reads, so callers need not build a whole row. */
export interface DayStateRow {
  /** The live instalment falling due today, or null when the schedule has nothing for today. */
  todayInstalmentId: string | null;
  /** That instalment's status, straight from the database. */
  todayStatus: string | null;
  /** Earlier days still unpaid. */
  overdueCount: number;
}

/** The state of today's own control. Older unpaid days are deliberately handled separately. */
export function dayStateOf(r: DayStateRow): DayState {
  if (r.todayInstalmentId) {
    if (r.todayStatus === 'PAID') return 'taken';
    if (r.todayStatus === 'MISSED') return 'missed';
    if (r.todayStatus === 'PARTIAL') return 'partial';
    return 'due';
  }
  return 'none';
}

/**
 * Whether the case belongs in the Not taken tab.
 *
 * This cannot be inferred from `dayStateOf`: a case may have two older unpaid days and another
 * instalment due today. Hiding it from Not taken merely because today is also live loses the
 * backlog the tab exists to surface.
 */
export function hasMissedPayment(r: DayStateRow): boolean {
  return r.todayStatus === 'MISSED' || r.overdueCount > 0;
}

/**
 * The verdict used to colour the whole case row.
 *
 * An unresolved older payment keeps the row red even if another day is due or has just been
 * paid. Green therefore means the current day is taken *and* no earlier scheduled money is
 * missing; it never paints over a backlog.
 */
export function rowStateOf(r: DayStateRow): DayState {
  return hasMissedPayment(r) ? 'missed' : dayStateOf(r);
}

/**
 * Everything the "what goes out today" rules read.
 *
 * The schedule fields are optional so a caller with no schedule in hand — an unsubmitted row,
 * a test — need not invent one. Absent, the rules fall back to the typed figure, which is all
 * anybody knows about such a row.
 */
export interface TodayFigureRow extends RegisterViewRow {
  todayInstalmentId?: string | null;
  /** What the schedule plans for today, in paise. */
  todayDuePaise?: string;
  /** How much of today has already gone out. */
  todayPaidTakenPaise?: string;
}

/**
 * What this row is still going to hand over today — the single definition.
 *
 * **The schedule wins wherever there is one.** This is not a preference: the Taken button pays
 * the instalment, so a sheet that displayed the old typed figure would show a clerk one number
 * and hand over another. That is the whole class of error this system exists to prevent, and it
 * is why the Today column is read-only on a scheduled row.
 *
 * It is what is *left* of today, not what today started as. Once the customer has been paid,
 * the money is out of the drawer and must stop being counted as cash the branch has to find.
 */
export function todayPlannedPaise(r: TodayFigureRow): bigint {
  if (r.todayInstalmentId && r.todayDuePaise != null) {
    const due = BigInt(r.todayDuePaise);
    const paid = BigInt(r.todayPaidTakenPaise ?? '0');
    return due > paid ? due - paid : 0n;
  }
  return BigInt(r.todayPaise);
}

export interface TodaySplitRow extends TodayFigureRow {
  todayCashPaise: string;
  todayOnlinePaise: string;
  /** The legs the engine planned for today. */
  todayCashDuePaise?: string;
  todayOnlineDuePaise?: string;
}

/**
 * How today's figure divides between the drawer and a transfer.
 *
 * On a scheduled row the legs come from the engine, which already balanced them against the
 * branch's cash cap — there is no reason to ask a clerk to re-decide it. They are then clamped
 * to whatever is left of today, because a part-paid day must not still be funded in full: the
 * cash half is trimmed first, since that is the leg a counter settles from.
 */
export function todayPlannedSplit(r: TodaySplitRow): { total: bigint; cash: bigint; online: bigint } {
  const total = todayPlannedPaise(r);
  if (total === 0n) return { total: 0n, cash: 0n, online: 0n };

  if (r.todayInstalmentId && r.todayCashDuePaise != null && r.todayOnlineDuePaise != null) {
    const planCash = BigInt(r.todayCashDuePaise);
    const cash = planCash < total ? planCash : total;
    return { total, cash, online: total - cash };
  }
  return { total, cash: BigInt(r.todayCashPaise), online: BigInt(r.todayOnlinePaise) };
}

/**
 * What a row hands over on a chosen payout day.
 *
 * Used when the clerk is looking at tomorrow, or the 4th, rather than at the calendar's
 * today. Absent a day, this is `todayPlannedSplit` so the Taken button and the figure
 * still read the same source.
 */
export function plannedOnDate(
  r: TodaySplitRow & { payoutDays?: PayoutDayView[] },
  day: string | null,
): { total: bigint; cash: bigint; online: bigint } {
  if (!day) return todayPlannedSplit(r);
  const inst = payoutOnDate(r, day);
  if (!inst) return { total: 0n, cash: 0n, online: 0n };
  const total = leftoverOnPayoutDay(inst);
  if (total === 0n) return { total: 0n, cash: 0n, online: 0n };
  const planCash = BigInt(inst.cashPaise);
  const cash = planCash < total ? planCash : total;
  return { total, cash, online: total - cash };
}

export type TodayFigureSortKey = 'today' | 'cash' | 'online';

/**
 * Compare the exact figures the Register prints for Today, Cash or Online.
 *
 * Scheduled rows retain the old manually typed fields for import/history, so sorting those
 * fields can disagree with the schedule-backed numbers on screen. Keeping the comparator beside
 * `todayPlannedSplit` makes it impossible for display and ordering to choose different sources.
 */
export function compareTodayFigures(
  a: TodaySplitRow,
  b: TodaySplitRow,
  key: TodayFigureSortKey,
): number {
  const av = todayPlannedSplit(a);
  const bv = todayPlannedSplit(b);
  const left = key === 'today' ? av.total : av[key];
  const right = key === 'today' ? bv.total : bv[key];
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Everything the counter has to deal with today — answered or not.
 *
 * Deliberately NOT the same question as `isDueToday`, and the difference matters. `isDueToday`
 * asks "is there money still to find for this row", which is what the branch funds its drawer
 * on, so a row drops out of it the moment the customer has been paid. That is right for a
 * total and wrong for a list: a row that vanished as soon as it was marked would mean the green
 * tint never appeared on the screen anybody was looking at, and a clerk working down the page
 * would watch their own work disappear instead of accumulate.
 *
 * So the Due today TAB shows this, and the Due today FIGURE sums `isDueToday`. One is the work,
 * the other is the cash.
 */
export function isOnTodaysList(r: TodayFigureRow & DayStateRow): boolean {
  if (r.todayInstalmentId) return true;
  return isDueToday(r);
}

export interface DueSummary {
  count: number;
  total: bigint;
  cash: bigint;
  online: bigint;
  unsetCount: number;
}

/**
 * Today's obligation across every row the user can see.
 *
 * Deliberately computed from the full row set rather than the filtered view: this is what the
 * branch must fund before opening, and it must not change because somebody filtered to one
 * agent to check something.
 */
export function summariseDueToday(rows: readonly TodaySplitRow[], today: string): DueSummary {
  let count = 0;
  let total = 0n;
  let cash = 0n;
  let online = 0n;
  let unsetCount = 0;
  for (const r of rows) {
    if (isDueToday(r)) {
      // Whatever the sheet prints in the Today, Cash and Online cells, this adds up the same
      // figures. If the two ever drift apart, the branch funds its drawer from one number and
      // pays out another.
      const split = todayPlannedSplit(r);
      count += 1;
      total += split.total;
      cash += split.cash;
      online += split.online;
    } else if (isTodayButUnset(r, today)) {
      unsetCount += 1;
    }
  }
  return { count, total, cash, online, unsetCount };
}

/**
 * The sort a given filter implies.
 *
 * Choosing a filter and then choosing a sort is two decisions for one intent. "Due today"
 * always means largest-first, because that is the order you plan cash in. Picking one specific
 * day makes the date column useless as a key — every row carries the same date — so it falls
 * back to size instead.
 */
export function autoSortFor(
  tab: RegisterTab,
  onDate: string,
  dateField: DateField,
): { key: SortKey; dir: 'asc' | 'desc' } {
  if (onDate) {
    return dateField === 'form' || dateField === 'maturity'
      ? { key: 'remaining', dir: 'desc' }
      : { key: 'today', dir: 'desc' };
  }
  if (tab === 'due') return { key: 'today', dir: 'desc' };
  if (tab === 'pending') return { key: 'formDate', dir: 'asc' };
  if (tab === 'all') return { key: 'formDate', dir: 'desc' };
  return { key: 'remaining', dir: 'desc' };
}

/** Columns offered in the "Sorted by" box, in the order they are offered. */
export const SORT_LABEL: Partial<Record<SortKey, string>> = {
  today: "Today's amount",
  remaining: 'Remaining',
  amount: 'Maturity amount',
  paid: 'Paid',
  customer: 'Customer name',
  agent: 'Agent',
  paymentDate: 'Payment date',
  formDate: 'Form in date',
  maturityDate: 'Maturity date',
  account: 'A/c number',
  days: 'Window days',
  perDay: 'Per day',
};

/** The next calendar day. Plain UTC arithmetic on a YYYY-MM-DD string, like working-days.ts. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Indian digit grouping for a plain rupee string.
 *
 * Anything that is not a clean number comes back untouched, so a half-typed value is never
 * mangled — which is what lets the sheet show 10,00,000 at rest and raw digits while editing.
 */
export function groupIndian(v: string): string {
  const t = v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return v;
  const [whole, frac] = t.split('.');
  const grouped = new Intl.NumberFormat('en-IN').format(BigInt(whole));
  return frac ? `${grouped}.${frac}` : grouped;
}

// ── Date filtering ─────────────────────────────────────────────────────────
//
// One filter, three shapes: a single day, a closed range, or an open-ended
// "everything before today". They are all the same structure — a `from` and a
// `to`, either of which may be blank — so the table only ever applies one rule.

export interface DateRange {
  /** Inclusive lower bound, or '' for open-ended. */
  from: string;
  /** Inclusive upper bound, or '' for open-ended. */
  to: string;
}

export const EMPTY_RANGE: DateRange = { from: '', to: '' };

export type DatePreset = 'today' | 'tomorrow' | 'thisWeek' | 'next7' | 'thisMonth' | 'overdue';

/** Offered left to right in the toolbar, in the order a clerk reaches for them. */
export const DATE_PRESETS: DatePreset[] = ['today', 'tomorrow', 'thisWeek', 'next7', 'thisMonth', 'overdue'];

export const DATE_PRESET_LABEL: Record<DatePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  next7: 'Next 7 days',
  thisMonth: 'This month',
  overdue: 'Overdue',
};

/**
 * What the chip prints. On a laptop the filter bar has no width to spare, and these six chips
 * were the widest thing on it — long enough to push the sort control onto a line of its own.
 * `DATE_PRESET_LABEL` stays the full wording and is shown as the chip's tooltip, so "Week" and
 * "7 days" can still be told apart as the calendar week versus a rolling seven days.
 */
export const DATE_PRESET_SHORT: Record<DatePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'Week',
  next7: '7 days',
  thisMonth: 'Month',
  overdue: 'Overdue',
};

/** Plain UTC arithmetic on a YYYY-MM-DD string, like working-days.ts. */
export function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The previous calendar day. */
export function prevDay(iso: string): string {
  return shiftDays(iso, -1);
}

/** Monday of the week containing `iso`. Weeks start Monday — Sunday is the off day here. */
export function startOfWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return shiftDays(iso, -((d.getUTCDay() + 6) % 7));
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  // Day 0 of the next month is the last day of this one — no month-length table needed.
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Turn a preset into the range it means.
 *
 * "Overdue" is deliberately open at the bottom: a payment date three months
 * stale is still overdue, and a clerk asking for overdue rows wants all of
 * them, not the ones inside some arbitrary lookback.
 */
export function resolveDatePreset(preset: DatePreset, today: string): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'tomorrow': {
      const t = nextDay(today);
      return { from: t, to: t };
    }
    case 'thisWeek': {
      const s = startOfWeek(today);
      return { from: s, to: shiftDays(s, 6) };
    }
    case 'next7':
      return { from: today, to: shiftDays(today, 6) };
    case 'thisMonth':
      return { from: startOfMonth(today), to: endOfMonth(today) };
    case 'overdue':
      return { from: '', to: prevDay(today) };
  }
}

/** Which preset — if any — the current range is showing, so the chip can light up. */
export function activeDatePreset(range: DateRange, today: string): DatePreset | null {
  for (const p of DATE_PRESETS) {
    const r = resolveDatePreset(p, today);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return null;
}

export function isRangeActive(range: DateRange): boolean {
  return Boolean(range.from || range.to);
}

/**
 * Does this row fall inside the range, read against the chosen date column?
 *
 * A row with no date in that column is excluded whenever a filter is on. That is
 * the honest answer: "show me everything paid on the 22nd" cannot include a row
 * that has no payment date, and silently keeping it would inflate the total the
 * clerk is about to count out.
 *
 * ISO dates compare correctly as strings, so no Date objects are built per row.
 */
function isoInRange(v: string, range: DateRange): boolean {
  if (range.from && v < range.from) return false;
  if (range.to && v > range.to) return false;
  return true;
}

export function rowInDateRange(r: RegisterViewRow, field: DateField, range: DateRange): boolean {
  if (!isRangeActive(range)) return true;
  if (field === 'payout') {
    const days = r.payoutDays ?? [];
    if (days.length === 0) return false;
    return days.some((d) => isoInRange(d.dueOn, range));
  }
  const v = rowOnDate(r, field);
  if (!v) return false;
  return isoInRange(v, range);
}

export interface NextPayout {
  date: string;
  count: number;
  totalPaise: bigint;
}

/**
 * The next day any live schedule still has money to hand over, on or after `from`.
 *
 * This is what the register shows when today is empty: August maturities do not pay on
 * 31 Aug — they wait for maturity + 3 calendar days, rolled past the month-start close.
 */
export function nextPayoutDay(
  rows: readonly { payoutDays?: PayoutDayView[]; remainingPaise: string }[],
  from: string,
): NextPayout | null {
  const byDate = new Map<string, { count: number; total: bigint }>();
  for (const r of rows) {
    if (BigInt(r.remainingPaise) <= 0n) continue;
    for (const d of r.payoutDays ?? []) {
      if (d.dueOn < from) continue;
      const left = leftoverOnPayoutDay(d);
      if (left <= 0n) continue;
      const cur = byDate.get(d.dueOn) ?? { count: 0, total: 0n };
      cur.count += 1;
      cur.total += left;
      byDate.set(d.dueOn, cur);
    }
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;
  const date = dates[0]!;
  const s = byDate.get(date)!;
  return { date, count: s.count, totalPaise: s.total };
}

export interface AgentDayTotal {
  agentId: string;
  agentName: string;
  count: number;
  totalPaise: bigint;
}

/** What each agent must collect on one payout day, largest first. */
export function summariseAgentsForDay(
  rows: readonly { agentId: string; agentName: string; payoutDays?: PayoutDayView[] }[],
  day: string,
): AgentDayTotal[] {
  const map = new Map<string, AgentDayTotal>();
  for (const r of rows) {
    const inst = payoutOnDate(r, day);
    if (!inst) continue;
    const left = leftoverOnPayoutDay(inst);
    if (left <= 0n) continue;
    const cur = map.get(r.agentId) ?? {
      agentId: r.agentId,
      agentName: r.agentName,
      count: 0,
      totalPaise: 0n,
    };
    cur.count += 1;
    cur.totalPaise += left;
    map.set(r.agentId, cur);
  }
  return [...map.values()].sort((a, b) => {
    if (a.totalPaise === b.totalPaise) return a.agentName.localeCompare(b.agentName);
    return a.totalPaise < b.totalPaise ? 1 : -1;
  });
}

// ── Selection ──────────────────────────────────────────────────────────────

/**
 * The recommended daily figure: what is left, spread over the days that can actually carry a
 * payout.
 *
 * NOT `remaining / windowDays`. `windowDays` is the whole window, including the processing days
 * that pay nothing, and a sub-₹1-lakh case only pays on alternate days on top of that. Dividing
 * by the window under-fills every day and leaves the case short at its own deadline — which is
 * the exact failure the schedule engine exists to prevent.
 *
 * One definition, used by the sheet's column, its sort and the bulk "set today" action, so the
 * three cannot disagree about what a day is worth.
 */
export function recommendedPerDay(
  remainingPaise: bigint,
  maturityPaise: bigint,
  windowDays: number,
): bigint {
  const remaining = remainingPaise > 0n ? remainingPaise : 0n;
  if (remaining === 0n) return 0n;
  const window = Math.max(MIN_WINDOW_DAYS, Math.floor(windowDays) || MIN_WINDOW_DAYS);
  const plan = payoutPlanFor(maturityPaise > 0n ? maturityPaise : remaining, window);
  return remaining / BigInt(plan.payoutDays);
}

/** What a bulk action does to today's amount. Shared by the sheet and the server. */
export type BulkTodayMode = 'perDay' | 'remaining' | 'amount' | 'clear';

export const BULK_TODAY_LABEL: Record<BulkTodayMode, string> = {
  perDay: 'Recommended per day',
  remaining: 'Full remaining',
  amount: 'A fixed amount',
  clear: 'Clear (set to zero)',
};

/**
 * Today's amount a bulk action should set on one row.
 *
 * Always clamped to what the case still owes, so no bulk action can ever approve
 * more than the customer is due — the same ceiling `updateRegisterRow` enforces
 * for a single typed cell.
 */
export function bulkTodayAmount(
  mode: BulkTodayMode,
  row: { remaining: bigint; windowDays: number; maturityPaise?: bigint; amount?: bigint },
): bigint {
  const remaining = row.remaining > 0n ? row.remaining : 0n;
  if (remaining === 0n) return 0n;
  switch (mode) {
    case 'clear':
      return 0n;
    case 'remaining':
      return remaining;
    case 'perDay':
      return recommendedPerDay(remaining, row.maturityPaise ?? remaining, row.windowDays);
    case 'amount': {
      const want = row.amount ?? 0n;
      if (want <= 0n) return 0n;
      return want > remaining ? remaining : want;
    }
  }
}

export interface SelectionRow extends RegisterViewRow {
  maturityPaise: string;
  paidPaise: string;
  todayCashPaise: string;
  todayOnlinePaise: string;
}

export interface SelectionSummary {
  count: number;
  maturity: bigint;
  paid: bigint;
  remaining: bigint;
  today: bigint;
  cash: bigint;
  online: bigint;
  dueCount: number;
}

/** Totals for the ticked rows — what the toolbar states before you act on them. */
export function summariseSelection(rows: readonly SelectionRow[]): SelectionSummary {
  let maturity = 0n;
  let paid = 0n;
  let remaining = 0n;
  let today = 0n;
  let cash = 0n;
  let online = 0n;
  let dueCount = 0;
  for (const r of rows) {
    maturity += BigInt(r.maturityPaise);
    paid += BigInt(r.paidPaise);
    remaining += BigInt(r.remainingPaise);
    today += BigInt(r.todayPaise);
    cash += BigInt(r.todayCashPaise);
    online += BigInt(r.todayOnlinePaise);
    if (isDueToday(r)) dueCount += 1;
  }
  return { count: rows.length, maturity, paid, remaining, today, cash, online, dueCount };
}
