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
}

export const REGISTER_COL_DEFS: Record<RegisterColId, RegisterColDef> = {
  account: { id: 'account', label: 'A/c no.', excel: 'Savings Account Number', w: 'w-[6.25rem]' },
  customer: { id: 'customer', label: 'Customer', excel: 'Customer Name', required: true, w: 'w-[9.75rem]' },
  maturityDate: { id: 'maturityDate', label: 'Maturity', excel: 'Date of Maturity', w: 'w-[5.25rem]' },
  formDate: { id: 'formDate', label: 'Form in', excel: 'Form Submission Date', required: true, w: 'w-[5.25rem]' },
  paymentDate: { id: 'paymentDate', label: 'Payment', excel: 'Payment Date', w: 'w-[5.25rem]' },
  amount: { id: 'amount', label: 'Amount', excel: 'Maturity Amount', right: true, required: true, w: 'w-[5.75rem]' },
  paid: { id: 'paid', label: 'Paid', excel: 'Paid Maturity', right: true, w: 'w-[5.5rem]' },
  remaining: { id: 'remaining', label: 'Remaining', excel: 'Remaining Amount', right: true, w: 'w-[6rem]' },
  agent: { id: 'agent', label: 'Agent', excel: "Customer's Agent Name", w: 'w-[8rem]' },
  days: { id: 'days', label: 'Days', excel: 'Window Days', right: true, w: 'w-[3.25rem]' },
  perDay: { id: 'perDay', label: 'Per day', excel: 'Recommended Per Day', right: true, w: 'w-[5.25rem]' },
  today: { id: 'today', label: 'Today', excel: "Today's Approved Withdrawalable Amount", right: true, w: 'w-[5.75rem]' },
  cash: { id: 'cash', label: 'Cash', excel: 'Today Cash', right: true, w: 'w-[5.25rem]' },
  online: { id: 'online', label: 'Online', excel: 'Today Online', right: true, w: 'w-[5.25rem]' },
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
