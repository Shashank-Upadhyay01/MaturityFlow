'use client';

import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  CASHBOOK_CATEGORY_META,
  CASHBOOK_COMMITMENT_META,
  CASHBOOK_DENOMINATIONS,
} from '@/lib/daily-cashbook';
import { formatPaise } from '@/lib/money';
import { PRODUCT_NAME } from '@/lib/brand';
import type { Serialized } from '@/lib/serialize';
import { formatISODate } from '@/lib/working-days';
import type { CashbookDayView } from '@/services/queries';

type View = Serialized<CashbookDayView>;

function money(paise: string): string {
  return formatPaise(BigInt(paise), { decimals: false });
}

export function CashbookPrint({
  view,
  orgName,
  preparedBy,
}: {
  view: View;
  orgName: string;
  preparedBy: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 350);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (ready) window.print();
  }, [ready]);

  const t = view.totals;
  const named = [...new Map([...view.currentCommitments, ...view.carriedCommitments].map((item) => [item.id, item])).values()];
  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        .cb-print { color: #000; background: #fff; font-size: 10px; line-height: 1.35; }
        .cb-print table { width: 100%; border-collapse: collapse; }
        .cb-print th, .cb-print td { border: 1px solid #888; padding: 4px 6px; vertical-align: top; }
        .cb-print th { background: #eee; text-align: left; font-weight: 700; }
        .cb-print .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .cb-print .total { background: #e0e7ff; font-weight: 800; }
        .cb-print .verdict { font-weight: 800; border: 2px solid #111; }
        .cb-print section { break-inside: avoid; margin-top: 10px; }
        .cb-print thead { display: table-header-group; }
        @media print { .no-print { display: none !important; } html, body { background: #fff !important; } }
        @media screen { .cb-print { max-width: 210mm; margin: 0 auto; padding: 12mm; box-shadow: 0 2px 24px rgba(0,0,0,.18); } }
      `}</style>

      <div className="no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3">
        <p className="text-[0.8125rem] text-[var(--muted-fg)]">Choose <strong>Save as PDF</strong> in the print dialog to share a PDF file.</p>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-brand-500)] px-3 py-1.5 text-[0.8125rem] font-medium text-white"><Printer className="h-3.5 w-3.5" /> Print again</button>
      </div>

      <div className="cb-print">
        <header style={{ borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div><div style={{ fontSize: 16, fontWeight: 800 }}>{orgName}</div><div>{view.branch.code} · {view.branch.name}</div></div>
            <div style={{ textAlign: 'right' }}><div>{formatISODate(view.date)}</div><div>Prepared by {preparedBy}</div><div>{view.day?.status ?? 'NOT STARTED'}{view.day?.status === 'CLOSED' ? ` · revision ${view.day.closeRevision}` : ''}</div></div>
          </div>
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800 }}>Daily Cashbook & Physical Cash Reconciliation</div>
        </header>

        <table>
          <tbody>
            <tr><td>Opening balance</td><td className="num">{money(t.openingBalancePaise)}</td><td>Old portal total</td><td className="num">{money(view.figures.oldPortalTotalPaise)}</td></tr>
            <tr><td>New loan</td><td className="num">{money(t.byCategory.NEW_LOAN)}</td><td>Savings deposit</td><td className="num">{money(t.byCategory.SAVINGS_DEPOSIT)}</td></tr>
            <tr className="total"><td>TOTAL AMOUNT</td><td className="num">{money(t.totalAmountPaise)}</td><td>Receiving (report)</td><td className="num">{money(t.receivingPaise)}</td></tr>
            <tr><td>By account</td><td className="num">− {money(t.byAccountPaise)}</td><td>Withdrawals</td><td className="num">− {money(t.byCategory.WITHDRAWAL)}</td></tr>
            <tr><td>Expenses</td><td className="num">− {money(t.byCategory.EXPENSE)}</td><td>Renewal (report)</td><td className="num">{money(t.byCategory.RENEWAL)}</td></tr>
            <tr className="total"><td>EXPECTED PHYSICAL CASH</td><td className="num">{money(t.expectedPhysicalCashPaise)}</td><td>CASH IN HAND</td><td className="num">{money(t.countedCashPaise)}</td></tr>
            <tr className="verdict"><td colSpan={2}>CASH DIFFERENCE — {t.state}</td><td colSpan={2} className="num">{money(t.cashDifferencePaise)}</td></tr>
          </tbody>
        </table>

        <section>
          <h2 style={{ fontSize: 11, marginBottom: 4 }}>Portal/business report</h2>
          <table><tbody><tr><td>Fixed deposit</td><td className="num">{money(view.figures.fixedDepositPaise)}</td><td>New business</td><td className="num">{money(view.figures.newBusinessPaise)}</td><td>Membership</td><td className="num">{money(view.figures.membershipCollectionPaise)}</td></tr><tr><td>Old loan</td><td className="num">{money(view.figures.oldLoanPaise)}</td><td>Breakdown</td><td className="num">{money(t.portalBreakdownPaise)}</td><td>Portal variance</td><td className="num">{money(t.portalVariancePaise)}</td></tr></tbody></table>
        </section>

        <section>
          <h2 style={{ fontSize: 11, marginBottom: 4 }}>Denomination count</h2>
          <table><thead><tr>{CASHBOOK_DENOMINATIONS.map((d) => <th key={d.field}>{d.label}</th>)}<th>Coins</th><th>Cash in hand</th></tr></thead><tbody><tr>{CASHBOOK_DENOMINATIONS.map((d) => <td key={d.field} className="num">{view.figures[d.field]} × {d.label}</td>)}<td className="num">{money(view.figures.coinsPaise)}</td><td className="num total">{money(t.countedCashPaise)}</td></tr></tbody></table>
        </section>

        <section>
          <h2 style={{ fontSize: 11, marginBottom: 4 }}>Day entries</h2>
          <table><thead><tr><th>#</th><th>Category</th><th>Channel</th><th>Person / reference</th><th>Note</th><th className="num">Amount</th></tr></thead><tbody>{view.entries.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center' }}>No entries</td></tr> : view.entries.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{CASHBOOK_CATEGORY_META[row.category].label}</td><td>{row.channel === 'CASH' ? 'Cash' : 'By account'}</td><td>{[row.partyName, row.reference].filter(Boolean).join(' · ')}</td><td>{row.note ?? ''}</td><td className="num">{money(row.amountPaise)}</td></tr>)}</tbody></table>
        </section>

        <section>
          <h2 style={{ fontSize: 11, marginBottom: 4 }}>Named items and carried obligations</h2>
          <table><thead><tr><th>Source</th><th>Type</th><th>Person / customer</th><th>Due</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>{named.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center' }}>No named items</td></tr> : named.map((item) => <tr key={item.id}><td>{item.sourceDate}</td><td>{CASHBOOK_COMMITMENT_META[item.kind].label}</td><td>{item.partyName}</td><td>{item.dueOn ?? ''}</td><td>{item.settledAt ? 'Settled' : item.carried ? 'Carried / outstanding' : 'Outstanding'}</td><td className="num">{money(item.amountPaise)}</td></tr>)}</tbody></table>
        </section>

        <section>
          <table><tbody><tr><td>Given cash outstanding</td><td className="num">{money(view.commitmentTotals.GIVEN_CASH.outstandingPaise)}</td><td>Due amount outstanding</td><td className="num">{money(view.commitmentTotals.DUE_AMOUNT.outstandingPaise)}</td><td>Pending withdrawals outstanding</td><td className="num">{money(view.commitmentTotals.PENDING_WITHDRAWAL.outstandingPaise)}</td></tr></tbody></table>
        </section>
        {view.day?.notes && <p style={{ marginTop: 10 }}><strong>Day note:</strong> {view.day.notes}</p>}
        <footer style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', color: '#444', fontSize: 9 }}><span>Generated from {PRODUCT_NAME}. Money is stored in exact paise.</span><span>{view.day?.status === 'CLOSED' ? 'Approved close snapshot' : 'Live working copy — not yet finally closed'}</span></footer>
      </div>
    </>
  );
}
