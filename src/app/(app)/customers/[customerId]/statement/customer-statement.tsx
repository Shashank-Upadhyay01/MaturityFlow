'use client';

import { Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
        @page { size: A4 landscape; margin: 11mm 10mm; }
        .stmt { color: #000; background: #fff; font-size: 10.5px; line-height: 1.45; }
        .stmt table { width: 100%; border-collapse: collapse; }
        .stmt .payment-table { table-layout: fixed; }
        .stmt .case-table { margin-bottom: 10px; }
        .stmt th, .stmt td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
        .stmt thead th { background: #eee; font-weight: 600; text-align: left; }
        .stmt .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stmt .payment-table th.num, .stmt .payment-table td.num { text-align: right; }
        .stmt .caseHead td { background: #f4f4f4; font-weight: 600; }
        .stmt tfoot td { background: #eee; font-weight: 700; }
        .stmt tbody tr { break-inside: avoid; }
        .stmt thead { display: table-header-group; }
        .stmt .paid { background: #eaf6ec; }
        .stmt .today { background: #e8eefc; font-weight: 700; }
        .stmt .missed { background: #fdecec; }
        @media print { .no-print { display: none !important; } html, body { background: #fff !important; } }
        @media screen {
          .stmt { max-width: 297mm; margin: 0 auto; padding: 11mm 10mm; background: #fff;
                  box-shadow: 0 2px 24px rgba(0,0,0,.18); }
        }
      `}</style>

      <div className="no-print mx-auto flex max-w-[297mm] items-center justify-between gap-3 px-4 py-3">
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
                  <td>Customer code / A/c no.</td>
                  <td>{head.customerCode ?? '—'} · {head.accountNumber ?? '—'}</td>
                  <td>Phone / email</td>
                  <td>{head.phone ?? '—'}{head.email ? ` · ${head.email}` : ''}</td>
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
                  <td>Still owed</td>
                  <td className="num" colSpan={5}>
                    <strong>{money(totals.left)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            {cases.map((c) => {
              const plan = buildPlanRow(c, instalments, cal, today);
              const paid = BigInt(c.paidCashPaise) + BigInt(c.paidOnlinePaise);
              const mat = BigInt(c.maturityAmountPaise);
              return (
                <table className="payment-table case-table" key={c.caseId}>
                  <colgroup>
                    <col style={{ width: '5%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '9%' }} />
                  </colgroup>
                  <thead>
                      <tr className="caseHead">
                        <td colSpan={8}>
                          {c.caseNumber}
                          {c.schemeName ? ` · ${c.schemeName}` : ''}
                          {' '}· maturity {money(mat)} · {SETTLEMENT_LABEL[settlementOf(c)]}
                          {' '}· received {money(paid)} · left {money(mat > paid ? mat - paid : 0n)}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={8} style={{ fontSize: 9.5, background: '#fafafa' }}>
                          <strong>Maturity date:</strong> {c.instrumentMaturityOn ? formatDMY(c.instrumentMaturityOn) : '—'} ·{' '}
                          <strong>Form submission:</strong> {c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'} ·{' '}
                          <strong>Approval date:</strong> {c.approvedOn ? formatDMY(c.approvedOn) : '—'} ·{' '}
                          <strong>Payment starts:</strong> {c.paymentOn ? formatDMY(c.paymentOn) : plan.days[0] ? formatDMY(plan.days[0].dueOn) : '—'} ·{' '}
                          <strong>Final payment due:</strong> {c.deadlineOn ? formatDMY(c.deadlineOn) : plan.days.at(-1) ? formatDMY(plan.days.at(-1)!.dueOn) : '—'} ·{' '}
                          <strong>Pattern:</strong> {plan.parts} parts, {plan.cadence === 'ALTERNATE' ? 'alternate days' : 'daily'}
                        </td>
                      </tr>
                      <tr>
                        <th>#</th>
                        <th>Payment date</th>
                        <th className="num">Scheduled</th>
                        <th className="num">Cash</th>
                        <th className="num">Online</th>
                        <th className="num">Paid</th>
                        <th className="num">Remaining</th>
                        <th>State</th>
                      </tr>
                  </thead>
                  <tbody>
                    {plan.error ? (
                      <tr>
                        <td colSpan={8}>{plan.error}</td>
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
                            <td>{formatDMY(d.dueOn)} · {weekdayShort(d.dueOn)}</td>
                            <td className="num">{money(d.amountPaise)}</td>
                            <td className="num">{money(d.cashPaise)}</td>
                            <td className="num">{money(d.onlinePaise)}</td>
                            <td className="num">{money(d.paidPaise)}</td>
                            <td className="num">{money(d.amountPaise > d.paidPaise ? d.amountPaise - d.paidPaise : 0n)}</td>
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
                          </tr>
                      ))
                    )}
                  </tbody>
                </table>
              );
            })}
            <table className="payment-table">
              <colgroup>
                <col style={{ width: '5%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '9%' }} />
              </colgroup>
              <tbody>
                <tr>
                  <td colSpan={2}>
                    Total — {cases.length} maturit{cases.length === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="num">{money(totals.maturity)}</td>
                  <td colSpan={5}>
                    received {money(totals.paid)} · still owed {money(totals.left)}
                  </td>
                </tr>
              </tbody>
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
