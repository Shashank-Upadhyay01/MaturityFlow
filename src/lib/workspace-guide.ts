/**
 * workspace-guide.ts — the in-app coach's knowledge.
 *
 * Answers are written here, not invented at click time. Money advice stays the same words
 * the rest of the product uses. Add a tip whenever a feature ships; the Guide picks it up.
 */

export interface GuideTip {
  id: string;
  title: string;
  body: string;
  /** Path prefixes this tip belongs to. Empty = every screen. */
  screens: string[];
  keywords: string[];
}

export const GUIDE_TIPS: GuideTip[] = [
  {
    id: 'sheet-type',
    title: 'Type like a spreadsheet',
    body: 'Click a cell and type. Enter moves down, arrows move to the next cell, Escape puts the old value back. Money is whole rupees. Dates use the calendar or you can paste 01/09/2026.',
    screens: ['/maturities', '/maturity-operations'],
    keywords: ['type', 'edit', 'cell', 'excel', 'sheet', 'enter', 'arrow'],
  },
  {
    id: 'sheet-copy-paste',
    title: 'Copy and paste from Excel',
    body: 'Select cells (click, then Shift-click the opposite corner) and press Ctrl+C to copy. Click the first cell you want to fill and press Ctrl+V — rows and columns from Excel or Google Sheets land in the same shape. Each cell still saves the audited way, one row at a time.',
    screens: ['/maturities', '/maturity-operations'],
    keywords: ['copy', 'paste', 'excel', 'google sheets', 'ctrl+c', 'ctrl+v', 'clipboard'],
  },
  {
    id: 'sheet-undo',
    title: 'Undo a cell you just changed',
    body: 'Ctrl+Z puts the last cell edit back. Ctrl+Y does it again. This undoes typing on the sheet, not a Taken payment — Taken is a money movement and needs its own correction.',
    screens: ['/maturities', '/maturity-operations'],
    keywords: ['undo', 'redo', 'ctrl+z', 'mistake'],
  },
  {
    id: 'sheet-filter',
    title: 'Find a customer fast',
    body: 'Use the search box above the sheet. It matches name, account number and agent. On the Register you can also filter by date, agent and tab (Due today, Not paid, All).',
    screens: ['/maturities', '/maturity-operations'],
    keywords: ['filter', 'search', 'find', 'agent'],
  },
  {
    id: 'sheet-letters',
    title: 'Row numbers and column letters',
    body: 'The grey bar on the left is the row number. The letters on top (A, B, C…) are columns, like Excel. The box above the sheet shows the active cell, for example C7.',
    screens: ['/maturities', '/maturity-operations'],
    keywords: ['row', 'column', 'a1', 'letter', 'number', 'address'],
  },
  {
    id: 'taken',
    title: 'Taken — record what was actually given',
    body: 'Taken opens the payment list. Tick every day this visit covers, including today. Type the amount actually given. Admin: that figure replaces paid on the ticked days, it is not added on top. Cashiers add onto unpaid leftover only.',
    screens: ['/maturities', '/maturity-operations', '/payouts'],
    keywords: ['taken', 'pay', 'payment', 'visit', 'missed', 'custom amount'],
  },
  {
    id: 'cash-vs-online',
    title: 'Cash stays cash',
    body: 'If the customer took cash, type it in Visit total (cash) and leave Online at 0. The statement’s Cash / By account columns show what was actually given, not the old plan split.',
    screens: ['/maturities', '/customers'],
    keywords: ['cash', 'online', 'by account', 'statement'],
  },
  {
    id: 'recorded-on',
    title: 'Pick the day the cash left',
    body: 'Admin / CMD / CEO: in Taken, set Recorded on to the calendar day the cash actually went out. Print and Paid today follow that date. Filter the Register to that day before you print.',
    screens: ['/maturities'],
    keywords: ['date', 'recorded on', 'print', 'pdf', 'yesterday'],
  },
  {
    id: 'ops-review',
    title: 'Operations review is not a payment gate',
    body: 'Payment still runs if Operations has not typed the approval date. The Not reviewed list is the Day-3 check. Fill the actual approval date when the human review is done.',
    screens: ['/maturity-operations'],
    keywords: ['operations', 'review', 'approval', 'not reviewed'],
  },
  {
    id: 'import',
    title: 'Bring an Excel file in',
    body: 'Download the Register / Maturities template, fill it, and import. Blank dates warn but still import. You can also paste straight into the sheet without a file.',
    screens: ['/import', '/maturities', '/maturity-operations'],
    keywords: ['import', 'upload', 'template', 'excel file'],
  },
];

export function tipsForPath(pathname: string): GuideTip[] {
  const path = pathname.split('?')[0] ?? pathname;
  const here = GUIDE_TIPS.filter((tip) => tip.screens.length === 0 || tip.screens.some((s) => path === s || path.startsWith(`${s}/`)));
  const rest = GUIDE_TIPS.filter((tip) => !here.includes(tip));
  return [...here, ...rest];
}

export function searchTips(query: string, pathname: string): GuideTip[] {
  const q = query.trim().toLowerCase();
  const ordered = tipsForPath(pathname);
  if (q === '') return ordered;
  const words = q.split(/\s+/).filter(Boolean);
  return ordered
    .map((tip) => {
      const blob = `${tip.title} ${tip.body} ${tip.keywords.join(' ')}`.toLowerCase();
      if (!words.every((word) => blob.includes(word))) return null;
      const score = words.reduce((n, word) => n + (tip.keywords.some((k) => k.includes(word)) ? 3 : 1) + (tip.title.toLowerCase().includes(word) ? 2 : 0), 0);
      return { tip, score };
    })
    .filter((row): row is { tip: GuideTip; score: number } => row != null)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.tip);
}
