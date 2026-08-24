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
  'today',
  'cash',
  'online',
  'days',
  'perDay',
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
}

export const REGISTER_COL_DEFS: Record<RegisterColId, RegisterColDef> = {
  account: { id: 'account', label: 'A/c no.', excel: 'Savings Account Number', w: 'w-[6.25rem]', priority: 3 },
  customer: { id: 'customer', label: 'Customer', excel: 'Customer Name', required: true, w: 'w-[9.75rem]', priority: 1 },
  maturityDate: { id: 'maturityDate', label: 'Maturity', excel: 'Date of Maturity', w: 'w-[5.25rem]', priority: 5 },
  formDate: { id: 'formDate', label: 'Form in', excel: 'Form Submission Date', required: true, w: 'w-[5.25rem]', priority: 4 },
  paymentDate: { id: 'paymentDate', label: 'Payment', excel: 'Payment Date', w: 'w-[5.25rem]', priority: 4 },
  amount: { id: 'amount', label: 'Amount', excel: 'Maturity Amount', right: true, required: true, w: 'w-[5.75rem]', priority: 2 },
  paid: { id: 'paid', label: 'Paid', excel: 'Paid Maturity', right: true, w: 'w-[5.5rem]', priority: 3 },
  remaining: { id: 'remaining', label: 'Remaining', excel: 'Remaining Amount', right: true, w: 'w-[6rem]', priority: 1 },
  agent: { id: 'agent', label: 'Agent', excel: "Customer's Agent Name", w: 'w-[8rem]', priority: 3 },
  days: { id: 'days', label: 'Days', excel: 'Window Days', right: true, w: 'w-[3.25rem]', priority: 6 },
  perDay: { id: 'perDay', label: 'Per day', excel: 'Recommended Per Day', right: true, w: 'w-[5.25rem]', priority: 6 },
  today: { id: 'today', label: 'Today', excel: "Today's Approved Withdrawalable Amount", right: true, w: 'w-[5.75rem]', priority: 1 },
  cash: { id: 'cash', label: 'Cash', excel: 'Today Cash', right: true, w: 'w-[5.25rem]', priority: 3 },
  online: { id: 'online', label: 'Online', excel: 'Today Online', right: true, w: 'w-[5.25rem]', priority: 3 },
};

export interface RegisterLayout {
  order: RegisterColId[];
  hidden: RegisterColId[];
}

export const DEFAULT_REGISTER_LAYOUT: RegisterLayout = {
  order: [...REGISTER_COL_IDS],
  hidden: [],
};

const ID_SET = new Set<string>(REGISTER_COL_IDS);

export function parseRegisterLayout(raw: unknown): RegisterLayout {
  const order: RegisterColId[] = [];
  const hidden: RegisterColId[] = [];
  const seen = new Set<string>();
  const o = raw && typeof raw === 'object' ? (raw as { order?: unknown; hidden?: unknown }) : {};
  const hideSet = new Set(
    Array.isArray(o.hidden) ? o.hidden.filter((x): x is string => typeof x === 'string') : [],
  );

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
  return { order, hidden };
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
export const REGISTER_GUTTER_REM = 6.5;

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
