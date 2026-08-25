'use client';

import { Printer } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { formatPaise } from '@/lib/money';
import { SETTLEMENT_LABEL, settlementOf } from '@/lib/agent-book';
import { buildPlanRow, type PlanInstalment } from '@/lib/plan-view';
import { formatDMY, makeCalendar, weekdayShort, type SaturdayRule } from '@/lib/working-days';
import type { CustomerCase } from '../../customer-list';

/**
 * A customer's statement — every maturity, and the day it lands.
 *
 * Plain black-on-white with real table borders and no theme tokens: this leaves the building, so
 * it has to look the same on every machine and survive a branch inkjet.
 */
export function CustomerStatement({
  orgName,
  branchName,
  preparedBy,
  preparedOn,
  today,
  calendar,
  cases,
  instalments,
}: {
  orgName: string;
  branchName: string;
  preparedBy: string;
  preparedOn: string;
  today: string;
  calendar: { holidays: string[]; sundaysOff: boolean; saturdayRule: SaturdayRule };
  cases: CustomerCase[];
  instalments: PlanInstalment[];
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 350);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (ready) window.print();
  }, [ready]);

  const cal = useMemo(
    () =>
      makeCalendar(calendar.holidays, {
        sundaysOff: calendar.sundaysOff,
        saturdayRule: calendar.saturdayRule,
      }),
    [calendar],
  );

  const money = (v: bigint) => formatPaise(v, { decimals: false });
  const head = cases[0];
  const totals = cases.reduce(
    (a, c) => {
      const paid = BigInt(c.paidCashPaise) + BigInt(c.paidOnlinePaise);
      const mat = BigInt(c.maturityAmountPaise);
      return {
        maturity: a.maturity + mat,
        paid: a.paid + paid,
        left: a.left + (mat > paid ? mat - paid : 0n),
      };
    },
    { maturity: 0n, paid: 0n, left: 0n },
  );

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 14mm 12mm; }
        .stmt { color: #000; background: #fff; font-size: 10.5px; line-height: 1.45; }
        .stmt table { width: 100%; border-collapse: collapse; }
        .stmt th, .stmt td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
        .stmt thead th { background: #eee; font-weight: 600; text-align: left; }
        .stmt .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stmt .caseHead td { background: #f4f4f4; font-weight: 600; }
        .stmt tfoot td { background: #eee; font-weight: 700; }
        .stmt tbody tr { break-inside: avoid; }
        .stmt thead { display: table-header-group; }
        .stmt .paid { background: #eaf6ec; }
        .stmt .today { background: #e8eefc; font-weight: 700; }
        .stmt .missed { background: #fdecec; }
        @media print { .no-print { display: none !important; } html, body { background: #fff !important; } }
        @media screen {
          .stmt { max-width: 210mm; margin: 0 auto; padding: 14mm 12mm; background: #fff;
                  box-shadow: 0 2px 24px rgba(0,0,0,.18); }
        }
      `}</style>

      <div className="no-print mx-auto flex max-w-[210mm] items-center justify-between gap-3 px-4 py-3">
        <p className="text-[0.8125rem] text-[var(--muted-fg)]">
          The print dialog opens by itself. Choose <strong>Save as PDF</strong> to get a file you
          can send.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-brand-500)] px-3 py-1.5 text-[0.8125rem] font-medium text-white"
        >
          <Printer className="h-3.5 w-3.5" />
          Print again
        </button>
      </div>

      <div className="stmt">
        <div style={{ borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{orgName}</div>
              <div style={{ fontSize: 11 }}>{branchName}</div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 10 }}>
              <div>Prepared {preparedOn}</div>
              <div>By {preparedBy}</div>
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700 }}>
            Customer statement — {head?.customerName ?? 'Customer'}
          </div>
        </div>

        {!head ? (
          <p style={{ padding: '20px 0', textAlign: 'center' }}>No maturities for this customer.</p>
        ) : (
          <>
            <table style={{ marginBottom: 10 }}>
              <tbody>
                <tr>
                  <td>A/c no.</td>
                  <td>{head.accountNumber ?? '—'}</td>
                  <td>Phone</td>
                  <td>{head.phone ?? '—'}</td>
                  <td>Agent</td>
                  <td>{head.agentName}</td>
                </tr>
                <tr>
                  <td>Maturities</td>
                  <td className="num">{cases.length}</td>
                  <td>Total</td>
                  <td className="num">{money(totals.maturity)}</td>
                  <td>Received</td>
                  <td className="num">{money(totals.paid)}</td>
                </tr>
                <tr>
                  <td>Payout bank</td>
                  <td colSpan={3}>
                    {head.payoutBank ?? '—'}
                    {head.payoutAccount ? ` · ${head.payoutAccount}` : ''}
                    {head.payoutIfsc ? ` · ${head.payoutIfsc}` : ''}
                  </td>
                  <td>Still owed</td>
                  <td className="num">
                    <strong>{money(totals.left)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            <table>
              <thead>
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th style={{ width: '13%' }}>Date</th>
                  <th style={{ width: '10%' }}>Day</th>
                  <th className="num" style={{ width: '16%' }}>
                    Amount
                  </th>
                  <th style={{ width: '14%' }}>State</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const plan = buildPlanRow(c, instalments, cal, today);
                  const paid = BigInt(c.paidCashPaise) + BigInt(c.paidOnlinePaise);
                  const mat = BigInt(c.maturityAmountPaise);
                  return (
                    <Fragment key={c.caseId}>
                      <tr className="caseHead">
                        <td colSpan={3}>
                          {c.caseNumber}
                          {c.schemeName ? ` · ${c.schemeName}` : ''}
                        </td>
                        <td className="num">{money(mat)}</td>
                        <td>{SETTLEMENT_LABEL[settlementOf(c)]}</td>
                        <td>
                          received {money(paid)} · left {money(mat > paid ? mat - paid : 0n)}
                        </td>
                      </tr>
                      {plan.error ? (
                        <tr>
                          <td colSpan={6}>{plan.error}</td>
                        </tr>
                      ) : (
                        plan.days.map((d) => (
                          <tr
                            key={`${c.caseId}-${d.seq}`}
                            className={
                              d.state === 'PAID'
                                ? 'paid'
                                : d.state === 'DUE_TODAY'
                                  ? 'today'
                                  : d.state === 'OVERDUE'
                                    ? 'missed'
                                    : ''
                            }
                          >
                            <td>{d.seq}</td>
                            <td>{formatDMY(d.dueOn)}</td>
                            <td>{weekdayShort(d.dueOn)}</td>
                            <td className="num">{money(d.amountPaise)}</td>
                            <td>
                              {d.state === 'PAID'
                                ? 'Given'
                                : d.state === 'PARTIAL'
                                  ? 'Part given'
                                  : d.state === 'DUE_TODAY'
                                    ? 'Due today'
                                    : d.state === 'OVERDUE'
                                      ? 'Missed'
                                      : 'Upcoming'}
                            </td>
                            <td>
                              {d.seq === 1
                                ? plan.isProjection
                                  ? 'Projected — set on approval'
                                  : `Approved ${plan.approvedOn ? formatDMY(plan.approvedOn) : ''}`
                                : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    Total — {cases.length} maturit{cases.length === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="num">{money(totals.maturity)}</td>
                  <td colSpan={2}>
                    received {money(totals.paid)} · still owed {money(totals.left)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}

        <p style={{ marginTop: 12, fontSize: 9, color: '#444' }}>
          Amounts are as recorded in MaturityFlow on {preparedOn}. &quot;Given&quot; is money
          actually paid out. Days marked projected are set firm when the maturity is approved.
        </p>
      </div>
    </>
  );
}
