'use client';

import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  ClipboardCheck,
  Download,
  FileImage,
  FileSpreadsheet,
  GripVertical,
  Link2,
  Layers,
  LayoutGrid,
  LockKeyhole,
  MessageCircle,
  Printer,
  RotateCcw,
  Save,
  Send,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { toast } from 'sonner';

import {
  addCashbookCommitmentAction,
  addCashbookEntryAction,
  confirmCashbookCloseAction,
  reopenCashbookDayAction,
  requestCashbookCloseAction,
  saveCashbookDayAction,
  setCashbookCommitmentSettledAction,
  updateCashbookEntryAction,
  voidCashbookCommitmentAction,
  voidCashbookEntryAction,
} from '@/actions/cashbook';
import { Badge } from '@/components/ui/badge';
import { CashbookNoteMix } from '@/components/charts/cashbook-note-mix';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Glass, GlassCard } from '@/components/ui/glass';
import { Money } from '@/components/ui/money';
import {
  CASHBOOK_COMMITMENT_META,
  CASHBOOK_DENOMINATIONS,
  calculateDailyCashbook,
  type CashbookDayFigures,
  type CashbookCommitmentKind,
  type CashbookDenominationField,
  type DailyCashbookTotals,
} from '@/lib/daily-cashbook';
import { formatPaise, paiseToDecimalString, tryParseRupeesToPaise } from '@/lib/money';
import type { Serialized } from '@/lib/serialize';
import { cn } from '@/lib/utils';
import { addDays, formatISODate } from '@/lib/working-days';
import type { CashbookDayView } from '@/services/queries';

type View = Serialized<CashbookDayView>;
type EntryRow = View['entries'][number];

interface FigureForm {
  oldPortalTotal: string;
  fixedDeposit: string;
  newBusiness: string;
  membershipCollection: string;
  oldLoan: string;
  note500Count: string;
  note200Count: string;
  note100Count: string;
  note50Count: string;
  note20Count: string;
  note10Count: string;
  coins: string;
  notes: string;
}

const STATUS_META = {
  OPEN: { label: 'Open', tone: 'info' as const },
  CLOSE_REQUESTED: { label: 'Awaiting close approval', tone: 'warn' as const },
  CLOSED: { label: 'Closed & locked', tone: 'money' as const },
};

const RECON_META: Record<
  DailyCashbookTotals['state'],
  { label: string; detail: string; tone: 'neutral' | 'money' | 'danger' | 'warn' }
> = {
  EMPTY: { label: 'Not counted', detail: 'Enter the cash drawer count.', tone: 'neutral' },
  BALANCED: { label: 'Cash matches', detail: 'Expected and counted cash agree.', tone: 'money' },
  SHORT: { label: 'Cash short', detail: 'The drawer is below expected cash.', tone: 'danger' },
  EXCESS: { label: 'Cash extra', detail: 'The drawer is above expected cash.', tone: 'warn' },
};

const MOVEMENT_COLUMNS = [
  { key: 'receiving', label: 'RECEIVING', head: 'color-mix(in oklab, var(--color-money-500) 16%, var(--surface-solid))', accent: 'var(--color-money-500)', category: 'OTHER_RECEIPT', channel: 'CASH' },
  { key: 'newLoan', label: 'NEW LOAN', head: 'color-mix(in oklab, var(--color-money-500) 16%, var(--surface-solid))', accent: 'var(--color-money-500)', category: 'NEW_LOAN', channel: 'CASH' },
  { key: 'savings', label: 'SAVINGS DEPOSIT', head: 'color-mix(in oklab, var(--color-money-500) 16%, var(--surface-solid))', accent: 'var(--color-money-500)', category: 'SAVINGS_DEPOSIT', channel: 'CASH' },
  { key: 'withdrawal', label: 'WITHDRAWAL', head: 'color-mix(in oklab, var(--color-danger-500) 14%, var(--surface-solid))', accent: 'var(--color-danger-500)', category: 'WITHDRAWAL', channel: 'CASH' },
  { key: 'byAccount', label: 'BY ACCOUNT', head: 'color-mix(in oklab, var(--color-danger-500) 14%, var(--surface-solid))', accent: 'var(--color-danger-500)', category: 'OTHER_RECEIPT', channel: 'ACCOUNT' },
  { key: 'expenses', label: 'EXPENSES', head: 'color-mix(in oklab, var(--color-danger-500) 14%, var(--surface-solid))', accent: 'var(--color-danger-500)', category: 'EXPENSE', channel: 'CASH' },
  { key: 'renewal', label: 'RENEWAL', head: 'color-mix(in oklab, var(--color-info-500) 15%, var(--surface-solid))', accent: 'var(--color-info-500)', category: 'RENEWAL', channel: 'CASH' },
  { key: 'opening', label: 'OPENING BALANCE', head: 'color-mix(in oklab, var(--color-warn-500) 18%, var(--surface-solid))', accent: 'var(--color-warn-500)', category: 'OPENING_BALANCE', channel: 'CASH' },
] as const;

const COMMITMENT_COLUMNS = [
  { key: 'givenCash', label: 'BORROWED CASH', head: 'color-mix(in oklab, var(--color-brand-500) 16%, var(--surface-solid))', accent: 'var(--color-brand-500)', kind: 'GIVEN_CASH' },
  { key: 'dueAmount', label: 'DUE AMOUNT', head: 'color-mix(in oklab, var(--color-warn-500) 18%, var(--surface-solid))', accent: 'var(--color-warn-500)', kind: 'DUE_AMOUNT' },
  { key: 'pendingWithdrawal', label: 'PENDING W/D', head: 'color-mix(in oklab, var(--color-danger-500) 12%, var(--surface-solid))', accent: 'var(--color-danger-500)', kind: 'PENDING_WITHDRAWAL' },
] as const;

const SHEET_COLUMNS = [...MOVEMENT_COLUMNS, ...COMMITMENT_COLUMNS] as const;

type MovementColumn = (typeof MOVEMENT_COLUMNS)[number];
type MovementKey = MovementColumn['key'];
type CommitmentColumn = (typeof COMMITMENT_COLUMNS)[number];
type SheetColumn = (typeof SHEET_COLUMNS)[number];
type SheetKey = SheetColumn['key'];
type CellSelection = { anchor: string; focus: string };
type NamedDrafts = Record<CashbookCommitmentKind, { partyName: string; amount: string }>;
// 'cashFlow' now renders the note mix. The id is deliberately NOT renamed: it is the key
// saved layouts are stored under in localStorage, and the restore guard drops any saved
// order that does not contain every known id — a rename silently resets everyone's layout.
type PanelId = 'ledger' | 'cashControl' | 'cashFlow' | 'calculation';
type ToolbarId = 'date' | 'branch' | 'expected' | 'counted' | 'difference' | 'borrowed' | 'due' | 'pending' | 'status' | 'close' | 'utilities';

const CASHBOOK_GRID_COLUMNS = 16;
const DEFAULT_PANEL_ORDER: PanelId[] = ['ledger', 'cashControl', 'cashFlow', 'calculation'];
const DEFAULT_PANEL_SPANS: Record<PanelId, number> = { ledger: 10, cashControl: 3, cashFlow: 3, calculation: 6 };
const DEFAULT_TOOLBAR_ORDER: ToolbarId[] = ['date', 'branch', 'expected', 'counted', 'difference', 'borrowed', 'due', 'pending', 'status', 'close', 'utilities'];
const DEFAULT_TOOLBAR_WIDTHS: Record<ToolbarId, number> = {
  date: 202,
  branch: 176,
  expected: 88,
  counted: 88,
  difference: 134,
  borrowed: 108,
  due: 108,
  pending: 108,
  status: 70,
  close: 82,
  utilities: 76,
};
const TOOLBAR_MIN_WIDTHS: Record<ToolbarId, number> = {
  date: 154,
  branch: 138,
  expected: 84,
  counted: 84,
  difference: 124,
  borrowed: 104,
  due: 104,
  pending: 104,
  status: 68,
  close: 76,
  utilities: 104,
};

const COMMITMENT_UI_META: Record<CashbookCommitmentKind, { label: string; shortLabel: string }> = {
  GIVEN_CASH: { label: 'Borrowed Cash', shortLabel: 'Borrowed Cash' },
  DUE_AMOUNT: { label: 'Due Amount', shortLabel: 'Due Amount' },
  PENDING_WITHDRAWAL: { label: 'Pending Withdrawal', shortLabel: 'Pending W/D' },
};

const SHEET_ROWS = 20;
/**
 * How far the sheet can go.
 *
 * A branch works a few dozen lines on a normal day and several hundred on a heavy one, so the
 * ceiling is 500 — but rendering 500 × 11 empty cells up front costs a visibly slower keystroke
 * for the 99% of days that never reach row 40. Rows are therefore revealed as the cursor walks
 * into them: the capacity is always 500, the DOM only ever holds what has been reached.
 */
const MAX_SHEET_ROWS = 500;
const ROW_REVEAL_BUFFER = 10;

function sheetMoneyInput(paise: string): string {
  const amount = BigInt(paise);
  return amount % 100n === 0n ? (amount / 100n).toString() : paiseToDecimalString(amount);
}

function nonNegativeCount(value: string): number {
  if (!/^\d+$/.test(value.trim())) return 0;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function liveMoney(value: string): bigint {
  return tryParseRupeesToPaise(value) ?? 0n;
}

function initialFigures(view: View): FigureForm {
  return {
    oldPortalTotal: sheetMoneyInput(view.figures.oldPortalTotalPaise),
    fixedDeposit: sheetMoneyInput(view.figures.fixedDepositPaise),
    newBusiness: sheetMoneyInput(view.figures.newBusinessPaise),
    membershipCollection: sheetMoneyInput(view.figures.membershipCollectionPaise),
    oldLoan: sheetMoneyInput(view.figures.oldLoanPaise),
    note500Count: String(view.figures.note500Count),
    note200Count: String(view.figures.note200Count),
    note100Count: String(view.figures.note100Count),
    note50Count: String(view.figures.note50Count),
    note20Count: String(view.figures.note20Count),
    note10Count: String(view.figures.note10Count),
    coins: sheetMoneyInput(view.figures.coinsPaise),
    notes: view.day?.notes ?? '',
  };
}

/**
 * Which column a saved entry belongs in.
 *
 * Receiving used to claim every CASH receipt, so a figure typed into New loan, Savings deposit or
 * Renewal appeared a second time in Receiving as a read-only echo. On a sheet whose whole job is
 * to be added up by eye that reads as double counting, and the clerk cannot tell the echo from a
 * real receipt. Receiving now shows only what it writes.
 *
 * By account is deliberately left wide. It is a DEDUCTION in `expectedPhysicalCash`, so narrowing
 * it would change the reconciliation for an account-channel renewal — a row this screen cannot
 * currently create, but the arithmetic is not mine to quietly redefine.
 */
const RECEIPT_CATEGORIES: readonly string[] = ['OTHER_RECEIPT', 'NEW_LOAN', 'SAVINGS_DEPOSIT', 'RENEWAL'];

function entryBelongs(row: EntryRow, key: MovementKey): boolean {
  if (key === 'receiving') return row.channel === 'CASH' && row.category === 'OTHER_RECEIPT';
  if (key === 'newLoan') return row.category === 'NEW_LOAN';
  if (key === 'savings') return row.category === 'SAVINGS_DEPOSIT';
  if (key === 'withdrawal') return row.category === 'WITHDRAWAL';
  if (key === 'byAccount') return row.channel === 'ACCOUNT' && RECEIPT_CATEGORIES.includes(row.category);
  if (key === 'expenses') return row.category === 'EXPENSE';
  if (key === 'renewal') return row.category === 'RENEWAL';
  return row.category === 'OPENING_BALANCE';
}

function isCommitmentColumn(column: SheetColumn): column is CommitmentColumn {
  return 'kind' in column;
}

function cellKey(column: SheetKey, rowIndex: number): string {
  return `${column}:${rowIndex}`;
}

function initialCellDrafts(view: View): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const column of MOVEMENT_COLUMNS) {
    const entries = view.entries.filter((row) => entryBelongs(row, column.key));
    entries.forEach((row, index) => {
      drafts[cellKey(column.key, index)] = sheetMoneyInput(row.amountPaise);
    });
  }
  for (const column of COMMITMENT_COLUMNS) {
    view.currentCommitments
      .filter((item) => item.kind === column.kind)
      .forEach((item, index) => {
        drafts[cellKey(column.key, index)] = sheetMoneyInput(item.amountPaise);
      });
  }
  return drafts;
}

function initialCellIds(view: View): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const column of MOVEMENT_COLUMNS) {
    view.entries.filter((row) => entryBelongs(row, column.key)).forEach((row, index) => {
      ids[cellKey(column.key, index)] = row.id;
    });
  }
  for (const column of COMMITMENT_COLUMNS) {
    view.currentCommitments.filter((item) => item.kind === column.kind).forEach((item, index) => {
      ids[cellKey(column.key, index)] = item.id;
    });
  }
  return ids;
}

function cellPosition(key: string): { column: number; row: number } | null {
  const separator = key.lastIndexOf(':');
  const columnKey = key.slice(0, separator);
  const row = Number(key.slice(separator + 1));
  const column = SHEET_COLUMNS.findIndex((item) => item.key === columnKey);
  return separator > 0 && column >= 0 && Number.isInteger(row) ? { column, row } : null;
}

function ShareMenu({ view, canExport }: { view: View; canExport: boolean }) {
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const query = `branchId=${encodeURIComponent(view.branch.id)}&date=${encodeURIComponent(view.date)}`;
  const imageUrl = `/api/export/cashbook/image?${query}`;
  const printUrl = `/cashbook/print?branch=${encodeURIComponent(view.branch.id)}&date=${encodeURIComponent(view.date)}`;
  const pageUrl = typeof window === 'undefined' ? '' : window.location.href;
  const summary = `${view.branch.code} cashbook · ${formatISODate(view.date)}\nExpected cash: ${formatPaise(BigInt(view.totals.expectedPhysicalCashPaise))}\nCounted cash: ${formatPaise(BigInt(view.totals.countedCashPaise))}\nDifference: ${formatPaise(BigInt(view.totals.cashDifferencePaise))} (${RECON_META[view.totals.state].label})`;

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary);
      toast.success('Summary copied');
      setOpen(false);
    } catch {
      toast.error('Could not copy. Use the image or PDF option instead.');
    }
  }

  async function shareImage() {
    setSharing(true);
    try {
      const response = await fetch(imageUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Could not create the summary image.');
      const blob = await response.blob();
      const file = new File([blob], `${view.branch.code}-cashbook-${view.date}.png`, { type: 'image/png' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ title: `${view.branch.name} daily cashbook`, text: summary, files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        URL.revokeObjectURL(url);
        toast.success('Image downloaded');
      }
      setOpen(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        toast.error(error instanceof Error ? error.message : 'Could not share the image.');
      }
    } finally {
      setSharing(false);
    }
  }

  const encoded = encodeURIComponent(summary);
  return (
    <div className="relative">
      <Button type="button" variant="glass" size="icon" onClick={() => setOpen((value) => !value)} aria-label="Share cashbook" title="Share cashbook">
        <Share2 className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(22rem,calc(100vw-1.5rem))]">
          <div className="glass overflow-hidden border p-2 shadow-2xl" style={{ background: 'var(--surface-solid)' }}>
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-[0.8125rem] font-semibold">Share daily cashbook</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close share menu"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[0.75rem]">
              <button type="button" onClick={shareImage} disabled={sharing} className="rounded-lg p-3 text-left hover:bg-[var(--glass-bg-subtle)]"><FileImage className="mb-1 h-4 w-4" />{sharing ? 'Preparing…' : 'Image'}</button>
              <a href={printUrl} target="_blank" rel="noreferrer" className="rounded-lg p-3 hover:bg-[var(--glass-bg-subtle)]"><Printer className="mb-1 h-4 w-4" />PDF / Print</a>
              {canExport && <a href={`/api/export/cashbook?${query}&format=xlsx`} className="rounded-lg p-3 hover:bg-[var(--glass-bg-subtle)]"><FileSpreadsheet className="mb-1 h-4 w-4" />Excel</a>}
              {canExport && <a href={`/api/export/cashbook?${query}&format=csv`} className="rounded-lg p-3 hover:bg-[var(--glass-bg-subtle)]"><Download className="mb-1 h-4 w-4" />CSV</a>}
              <button type="button" onClick={copySummary} className="rounded-lg p-3 text-left hover:bg-[var(--glass-bg-subtle)]"><Link2 className="mb-1 h-4 w-4" />Copy summary</button>
              <a href={`https://wa.me/?text=${encoded}`} target="_blank" rel="noreferrer" className="rounded-lg p-3 hover:bg-[var(--glass-bg-subtle)]"><MessageCircle className="mb-1 h-4 w-4" />WhatsApp</a>
              <a href={`https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encoded}`} target="_blank" rel="noreferrer" className="rounded-lg p-3 hover:bg-[var(--glass-bg-subtle)]"><Send className="mb-1 h-4 w-4" />Telegram</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CashbookWorkbench({
  view,
  branches,
  canEdit,
  canClose,
  canExport,
}: {
  view: View;
  branches: { id: string; code: string; name: string }[];
  today: string;
  canEdit: boolean;
  canClose: boolean;
  canExport: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [figures, setFigures] = useState<FigureForm>(() => initialFigures(view));
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>(() => initialCellDrafts(view));
  const [cellIds, setCellIds] = useState<Record<string, string>>(() => initialCellIds(view));
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [activeNamedKind, setActiveNamedKind] = useState<CashbookCommitmentKind>('GIVEN_CASH');
  const [namedOpen, setNamedOpen] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [panelOrder, setPanelOrder] = useState<PanelId[]>(DEFAULT_PANEL_ORDER);
  const [panelSpans, setPanelSpans] = useState<Record<PanelId, number>>(DEFAULT_PANEL_SPANS);
  const [draggedPanel, setDraggedPanel] = useState<PanelId | null>(null);
  const [toolbarOrder, setToolbarOrder] = useState<ToolbarId[]>(DEFAULT_TOOLBAR_ORDER);
  const [toolbarWidths, setToolbarWidths] = useState<Record<ToolbarId, number>>(DEFAULT_TOOLBAR_WIDTHS);
  const [draggedToolbar, setDraggedToolbar] = useState<ToolbarId | null>(null);
  const activeCellRef = useRef<string | null>(null);
  /** Grows as the cursor approaches the last rendered row; never shrinks within a session. */
  const [revealedRows, setRevealedRows] = useState(SHEET_ROWS);
  const keyboardMoveRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridDirtyRef = useRef(false);
  const [namedDrafts, setNamedDrafts] = useState<NamedDrafts>({
    GIVEN_CASH: { partyName: '', amount: '' },
    DUE_AMOUNT: { partyName: '', amount: '' },
    PENDING_WITHDRAWAL: { partyName: '', amount: '' },
  });
  const focusStorageKey = `mf-cashbook-focus:${view.branch.id}:${view.date}`;

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  useEffect(() => {
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const savedPanelOrder = JSON.parse(localStorage.getItem('mf-cashbook-panel-order') ?? 'null') as PanelId[] | null;
      const savedPanelSpans = JSON.parse(localStorage.getItem('mf-cashbook-panel-spans') ?? 'null') as Record<PanelId, number> | null;
      const savedToolbarOrder = JSON.parse(localStorage.getItem('mf-cashbook-toolbar-order') ?? 'null') as ToolbarId[] | null;
      const savedToolbarWidths = JSON.parse(localStorage.getItem('mf-cashbook-toolbar-widths') ?? 'null') as Record<ToolbarId, number> | null;
      restoreTimer = setTimeout(() => {
        if (savedPanelOrder?.length === DEFAULT_PANEL_ORDER.length && DEFAULT_PANEL_ORDER.every((id) => savedPanelOrder.includes(id))) setPanelOrder(savedPanelOrder);
        if (savedPanelSpans && DEFAULT_PANEL_ORDER.every((id) => Number.isInteger(savedPanelSpans[id]))) setPanelSpans(savedPanelSpans);
        if (savedToolbarOrder?.length === DEFAULT_TOOLBAR_ORDER.length && DEFAULT_TOOLBAR_ORDER.every((id) => savedToolbarOrder.includes(id))) setToolbarOrder(savedToolbarOrder);
        if (savedToolbarWidths && DEFAULT_TOOLBAR_ORDER.every((id) => Number.isFinite(savedToolbarWidths[id]))) setToolbarWidths(savedToolbarWidths);
      }, 0);
    } catch {
      // A damaged preference should never prevent the cashbook from opening.
    }
    return () => {
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, []);

  useLayoutEffect(() => {
    const key = activeCellRef.current ?? sessionStorage.getItem(focusStorageKey);
    if (!key) return;
    activeCellRef.current = key;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-cash-cell="${key}"]`);
      if (target && document.activeElement !== target) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusStorageKey, view.currentCommitments, view.entries]);

  const status = view.day?.status ?? 'OPEN';
  const locked = status !== 'OPEN';
  const canMutate = canEdit && !locked;
  const version = view.day?.version ?? 0;
  const statusMeta = STATUS_META[status];

  // One parse of the form, shared by the reconciliation and the note-mix panel, so the
  // bars can never disagree with the totals printed beside them.
  const liveFigures = useMemo<CashbookDayFigures>(() => ({
    oldPortalTotalPaise: liveMoney(figures.oldPortalTotal),
    fixedDepositPaise: liveMoney(figures.fixedDeposit),
    newBusinessPaise: liveMoney(figures.newBusiness),
    membershipCollectionPaise: liveMoney(figures.membershipCollection),
    oldLoanPaise: liveMoney(figures.oldLoan),
    note500Count: nonNegativeCount(figures.note500Count),
    note200Count: nonNegativeCount(figures.note200Count),
    note100Count: nonNegativeCount(figures.note100Count),
    note50Count: nonNegativeCount(figures.note50Count),
    note20Count: nonNegativeCount(figures.note20Count),
    note10Count: nonNegativeCount(figures.note10Count),
    coinsPaise: liveMoney(figures.coins),
  }), [figures]);

  const columnEntries = useMemo(
    () => Object.fromEntries(
      MOVEMENT_COLUMNS.map((column) => [column.key, view.entries.filter((row) => entryBelongs(row, column.key))]),
    ) as Record<MovementKey, EntryRow[]>,
    [view.entries],
  );

  const columnCommitments = useMemo(
    () => Object.fromEntries(
      COMMITMENT_COLUMNS.map((column) => [column.key, view.currentCommitments.filter((item) => item.kind === column.kind)]),
    ) as Record<CommitmentColumn['key'], View['currentCommitments']>,
    [view.currentCommitments],
  );

  const liveEntries = useMemo(() => MOVEMENT_COLUMNS.flatMap((column) => {
    const entries = columnEntries[column.key];
    return Array.from({ length: Math.max(SHEET_ROWS, entries.length + 1) }, (_, rowIndex) => {
      const row = entries[rowIndex];
      const amountPaise = tryParseRupeesToPaise((cellDrafts[cellKey(column.key, rowIndex)] ?? '').trim());
      if (amountPaise === null || amountPaise <= 0n) return null;
      return {
        category: row?.category ?? column.category,
        channel: row?.channel ?? column.channel,
        amountPaise,
      };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }), [cellDrafts, columnEntries]);

  const totals = useMemo(
    () => calculateDailyCashbook(
      liveEntries,
      liveFigures,
      view.currentCommitments.map((item) => ({ kind: item.kind, amountPaise: BigInt(item.amountPaise) })),
    ),
    [liveEntries, liveFigures, view.currentCommitments],
  );

  const visibleRows = Math.min(
    MAX_SHEET_ROWS,
    Math.max(
      SHEET_ROWS,
      revealedRows,
      ...MOVEMENT_COLUMNS.map((column) => columnEntries[column.key].length + 1),
      ...COMMITMENT_COLUMNS.map((column) => columnCommitments[column.key].length + 1),
    ),
  );
  const namedItems = view.outstandingCommitments.filter((item) => item.kind === activeNamedKind);

  const selectedCells = useMemo(() => {
    if (!selection) return new Set<string>();
    const anchor = cellPosition(selection.anchor);
    const focus = cellPosition(selection.focus);
    if (!anchor || !focus) return new Set<string>();
    const keys = new Set<string>();
    for (let column = Math.min(anchor.column, focus.column); column <= Math.max(anchor.column, focus.column); column += 1) {
      for (let row = Math.min(anchor.row, focus.row); row <= Math.max(anchor.row, focus.row); row += 1) {
        keys.add(cellKey(SHEET_COLUMNS[column].key, row));
      }
    }
    return keys;
  }, [selection]);

  const selectionStats = useMemo(() => {
    let count = 0;
    let sum = 0n;
    for (const key of selectedCells) {
      const value = (cellDrafts[key] ?? '').trim();
      if (!value) continue;
      const parsed = tryParseRupeesToPaise(value);
      if (parsed === null) continue;
      count += 1;
      sum += parsed;
    }
    return { count, sum, average: count ? sum / BigInt(count) : 0n };
  }, [cellDrafts, selectedCells]);

  function navigate(date: string, branchId = view.branch.id) {
    router.push(`/cashbook?branch=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`);
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error ?? 'Could not save that change.');
      else {
        toast.success(success);
        router.refresh();
      }
    });
  }

  function scheduleGridRefresh() {
    gridDirtyRef.current = true;
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      const active = document.activeElement as HTMLElement | null;
      // Never replace the focused spreadsheet DOM while the clerk is still typing.
      // Live totals already use the draft values; the server snapshot can wait until focus leaves.
      if (active?.dataset.cashCell) return;
      gridDirtyRef.current = false;
      router.refresh();
    }, 800);
  }

  async function saveCell(column: MovementColumn, rowIndex: number): Promise<void> {
    if (!canMutate) return;
    const key = cellKey(column.key, rowIndex);
    const value = (cellDrafts[key] ?? '').trim();
    const rowId = cellIds[key];
    const row = view.entries.find((entry) => entry.id === rowId) ?? columnEntries[column.key][rowIndex];
    if (!value && !row) return;
    if (!value && row) {
      setSavingCell(key);
      const result = await voidCashbookEntryAction(row.id, 'Cleared from cashbook sheet', true);
      setSavingCell(null);
      if (!result.ok) {
        setCellDrafts((old) => ({ ...old, [key]: sheetMoneyInput(row.amountPaise) }));
        toast.error(result.error ?? 'Could not clear the cell.');
      } else {
        setCellIds((old) => {
          const next = { ...old };
          delete next[key];
          return next;
        });
        scheduleGridRefresh();
      }
      return;
    }
    if (row && value === sheetMoneyInput(row.amountPaise)) return;
    const parsed = tryParseRupeesToPaise(value);
    if (parsed === null || parsed % 100n !== 0n) {
      toast.error('Enter a whole-rupee amount without decimals.');
      return;
    }

    setSavingCell(key);
    let createdId: string | undefined;
    const result = row
      ? await updateCashbookEntryAction({
          id: row.id,
          category: row.category,
          channel: row.channel,
          amount: value,
          partyName: row.partyName ?? '',
          reference: row.reference ?? '',
          note: row.note ?? '',
          deferPageRefresh: true,
        })
      : await addCashbookEntryAction({
          branchId: view.branch.id,
          date: view.date,
          category: column.category,
          channel: column.channel,
          amount: value,
          partyName: '',
          reference: '',
          note: '',
          deferPageRefresh: true,
        }).then((created) => {
          if (created.ok) createdId = created.data.id;
          return created;
        });
    setSavingCell(null);
    if (!result.ok) toast.error(result.error ?? 'Could not save the cell.');
    else {
      if (createdId) setCellIds((old) => ({ ...old, [key]: createdId! }));
      scheduleGridRefresh();
    }
  }

  async function saveCommitmentCell(column: CommitmentColumn, rowIndex: number): Promise<void> {
    if (!canMutate) return;
    const key = cellKey(column.key, rowIndex);
    const value = (cellDrafts[key] ?? '').trim();
    const itemId = cellIds[key];
    const item = view.currentCommitments.find((entry) => entry.id === itemId) ?? columnCommitments[column.key][rowIndex];
    if (!value && !item) return;
    if (!value && item) {
      setSavingCell(key);
      const result = await voidCashbookCommitmentAction(item.id, 'Cleared from cashbook sheet', true);
      setSavingCell(null);
      if (!result.ok) {
        setCellDrafts((old) => ({ ...old, [key]: sheetMoneyInput(item.amountPaise) }));
        toast.error(result.error ?? 'Could not clear the cell.');
      } else {
        setCellIds((old) => {
          const next = { ...old };
          delete next[key];
          return next;
        });
        scheduleGridRefresh();
      }
      return;
    }
    if (item) {
      if (value !== sheetMoneyInput(item.amountPaise)) {
        setCellDrafts((old) => ({ ...old, [key]: sheetMoneyInput(item.amountPaise) }));
        toast.error('Clear this named item, then enter the corrected amount on a new row.');
      }
      return;
    }
    const parsed = tryParseRupeesToPaise(value);
    if (parsed === null || parsed % 100n !== 0n) {
      toast.error('Enter a whole-rupee amount without decimals.');
      return;
    }
    const partyName = window.prompt(`Person or customer name for ${CASHBOOK_COMMITMENT_META[column.kind].label}:`);
    if (!partyName?.trim()) {
      setCellDrafts((old) => ({ ...old, [key]: '' }));
      toast.error('A person or customer name is required.');
      return;
    }
    setSavingCell(key);
    const result = await addCashbookCommitmentAction({
      branchId: view.branch.id,
      date: view.date,
      kind: column.kind,
      partyName,
      amount: value,
      dueOn: '',
      reference: '',
      note: '',
      deferPageRefresh: true,
    });
    setSavingCell(null);
    if (!result.ok) {
      toast.error(result.error ?? 'Could not save the named item.');
    } else {
      if (result.data?.id) setCellIds((old) => ({ ...old, [key]: result.data.id }));
      scheduleGridRefresh();
    }
  }

  function moveCell(columnIndex: number, rowIndex: number, key: string, extendSelection = false) {
    let nextColumn = columnIndex;
    let nextRow = rowIndex;
    if (key === 'ArrowUp') nextRow = Math.max(0, rowIndex - 1);
    if (key === 'ArrowDown' || key === 'Enter') nextRow = Math.min(MAX_SHEET_ROWS - 1, rowIndex + 1);
    if (key === 'ArrowLeft') nextColumn = Math.max(0, columnIndex - 1);
    if (key === 'ArrowRight') nextColumn = Math.min(SHEET_COLUMNS.length - 1, columnIndex + 1);
    const targetKey = `${SHEET_COLUMNS[nextColumn].key}:${nextRow}`;
    setSelection((current) => extendSelection
      ? { anchor: current?.anchor ?? cellKey(SHEET_COLUMNS[columnIndex].key, rowIndex), focus: targetKey }
      : { anchor: targetKey, focus: targetKey });
    activeCellRef.current = targetKey;
    keyboardMoveRef.current = true;
    sessionStorage.setItem(focusStorageKey, targetKey);
    // Reveal the row before reaching for it: a cell that has not rendered cannot take focus.
    setRevealedRows((current) => Math.min(
      MAX_SHEET_ROWS,
      Math.max(current, nextRow + 1 + ROW_REVEAL_BUFFER),
    ));
    const focusTarget = () => {
      const target = document.querySelector<HTMLElement>(`[data-cash-cell="${targetKey}"]`);
      // Focus without the browser's own scroll, then bring the cell into view ourselves.
      // `block: 'nearest'` is what makes it feel like a spreadsheet: the sheet only moves when
      // the cursor would otherwise leave it, and it moves by exactly one row or column.
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return Boolean(target);
    };
    // Move synchronously. Leaving a one-frame gap after blurring lets the browser
    // hand focus to <body>, where a fast second arrow press scrolls the page.
    if (!focusTarget()) requestAnimationFrame(focusTarget);
    queueMicrotask(() => { keyboardMoveRef.current = false; });
  }

  function rememberCellFocus(key: string) {
    activeCellRef.current = key;
    sessionStorage.setItem(focusStorageKey, key);
    if (!keyboardMoveRef.current) setSelection({ anchor: key, focus: key });
  }

  function clearGridFocus() {
    activeCellRef.current = null;
    setSelection(null);
    sessionStorage.removeItem(focusStorageKey);
    if (gridDirtyRef.current) {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        gridDirtyRef.current = false;
        router.refresh();
      }, 100);
    }
  }

  function handleCellBlur(nextTarget: EventTarget | null) {
    if (keyboardMoveRef.current) return;
    if (nextTarget instanceof HTMLElement && nextTarget.dataset.cashCell) return;
    // A server refresh removes the focused DOM node with no relatedTarget. Preserve
    // the cell in that case; an intentional click outside the grid clears it at root.
    if (nextTarget instanceof HTMLElement) clearGridFocus();
  }

  function handleCellKeyDown(
    event: KeyboardEvent<HTMLElement>,
    columnIndex: number,
    rowIndex: number,
  ) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    moveCell(columnIndex, rowIndex, event.key, event.shiftKey && event.key !== 'Enter');
  }

  function saveFigures(event: FormEvent) {
    event.preventDefault();
    const rupeeFields = [figures.oldPortalTotal, figures.fixedDeposit, figures.newBusiness, figures.membershipCollection, figures.oldLoan, figures.coins];
    if (rupeeFields.some((value) => {
      const parsed = tryParseRupeesToPaise(value);
      return parsed === null || parsed % 100n !== 0n;
    })) return toast.error('Cash-control values must be whole rupees without decimals.');
    run(
      () => saveCashbookDayAction({ branchId: view.branch.id, date: view.date, expectedVersion: version, ...figures }),
      'Cash count and report figures saved',
    );
  }

  function quickAddNamed(kind: CashbookCommitmentKind) {
    const draft = namedDrafts[kind];
    if (!draft.partyName.trim() || !draft.amount.trim()) return toast.error('Enter a person and amount.');
    const parsed = tryParseRupeesToPaise(draft.amount);
    if (parsed === null || parsed % 100n !== 0n) return toast.error('Enter a whole-rupee amount without decimals.');
    startTransition(async () => {
      const result = await addCashbookCommitmentAction({
        branchId: view.branch.id,
        date: view.date,
        kind,
        partyName: draft.partyName,
        amount: draft.amount,
        dueOn: '',
        reference: '',
        note: '',
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not add the named item.');
        return;
      }
      setNamedDrafts((old) => ({ ...old, [kind]: { partyName: '', amount: '' } }));
      router.refresh();
    });
  }

  function movePanel(target: PanelId) {
    if (!draggedPanel || draggedPanel === target) return;
    setPanelOrder((current) => {
      const next = current.filter((id) => id !== draggedPanel);
      next.splice(next.indexOf(target), 0, draggedPanel);
      localStorage.setItem('mf-cashbook-panel-order', JSON.stringify(next));
      return next;
    });
    setDraggedPanel(null);
  }

  function panelDragHandle(id: PanelId, label: string) {
    if (!arranging) return null;
    return (
      <button
        type="button"
        draggable
        data-panel-drag-handle={id}
        onDragStart={(event: DragEvent<HTMLButtonElement>) => {
          setDraggedPanel(id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDraggedPanel(null)}
        className="cursor-grab rounded-md p-1 text-[var(--faint-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)] active:cursor-grabbing"
        aria-label={`Move ${label}`}
        title={`Drag to move ${label}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    );
  }

  function panelResizeHandle(id: PanelId, label: string) {
    if (!arranging) return null;
    return (
      <button
        type="button"
        onPointerDown={(event) => startPanelResize(id, event)}
        className="absolute right-0 top-1/2 z-30 h-16 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-[var(--color-brand-500)]/50 opacity-70 hover:opacity-100"
        aria-label={`Resize ${label}`}
        title={`Drag to resize ${label}`}
      />
    );
  }

  function startPanelResize(id: PanelId, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const grid = event.currentTarget.closest<HTMLElement>('[data-cashbook-grid]');
    if (!grid) return;
    const startX = event.clientX;
    const startSpan = panelSpans[id];
    const columnWidth = grid.getBoundingClientRect().width / CASHBOOK_GRID_COLUMNS;
    const minimum = id === 'ledger' ? 8 : id === 'cashControl' ? 2 : 3;
    let finalSpan = startSpan;
    const onMove = (moveEvent: PointerEvent) => {
      finalSpan = Math.max(minimum, Math.min(CASHBOOK_GRID_COLUMNS, startSpan + Math.round((moveEvent.clientX - startX) / columnWidth)));
      setPanelSpans((current) => ({ ...current, [id]: finalSpan }));
    };
    const onUp = () => {
      const next = { ...panelSpans, [id]: finalSpan };
      localStorage.setItem('mf-cashbook-panel-spans', JSON.stringify(next));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function moveToolbar(target: ToolbarId) {
    if (!draggedToolbar || draggedToolbar === target) return;
    setToolbarOrder((current) => {
      const next = current.filter((id) => id !== draggedToolbar);
      next.splice(next.indexOf(target), 0, draggedToolbar);
      localStorage.setItem('mf-cashbook-toolbar-order', JSON.stringify(next));
      return next;
    });
    setDraggedToolbar(null);
  }

  function startToolbarResize(id: ToolbarId, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = toolbarWidths[id];
    let finalWidth = startWidth;
    const onMove = (moveEvent: PointerEvent) => {
      finalWidth = Math.max(TOOLBAR_MIN_WIDTHS[id], Math.min(320, startWidth + moveEvent.clientX - startX));
      setToolbarWidths((current) => ({ ...current, [id]: finalWidth }));
    };
    const onUp = () => {
      const next = { ...toolbarWidths, [id]: finalWidth };
      localStorage.setItem('mf-cashbook-toolbar-widths', JSON.stringify(next));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function toolbarItem(id: ToolbarId, label: string, content: React.ReactNode) {
    const displayWidth = arranging && id === 'utilities' ? Math.max(112, toolbarWidths[id]) : toolbarWidths[id];
    return (
      <div
        key={id}
        data-cashbook-toolbar-item={id}
        className={cn('relative shrink-0', arranging && 'rounded-[10px] ring-1 ring-[var(--color-brand-400)]/50')}
        style={{ order: toolbarOrder.indexOf(id), width: displayWidth }}
        onDragOver={(event) => arranging && event.preventDefault()}
        onDrop={() => moveToolbar(id)}
      >
        {arranging && <button type="button" draggable onDragStart={(event: DragEvent<HTMLButtonElement>) => { setDraggedToolbar(id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDraggedToolbar(null)} className="absolute -left-1.5 top-1/2 z-40 -translate-y-1/2 cursor-grab rounded-full border bg-[var(--surface-solid)] p-0.5 text-[var(--color-brand-600)] shadow" aria-label={`Move ${label}`} title={`Drag to move ${label}`}><GripVertical className="h-3 w-3" /></button>}
        {content}
        {arranging && <button type="button" onPointerDown={(event) => startToolbarResize(id, event)} className="absolute right-0 top-1/2 z-50 h-7 w-2 -translate-y-1/2 cursor-ew-resize rounded-full bg-[var(--color-brand-500)]/70" aria-label={`Resize ${label}`} title={`Drag to resize ${label}`} />}
      </div>
    );
  }

  function requestClose() {
    const needsReason = totals.state === 'SHORT' || totals.state === 'EXCESS';
    const reason = needsReason
      ? window.prompt(`Explain the ${RECON_META[totals.state].label.toLowerCase()} difference of ${formatPaise(totals.cashDifferencePaise)}:`)
      : window.prompt('Optional close note:', '') ?? '';
    if (needsReason && !reason?.trim()) return toast.error('A discrepancy reason is required.');
    run(() => requestCashbookCloseAction(view.branch.id, view.date, reason ?? undefined), 'Close sent for approval');
  }

  function reviewClose(approve: boolean) {
    const note = window.prompt(approve ? 'Optional approval note:' : 'Why is the close being returned?');
    if (!approve && !note?.trim()) return toast.error('A return reason is required.');
    run(
      () => confirmCashbookCloseAction(view.branch.id, view.date, approve, note ?? undefined),
      approve ? 'Cashbook closed' : 'Cashbook returned',
    );
  }

  function reopen() {
    const reason = window.prompt('Why must this cashbook be reopened?');
    if (!reason?.trim()) return toast.error('A reopen reason is required.');
    run(() => reopenCashbookDayAction(view.branch.id, view.date, reason), 'Cashbook reopened');
  }

  const recon = RECON_META[totals.state];
  const differenceStyle = totals.state === 'BALANCED'
    ? 'border-[var(--row-taken-edge)] bg-[var(--row-taken)] text-[var(--row-taken-fg)]'
    : totals.state === 'SHORT'
      ? 'border-[var(--row-missed-edge)] bg-[var(--row-missed)] text-[var(--row-missed-fg)]'
      : totals.state === 'EXCESS'
        ? 'border-[var(--row-partial-edge)] bg-[var(--row-partial)] text-[var(--row-partial-fg)]'
        : 'border-[var(--input-border)] bg-[var(--glass-bg-subtle)] text-[var(--muted-fg)]';

  const summaryRows: {
    label: string;
    value: bigint;
    tone: 'add' | 'subtract' | 'report';
    strong?: boolean;
    field?: 'oldPortalTotal' | 'fixedDeposit' | 'newBusiness' | 'membershipCollection' | 'oldLoan';
  }[] = [
    { label: 'Opening Balance', value: totals.openingBalancePaise, tone: 'add' },
    { label: 'Old Portal Total', value: liveMoney(figures.oldPortalTotal), tone: 'add', field: 'oldPortalTotal' },
    { label: 'New Loan', value: totals.byCategory.NEW_LOAN, tone: 'add' },
    { label: 'Savings Deposit', value: totals.byCategory.SAVINGS_DEPOSIT, tone: 'add' },
    { label: 'Total Amount', value: totals.totalAmountPaise, tone: 'add', strong: true },
    { label: 'By Account', value: totals.byAccountPaise, tone: 'subtract' },
    { label: 'Withdrawals', value: totals.byCategory.WITHDRAWAL, tone: 'subtract' },
    { label: 'Expenses', value: totals.byCategory.EXPENSE, tone: 'subtract' },
    { label: 'Physical Cash', value: totals.expectedPhysicalCashPaise, tone: 'add', strong: true },
    { label: 'Renewal', value: totals.byCategory.RENEWAL, tone: 'report' },
    { label: 'Receiving', value: totals.receivingPaise, tone: 'report' },
    { label: 'Fixed Deposit', value: liveMoney(figures.fixedDeposit), tone: 'report', field: 'fixedDeposit' },
    { label: 'New Business', value: liveMoney(figures.newBusiness), tone: 'report', field: 'newBusiness' },
    { label: 'Membership Collection', value: liveMoney(figures.membershipCollection), tone: 'report', field: 'membershipCollection' },
    { label: 'Old Loan', value: liveMoney(figures.oldLoan), tone: 'report', field: 'oldLoan' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-3 pb-6" onPointerDownCapture={(event) => { if (event.target instanceof Element && !event.target.closest('[data-cash-cell]')) clearGridFocus(); }}>
      <h1 className="sr-only">Daily cashbook — {view.branch.name}</h1>
      <Glass className="overflow-visible" style={{ zIndex: 20 }}>
        <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
          {toolbarItem('date', 'date', <div className="flex h-9 w-full items-center gap-0.5 rounded-[9px] border bg-[var(--input-bg)] px-0.5"><Button type="button" size="icon" variant="ghost" className="h-8 w-6" onClick={() => navigate(addDays(view.date, -1))} aria-label="Previous day"><ArrowLeft className="h-3.5 w-3.5" /></Button><Input type="date" value={view.date} onChange={(event) => navigate(event.target.value)} aria-label="Cashbook date" className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0.5 py-0 text-[0.8rem] font-semibold" /><Button type="button" size="icon" variant="ghost" className="h-8 w-6" onClick={() => navigate(addDays(view.date, 1))} aria-label="Next day"><ArrowRight className="h-3.5 w-3.5" /></Button></div>)}
          {toolbarItem('branch', 'branch', <Select value={view.branch.id} onChange={(event) => navigate(view.date, event.target.value)} aria-label="Branch" className="h-9 w-full min-w-0 py-0 text-[0.8rem] font-semibold">{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>)}</Select>)}
          {toolbarItem('expected', 'expected cash', <div className="flex h-9 w-full flex-col justify-center rounded-[9px] border bg-[var(--input-bg)] px-2"><p className="text-[0.68rem] font-semibold leading-none text-[var(--muted-fg)]">Expected Cash</p><Money paise={totals.expectedPhysicalCashPaise} decimals={false} className="mt-1 text-[0.82rem] font-extrabold leading-none" /></div>)}
          {toolbarItem('counted', 'cash in hand', <div className="flex h-9 w-full flex-col justify-center rounded-[9px] border bg-[var(--input-bg)] px-2"><p className="text-[0.68rem] font-semibold leading-none text-[var(--muted-fg)]">Cash In Hand</p><Money paise={totals.countedCashPaise} decimals={false} className="mt-1 text-[0.82rem] font-extrabold leading-none" /></div>)}
          {toolbarItem('difference', 'cash difference', <div className={cn('flex h-9 w-full items-center justify-between gap-1 rounded-[9px] border px-2', differenceStyle)} title={recon.detail}><div className="min-w-0"><p className="truncate text-[0.68rem] font-bold leading-none">Cash Difference</p><p className="mt-1 truncate text-[0.62rem] font-semibold leading-none opacity-80">{recon.label}</p></div><Money paise={totals.cashDifferencePaise} decimals={false} className="shrink-0 text-[0.84rem] font-extrabold" /></div>)}
          {([['borrowed', 'GIVEN_CASH'], ['due', 'DUE_AMOUNT'], ['pending', 'PENDING_WITHDRAWAL']] as const).map(([id, kind]) => toolbarItem(id, COMMITMENT_UI_META[kind].label, <button type="button" onClick={() => { setActiveNamedKind(kind); setNamedOpen((value) => kind === activeNamedKind ? !value : true); }} className={cn('flex h-9 w-full flex-col justify-center rounded-[9px] border bg-[var(--input-bg)] px-2 text-left hover:bg-[var(--glass-bg-strong)]', namedOpen && activeNamedKind === kind && 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]')} title={`Manage ${COMMITMENT_UI_META[kind].label}`}><span className="truncate text-[0.68rem] font-semibold leading-none">{COMMITMENT_UI_META[kind].shortLabel}</span><Money paise={view.commitmentTotals[kind].outstandingPaise} compact decimals={false} className="mt-1 block text-[0.82rem] font-extrabold leading-none" /></button>))}
          {toolbarItem('status', 'status', <div className="flex h-9 w-full items-center justify-center rounded-[9px] border bg-[var(--input-bg)]"><Badge tone={statusMeta.tone}>{status === 'CLOSED' ? <LockKeyhole className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}{statusMeta.label}</Badge></div>)}
          {toolbarItem('close', 'close controls', <div className="flex h-9 w-full items-center">{status === 'OPEN' && canEdit && <Button type="button" className="h-9 w-full" variant={totals.state === 'BALANCED' ? 'success' : 'primary'} size="sm" loading={pending} onClick={requestClose}><ClipboardCheck className="h-3.5 w-3.5" />Close</Button>}{status === 'CLOSE_REQUESTED' && canClose && <><Button type="button" variant="outline" size="icon" loading={pending} onClick={() => reviewClose(false)} aria-label="Return cashbook"><RotateCcw className="h-3.5 w-3.5" /></Button><Button type="button" variant="success" size="sm" loading={pending} onClick={() => reviewClose(true)}>Confirm</Button></>}{status === 'CLOSED' && canClose && <Button type="button" className="h-9 w-full" variant="outline" size="sm" loading={pending} onClick={reopen}><RotateCcw className="h-3.5 w-3.5" />Reopen</Button>}</div>)}
          {toolbarItem('utilities', 'layout and share controls', <div className="flex h-9 w-full items-center justify-end gap-0.5"><Button type="button" variant={arranging ? 'primary' : 'ghost'} size="icon" className="h-9 w-9" onClick={() => setArranging((value) => !value)} aria-label="Arrange layout" title="Move and resize layout"><LayoutGrid className="h-4 w-4" /></Button>{arranging && <Button type="button" variant="ghost" size="icon" className="h-9 w-9" onClick={() => { setPanelOrder(DEFAULT_PANEL_ORDER); setPanelSpans(DEFAULT_PANEL_SPANS); setToolbarOrder(DEFAULT_TOOLBAR_ORDER); setToolbarWidths(DEFAULT_TOOLBAR_WIDTHS); localStorage.removeItem('mf-cashbook-panel-order'); localStorage.removeItem('mf-cashbook-panel-spans'); localStorage.removeItem('mf-cashbook-toolbar-order'); localStorage.removeItem('mf-cashbook-toolbar-widths'); }} aria-label="Reset layout" title="Reset layout"><RotateCcw className="h-4 w-4" /></Button>}<ShareMenu view={view} canExport={canExport} /></div>)}

          {namedOpen && <div className="absolute right-2 top-[calc(100%+0.5rem)] z-50 w-[min(22rem,calc(100vw-1.5rem))]"><div className="glass border p-3 shadow-2xl" style={{ background: 'var(--surface-solid)' }}><div className="mb-2 flex items-center justify-between"><div><p className="text-[0.84rem] font-semibold">{COMMITMENT_UI_META[activeNamedKind].label}</p><p className="text-[0.68rem] text-[var(--faint-fg)]">Named report item · does not change expected cash</p></div><button type="button" onClick={() => setNamedOpen(false)} aria-label="Close named items"><X className="h-4 w-4" /></button></div><div className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-1.5"><Input placeholder="Person name" value={namedDrafts[activeNamedKind].partyName} disabled={!canMutate || pending} onChange={(event) => setNamedDrafts((old) => ({ ...old, [activeNamedKind]: { ...old[activeNamedKind], partyName: event.target.value } }))} className="h-9 py-1 text-[0.76rem]" /><Input inputMode="numeric" placeholder="Amount" value={namedDrafts[activeNamedKind].amount} disabled={!canMutate || pending} onChange={(event) => setNamedDrafts((old) => ({ ...old, [activeNamedKind]: { ...old[activeNamedKind], amount: event.target.value } }))} className="h-9 py-1 text-right text-[0.76rem]" /><Button type="button" size="sm" variant="primary" loading={pending} disabled={!canMutate} onClick={() => quickAddNamed(activeNamedKind)}>Add</Button></div><div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">{namedItems.length === 0 ? <p className="rounded-[9px] bg-[var(--glass-bg-subtle)] px-3 py-3 text-center text-[0.72rem] text-[var(--faint-fg)]">Nothing outstanding.</p> : namedItems.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-[9px] border bg-[var(--glass-bg-subtle)] px-2.5 py-2"><div className="min-w-0 flex-1"><p className="truncate text-[0.74rem] font-semibold">{item.partyName}</p><p className="truncate text-[0.64rem] text-[var(--faint-fg)]">{item.carried ? `Carried from ${formatISODate(item.sourceDate)}` : 'Added today'}</p></div><Money paise={item.amountPaise} decimals={false} className="shrink-0 text-[0.76rem] font-bold" />{canEdit && <button type="button" onClick={() => run(() => setCashbookCommitmentSettledAction(item.id, true), 'Item settled')} className="rounded-md bg-[var(--color-money-600)] p-1.5 text-white" aria-label="Settle item"><Check className="h-3.5 w-3.5" /></button>}{!item.carried && canMutate && <button type="button" onClick={() => run(() => voidCashbookCommitmentAction(item.id, 'Removed from named items menu'), 'Item removed')} className="rounded-md p-1.5 text-[var(--color-danger-600)]" aria-label="Remove item"><Trash2 className="h-3.5 w-3.5" /></button>}</div>)}</div></div></div>}
        </div>
      </Glass>

      <div data-cashbook-grid className="grid min-w-0 grid-flow-row-dense items-stretch gap-3 xl:grid-cols-[repeat(16,minmax(0,1fr))]">
        <section
          data-cashbook-panel="ledger"
          className={cn('cashbook-panel relative min-w-0 xl:row-span-2', draggedPanel === 'ledger' && 'opacity-60')}
          style={{ order: panelOrder.indexOf('ledger'), '--cashbook-span': panelSpans.ledger } as CSSProperties}
          onDragOver={(event) => arranging && event.preventDefault()}
          onDrop={() => movePanel('ledger')}
        >
        <Glass className="flex h-full min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center border-b px-4 py-3">
            <div className="flex items-start gap-1.5">
              {panelDragHandle('ledger', 'movements sheet')}
              <div>
              <h2 className="text-[0.95rem] font-semibold tracking-[-0.01em]">Today’s movements</h2>
              <p className="text-[0.72rem] text-[var(--muted-fg)]">Enter saves and moves down · arrows move between cells · Backspace or Delete clears a cell.</p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid min-h-full min-w-[935px] grid-cols-11 bg-[var(--surface-solid)] text-[var(--page-fg)] xl:min-w-0">
              {SHEET_COLUMNS.map((column, columnIndex) => {
                const commitmentColumn = isCommitmentColumn(column);
                const entries = commitmentColumn ? columnCommitments[column.key] : columnEntries[column.key];
                return (
                  <section key={column.key} className="flex min-h-full min-w-0 flex-col overflow-hidden border-r border-[var(--input-border)] last:border-r-0">
                    <div className="sticky top-0 z-10 flex h-12 min-w-0 shrink-0 items-center justify-center overflow-hidden border-b border-[var(--input-border)] px-1 text-center text-[0.67rem] font-bold leading-[1.08] tracking-[0.005em] text-[var(--page-fg)]" style={{ background: column.head, boxShadow: `inset 0 3px 0 ${column.accent}` }}>
                      <span className="min-w-0 break-words">{column.label}</span>
                    </div>
                    {Array.from({ length: visibleRows }, (_, rowIndex) => {
                      const row = entries[rowIndex];
                      const key = cellKey(column.key, rowIndex);
                      const commitment = commitmentColumn ? row as View['currentCommitments'][number] | undefined : undefined;
                      return (
                        <input
                          key={key}
                          data-cash-cell={key}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          aria-label={`${column.label} row ${rowIndex + 1}${commitment ? `, ${commitment.partyName}` : ''}`}
                          title={commitment ? `${commitment.partyName} · ${formatPaise(BigInt(commitment.amountPaise))}` : undefined}
                          value={cellDrafts[key] ?? ''}
                          disabled={!canMutate || savingCell === key}
                          onFocus={(event) => { rememberCellFocus(key); event.currentTarget.select(); }}
                          onChange={(event) => setCellDrafts((old) => ({ ...old, [key]: event.target.value }))}
                          onBlur={(event) => { handleCellBlur(event.relatedTarget); void (commitmentColumn ? saveCommitmentCell(column, rowIndex) : saveCell(column, rowIndex)); }}
                          onKeyDown={(event) => handleCellKeyDown(event, columnIndex, rowIndex)}
                          className={cn(
                            'min-h-8 w-full flex-1 border-0 border-b border-[var(--input-border)] bg-[var(--surface-solid)] px-2 text-right text-[0.78rem] font-semibold tabular-nums text-[var(--page-fg)] outline-none transition-colors',
                            'focus:relative focus:z-10 focus:bg-[var(--color-brand-50)] focus:text-[var(--color-brand-700)] focus:ring-2 focus:ring-inset focus:ring-[var(--color-brand-500)]',
                            selectedCells.has(key) && 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)] ring-1 ring-inset ring-[var(--color-brand-400)]',
                            savingCell === key && 'bg-[var(--color-brand-50)]',
                          )}
                        />
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>
          <div className="flex h-7 shrink-0 items-center justify-end gap-3 border-t bg-[var(--surface-solid)] px-3 text-[0.68rem] font-semibold tabular-nums text-[var(--muted-fg)]" data-cashbook-selection-summary>
            {selectedCells.size > 1 ? (
              <>
                <span>{selectedCells.size} cells selected</span>
                <span>Count <strong className="text-[var(--page-fg)]">{selectionStats.count}</strong></span>
                <span>Sum <strong className="text-[var(--page-fg)]">{formatPaise(selectionStats.sum, { decimals: false })}</strong></span>
                <span>Average <strong className="text-[var(--page-fg)]">{formatPaise(selectionStats.average, { decimals: false })}</strong></span>
              </>
            ) : <span className="font-medium text-[var(--faint-fg)]">Shift + Arrow keys selects a range</span>}
          </div>
        </Glass>
        {panelResizeHandle('ledger', 'movements sheet')}
        </section>

        <section
          data-cashbook-panel="cashFlow"
          className={cn('cashbook-panel relative min-w-0 self-start', draggedPanel === 'cashFlow' && 'opacity-60')}
          style={{ order: panelOrder.indexOf('cashFlow'), '--cashbook-span': panelSpans.cashFlow } as CSSProperties}
          onDragOver={(event) => arranging && event.preventDefault()}
          onDrop={() => movePanel('cashFlow')}
        >
          <GlassCard
            title={<span className="flex items-center gap-1.5">{panelDragHandle('cashFlow', 'note mix')}<Layers className="h-4 w-4 text-[var(--color-brand-500)]" />Note mix</span>}
            action={<Badge tone="money"><span className="h-1.5 w-1.5 rounded-full bg-current" />Live</Badge>}
            bodyClassName="h-[19rem] p-0 sm:p-0"
          >
            <CashbookNoteMix figures={liveFigures} countedCashPaise={totals.countedCashPaise} />
          </GlassCard>
          {panelResizeHandle('cashFlow', 'note mix')}
        </section>

        <section
          data-cashbook-panel="cashControl"
          className={cn('cashbook-panel relative min-w-0', draggedPanel === 'cashControl' && 'opacity-60')}
          style={{ order: panelOrder.indexOf('cashControl'), '--cashbook-span': panelSpans.cashControl } as CSSProperties}
          onDragOver={(event) => arranging && event.preventDefault()}
          onDrop={() => movePanel('cashControl')}
        >
          <GlassCard
            title={<span className="flex items-center gap-1.5">{panelDragHandle('cashControl', 'cash control')}<Banknote className="h-4 w-4 text-[var(--color-money-500)]" />Cash control</span>}
            bodyClassName="p-3 sm:p-3"
          >
            <form onSubmit={saveFigures}>
              <div>
                <section>
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-[0.75rem] font-semibold">Denominations</h3><span className="text-[0.625rem] text-[var(--faint-fg)]">Qty × note</span></div>
                  <div className="overflow-hidden rounded-[13px] border bg-[var(--input-bg)]">
                    {CASHBOOK_DENOMINATIONS.map((denomination) => {
                      const field = denomination.field as CashbookDenominationField;
                      const value = BigInt(nonNegativeCount(figures[field])) * denomination.paise;
                      return (
                        <div key={field} className="grid grid-cols-[3.2rem_1fr_5.6rem] items-center border-b last:border-b-0">
                          <label htmlFor={field} className="px-2 text-[0.76rem] font-bold">₹{denomination.rupees.toString()}</label>
                          <input id={field} inputMode="numeric" value={figures[field]} disabled={!canMutate || pending} onChange={(event) => setFigures((old) => ({ ...old, [field]: event.target.value }))} className="h-8 min-w-0 w-full border-x bg-[var(--surface-solid)] px-2 text-right text-[0.76rem] font-medium tabular-nums outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-brand-500)]" />
                          <Money paise={value} decimals={false} className="px-2 text-right text-[0.74rem] font-semibold" />
                        </div>
                      );
                    })}
                    <div className="grid grid-cols-[3.2rem_1fr_5.6rem] items-center border-b">
                      <label htmlFor="coins" className="px-2 text-[0.72rem] font-bold">Coins</label>
                      <input id="coins" inputMode="numeric" pattern="[0-9]*" value={figures.coins} disabled={!canMutate || pending} onChange={(event) => setFigures((old) => ({ ...old, coins: event.target.value }))} className="h-8 min-w-0 w-full border-x bg-[var(--surface-solid)] px-2 text-right text-[0.72rem] tabular-nums outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-brand-500)]" />
                      <Money paise={liveMoney(figures.coins)} decimals={false} className="px-2 text-right text-[0.68rem] font-medium" />
                    </div>
                    <div className="flex items-end justify-between bg-[var(--glass-bg-strong)] px-3 py-2"><span className="text-[0.625rem] font-bold uppercase tracking-wide text-[var(--muted-fg)]">Cash in hand</span><Money paise={totals.countedCashPaise} decimals={false} className="text-[1rem] font-extrabold" /></div>
                  </div>

                </section>
              </div>
            </form>
          </GlassCard>
          {panelResizeHandle('cashControl', 'cash control')}
        </section>

        <section
          data-cashbook-panel="calculation"
          className={cn('cashbook-panel relative min-w-0', draggedPanel === 'calculation' && 'opacity-60')}
          style={{ order: panelOrder.indexOf('calculation'), '--cashbook-span': panelSpans.calculation } as CSSProperties}
          onDragOver={(event) => arranging && event.preventDefault()}
          onDrop={() => movePanel('calculation')}
        >
          <GlassCard title={<span className="flex items-center gap-1.5">{panelDragHandle('calculation', 'cash calculation')}Cash calculation</span>} bodyClassName="p-0 sm:p-0">
            <form onSubmit={saveFigures}>
              <p className="sr-only">Live cash equation</p>
              <div className="cashbook-calc-grid grid">
                {summaryRows.map((row, index) => (
                  <div key={row.label} className={cn('grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-1.5 border-b px-2.5 py-1', index < 8 && 'cashbook-calc-left', row.strong && 'bg-[var(--glass-bg-strong)] py-1.5')}>
                    <span className={cn('text-[0.7rem] font-semibold leading-tight', row.tone === 'add' && 'text-[var(--color-money-600)] dark:text-[var(--color-money-400)]', row.tone === 'subtract' && 'text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]', row.tone === 'report' && 'text-[var(--color-info-600)] dark:text-[var(--color-info-400)]', row.strong && 'text-[0.75rem] font-extrabold')}>{row.label}</span>
                    {row.field ? (
                      <div className="relative"><span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[0.68rem] text-[var(--faint-fg)]">₹</span><input aria-label={row.label} inputMode="numeric" pattern="[0-9]*" value={figures[row.field]} disabled={!canMutate || pending} onChange={(event) => setFigures((old) => ({ ...old, [row.field!]: event.target.value }))} className="h-7 w-full rounded-[8px] border bg-[var(--input-bg)] pl-5 pr-1.5 text-right text-[0.72rem] font-semibold tabular-nums outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]" /></div>
                    ) : <Money paise={row.value} decimals={false} className={cn('text-right text-[0.74rem] font-bold', row.strong && 'text-[0.82rem] font-extrabold')} />}
                  </div>
                ))}
              </div>
              <div className="grid gap-3 border-t p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="text-[0.68rem] font-medium text-[var(--muted-fg)]">Day note<Textarea value={figures.notes} onChange={(event) => setFigures((old) => ({ ...old, notes: event.target.value }))} disabled={!canMutate || pending} placeholder="Optional operational note" className="mt-1 min-h-12 text-[0.72rem]" /></label>
                <Button type="submit" variant="success" size="sm" loading={pending} disabled={!canMutate}><Save className="h-3.5 w-3.5" />Save cash control</Button>
              </div>
            </form>
          </GlassCard>
          {panelResizeHandle('calculation', 'cash calculation')}
        </section>
      </div>
    </div>
  );
}
