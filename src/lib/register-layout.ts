/** Register column catalog. Admin can reorder / hide; Excel template follows this. */

/**
 * Default left-to-right order.
 *
 * Ordered by what the person at the counter reads, not by what the old spreadsheet happened to
 * list first: who the customer is, what they are owed, and then — before anything else — what
 * goes out today. With fourteen columns the sheet scrolls sideways on a branch monitor, so the
 * three columns that decide today's cash have to sit inside the first screenful.
 *
 * Safe to reorder: the Excel import matches on header *text*, and any branch whose admin has
 * saved a custom order keeps it (see parseRegisterLayout).
 */
export const REGISTER_COL_IDS = [
  'account',
  'customer',
  'amount',
  'paid',
  'remaining',
  'missed',
  'today',
  'total',
  'cash',
  'online',
  'days',
  'perDay',
  'paidToday',
  'paidCashToday',
  'paidOnlineToday',
  'paymentDate',
  'formDate',
  'maturityDate',
  'agent',
] as const;

export type RegisterColId = (typeof REGISTER_COL_IDS)[number];

export interface RegisterColDef {
  id: RegisterColId;
  label: string;
  excel: string;
  right?: boolean;
  /** Cannot be hidden — import still needs these headers. */
  required?: boolean;
  /**
   * Fixed column width (Tailwind class). The table is `table-fixed`, so without these the
   * browser divides the width evenly and the two columns a clerk actually reads — customer
   * and agent — get truncated to "Rajendra Na" while Days sits in an empty 90px cell.
   */
  w?: string;
  /**
   * What gets sacrificed first when the sheet is too narrow. Lower survives longer.
   *
   * The ranking is "what does the person at the counter need to pay this row?": who it is and
   * what is still owed (1–2), what goes out today and in what form (3), the dates the schedule
   * hangs off (4), and finally the reference figures anyone can derive or look up later (5).
   * Required columns carry a priority too, but `columnsThatFit` never drops them.
   */
  priority: number;
  /**
   * One line saying what this column is for, shown on hover over its heading.
   *
   * Not decoration. This sheet is read by clerks who did not design it, and a heading like
   * "Days" or "Per day" is only obvious to whoever wrote it — the difference between the total
   * window and the days that actually pay is exactly the kind of thing that gets a payout wrong.
   * A column with nothing useful to say here should probably not be a column.
   */
  hint: string;
}

export const REGISTER_COL_DEFS: Record<RegisterColId, RegisterColDef> = {
  account: {
    id: 'account', label: 'Account number', excel: 'Savings Account Number', w: 'w-[5.5rem]', priority: 3,
    hint: 'The customer\u2019s savings account number \u2014 what the payout is checked against.',
  },
  customer: {
    id: 'customer', label: 'Customer name', excel: 'Customer Name', required: true, w: 'w-[8.2rem]', priority: 1,
    hint: 'Who the money belongs to. Never dropped, however narrow the screen.',
  },
  maturityDate: {
    id: 'maturityDate', label: 'Maturity', excel: 'Date of Maturity', w: 'w-[5.25rem]', priority: 5,
    hint: 'The day the deposit matured. Everything else hangs off this: payouts start three calendar days later.',
  },
  formDate: {
    id: 'formDate', label: 'Form in', excel: 'Form Submission Date', w: 'w-[5.25rem]', priority: 4,
    hint: 'The day the agent handed the form in. A record, not a deadline \u2014 it does not move the schedule.',
  },
  paymentDate: {
    id: 'paymentDate', label: 'Payment date', excel: 'Payment Date', w: 'w-[5.2rem]', priority: 1,
    hint: 'The first day of this case\u2019s payout window.',
  },
  amount: {
    id: 'amount', label: 'Maturity amount', excel: 'Maturity Amount', right: true, required: true, w: 'w-[5.2rem]', priority: 1,
    hint: 'The full maturity amount owed to the customer.',
  },
  paid: {
    id: 'paid', label: 'Paid', excel: 'Paid Maturity', right: true, w: 'w-[5.5rem]', priority: 3,
    hint: 'How much has gone out so far, cash and online together.',
  },
  remaining: {
    id: 'remaining', label: 'Remaining', excel: 'Remaining Amount', right: true, w: 'w-[5.4rem]', priority: 2,
    hint: 'Amount minus paid \u2014 what the bank still owes this customer.',
  },
  missed: {
    id: 'missed', label: 'Missed amount', excel: 'Missed Amount', right: true, w: 'w-[5.6rem]', priority: 2,
    hint: 'Earlier due days the customer never collected. It does NOT come off Remaining \u2014 the bank still owes this money, it simply was not handed over on the day.',
  },
  total: {
    id: 'total', label: 'Total amount', excel: 'Total Amount', right: true, required: true, w: 'w-[5.8rem]', priority: 1,
    hint: 'Missed amount plus today\u2019s \u2014 everything the customer can walk out with now. A single payment of this size clears the backlog and the day, oldest first.',
  },
  agent: {
    id: 'agent', label: 'Agent name', excel: "Customer's Agent Name", w: 'w-[6.5rem]', priority: 1,
    hint: 'The agent who brought this customer in.',
  },
  days: {
    id: 'days', label: 'Days', excel: 'Window Days', right: true, w: 'w-[3.25rem]', priority: 6,
    hint: 'Payout days the customer can withdraw. ₹1 lakh+ defaults to 12 daily; below that, 6 alternate. Type any count to split across that many days.',
  },
  perDay: {
    id: 'perDay', label: 'Recommended', excel: 'Recommended Payment', right: true, w: 'w-[6.2rem]', priority: 6,
    hint: 'Advice only: remaining money spread over the days that actually pay. Not what must be handed over today.',
  },
  today: {
    id: 'today', label: "Today's amount", excel: 'Due Payment', right: true, required: true, w: 'w-[5.7rem]', priority: 1,
    hint: 'The day\u2019s own instalment \u2014 the fixed base the case was scheduled on. It does not rise because an earlier day was missed; that money is in Missed amount.',
  },
  cash: {
    id: 'cash', label: 'Cash', excel: 'Today Cash', right: true, w: 'w-[5.25rem]', priority: 3,
    hint: 'The cash half of today\u2019s figure, kept inside the branch\u2019s daily cash cap.',
  },
  online: {
    id: 'online', label: 'Online', excel: 'Today Online', right: true, w: 'w-[5.25rem]', priority: 3,
    hint: 'The transfer half of today\u2019s figure.',
  },
  paidToday: {
    id: 'paidToday', label: 'Actual paid', excel: 'Paid Today', right: true, w: 'w-[5.2rem]', priority: 1,
    hint: 'Type what was actually given, then press Taken. Nothing is recorded until you confirm.',
  },
  paidCashToday: {
    id: 'paidCashToday', label: 'Paid in cash', excel: 'Paid in Cash', right: true, w: 'w-[5rem]', priority: 2,
    hint: 'Cash actually handed over today.',
  },
  paidOnlineToday: {
    id: 'paidOnlineToday', label: 'Paid online', excel: 'Paid Online', right: true, w: 'w-[5rem]', priority: 2,
    hint: 'Online payment actually recorded today.',
  },
};

export interface RegisterLayout {
  version: number;
  order: RegisterColId[];
  hidden: RegisterColId[];
}

export const REGISTER_LAYOUT_VERSION = 3;

export const DEFAULT_REGISTER_LAYOUT: RegisterLayout = {
  version: REGISTER_LAYOUT_VERSION,
  order: [
    'account', 'customer', 'agent', 'amount', 'maturityDate', 'paymentDate',
    'remaining', 'paid', 'missed', 'today', 'total', 'paidToday',
    'formDate', 'perDay', 'paidCashToday', 'paidOnlineToday', 'cash', 'online', 'days',
  ],
  hidden: ['formDate', 'perDay', 'paidCashToday', 'paidOnlineToday', 'cash', 'online', 'days'],
};

const ID_SET = new Set<string>(REGISTER_COL_IDS);

export function parseRegisterLayout(raw: unknown): RegisterLayout {
  const order: RegisterColId[] = [];
  const hidden: RegisterColId[] = [];
  const seen = new Set<string>();
  const o = raw && typeof raw === 'object' ? (raw as { order?: unknown; hidden?: unknown }) : {};
  const version = raw && typeof raw === 'object' ? (raw as { version?: unknown }).version : undefined;
  const hideSet = new Set(
    Array.isArray(o.hidden) ? o.hidden.filter((x): x is string => typeof x === 'string') : [],
  );

  // Every saved layout predating the corrected cashier sheet is upgraded once. The version is
  // persisted when Admin next saves Columns, so later custom layouts remain exactly as chosen.
  if (version !== REGISTER_LAYOUT_VERSION) {
    return {
      version: REGISTER_LAYOUT_VERSION,
      order: [...DEFAULT_REGISTER_LAYOUT.order],
      hidden: [...DEFAULT_REGISTER_LAYOUT.hidden],
    };
  }

  const take = (id: string) => {
    if (!ID_SET.has(id) || seen.has(id)) return;
    seen.add(id);
    const col = id as RegisterColId;
    order.push(col);
    if (hideSet.has(id) && !REGISTER_COL_DEFS[col].required) hidden.push(col);
  };

  if (Array.isArray(o.order)) {
    for (const id of o.order) if (typeof id === 'string') take(id);
  }
  for (const id of REGISTER_COL_IDS) take(id);
  return { version: REGISTER_LAYOUT_VERSION, order, hidden };
}

export function visibleRegisterCols(layout: RegisterLayout): RegisterColDef[] {
  const hide = new Set(layout.hidden);
  return layout.order
    .filter((id) => !hide.has(id) || REGISTER_COL_DEFS[id].required)
    .map((id) => REGISTER_COL_DEFS[id]);
}

export function excelHeadersForLayout(layout: RegisterLayout): string[] {
  return visibleRegisterCols(layout).map((c) => c.excel);
}

// ── Fitting the sheet to the screen ────────────────────────────────────────────

/** The declared width in rem. `w-[6.25rem]` → 6.25. Falls back to a sane default. */
export function colWidthRem(col: RegisterColDef): number {
  const m = /\[([\d.]+)rem\]/.exec(col.w ?? '');
  return m ? Number(m[1]) : 5;
}

/**
 * Room the row needs for the fixed furniture around the data columns: the select checkbox and
 * the two tick columns on the left.
 *
 * A caller that also renders the "Given" column or the overflow expander must add those on top
 * via `reservedRem` — leaving them out of the budget lets the fitted columns fill the table and
 * squeeze the trailing ones to zero width, which is exactly what `table-fixed` will do.
 */
export const REGISTER_GUTTER_REM = 1.75;

export interface ColumnFit {
  shown: RegisterColDef[];
  dropped: RegisterColDef[];
}

/**
 * Choose the columns that fit `widthPx`, dropping the least useful first.
 *
 * The register is read left to right at a counter, and a sideways scrollbar there means the
 * clerk loses the customer's name the moment they look at the cash figure. So the sheet never
 * scrolls sideways: it decides what it can afford to show and moves the rest into the row's
 * expander, where it is one click away and still exported in full.
 *
 * Dropping is by `priority`, worst first, but the survivors come back in the caller's original
 * order — a responsive sheet that also reshuffles its columns is unreadable. Required columns
 * are never dropped, so a very narrow screen bottoms out rather than emptying the table.
 *
 * Pure and unit-tested: the component only supplies the measured width.
 */
export function columnsThatFit(
  cols: readonly RegisterColDef[],
  widthPx: number,
  reservedRem: number = REGISTER_GUTTER_REM,
): ColumnFit {
  const budgetRem = Math.max(0, widthPx / 16 - reservedRem);
  const order = new Map(cols.map((c, i) => [c.id, i]));

  const keep = new Set(cols.map((c) => c.id));
  let usedRem = cols.reduce((sum, c) => sum + colWidthRem(c), 0);

  // Worst priority first; ties broken by the rightmost column, which the eye reaches last.
  const sacrificial = cols
    .filter((c) => !c.required)
    .sort((a, b) => b.priority - a.priority || (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0));

  for (const c of sacrificial) {
    if (usedRem <= budgetRem) break;
    keep.delete(c.id);
    usedRem -= colWidthRem(c);
  }

  const byOriginalOrder = (a: RegisterColDef, b: RegisterColDef) =>
    (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);

  return {
    shown: cols.filter((c) => keep.has(c.id)).sort(byOriginalOrder),
    dropped: cols.filter((c) => !keep.has(c.id)).sort(byOriginalOrder),
  };
}
