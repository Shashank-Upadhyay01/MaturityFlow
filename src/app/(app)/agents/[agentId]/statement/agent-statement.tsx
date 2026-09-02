'use client';

import { Printer } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { formatPaise } from '@/lib/money';
import { PRODUCT_NAME } from '@/lib/brand';
import {
  SETTLEMENT_LABEL,
  groupByCustomer,
  paidOf,
  remainingOf,
  settlementOf,
  summariseBook,
  type BookCase,
} from '@/lib/agent-book';
import { buildPlanRow, type PlanCase, type PlanInstalment } from '@/lib/plan-view';
import { formatDMY, makeCalendar, weekdayShort, type SaturdayRule } from '@/lib/working-days';

type AgentStatementCase = BookCase & PlanCase;

/**
 * An agent's customer statement, laid out for A4 and printed by the browser.
 *
 * Deliberately plain: fixed black-on-white, real table borders, no glass and no theme tokens.
 * A statement that leaves the building has to look the same on every machine and survive being
 * printed on a branch inkjet, so none of the app's translucency or dark-mode palette applies here.
 */
export function AgentStatement({
  orgName,
  branchName,
  agentName,
  agentCode,
  preparedBy,
  preparedOn,
  today,
  calendar,
  cases,
  instalments,
}: {
  orgName: string;
  branchName: string;
  agentName: string;
  agentCode: string;
  preparedBy: string;
  preparedOn: string;
  today: string;
  calendar: { holidays: string[]; sundaysOff: boolean; saturdayRule: SaturdayRule };
  cases: AgentStatementCase[];
  instalments: PlanInstalment[];
}) {
  const groups = useMemo(() => groupByCustomer(cases), [cases]);
  const summary = useMemo(() => summariseBook(groups), [groups]);
  const cal = useMemo(() => makeCalendar(calendar.holidays, {
    sundaysOff: calendar.sundaysOff,
    saturdayRule: calendar.saturdayRule,
  }), [calendar]);
  const [ready, setReady] = useState(false);

  // Let the fonts and table settle before the dialog opens, or the first page prints mid-layout.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 350);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (ready) window.print();
  }, [ready]);

  const money = (v: bigint) => formatPaise(v, { decimals: false });

  return (
    <>
      {/*
        Scoped to this page. `@page` sets the paper; the screen rules only make the preview look
        like the sheet that will come out, so what someone checks is what they send.
      */}
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        .stmt { color: #000; background: #fff; font-size: 10.5px; line-height: 1.45; }
        .stmt table { width: 100%; border-collapse: collapse; }
        .stmt th, .stmt td { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
        .stmt thead th { background: #eee; font-weight: 600; text-align: left; }
        .stmt .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .stmt .cust td { background: #f4f4f4; font-weight: 600; }
        .stmt .case-block { break-inside: avoid; margin-top: 10px; }
        .stmt .case-title { background: #e8e8e8; border: 1px solid #888; border-bottom: 0; padding: 5px 7px; font-weight: 700; }
        .stmt .lifecycle { border: 1px solid #999; border-bottom: 0; padding: 5px 7px; font-size: 9.5px; background: #fafafa; }
        .stmt .paid { background: #eaf6ec; }
        .stmt .today { background: #e8eefc; font-weight: 700; }
        .stmt .missed { background: #fdecec; }
        .stmt tfoot td { background: #eee; font-weight: 700; }
        /* A customer's rows are never split across a page break. */
        .stmt tbody tr { break-inside: avoid; }
        .stmt thead { display: table-header-group; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
        }
        @media screen {
          .stmt {
            max-width: 297mm;
            margin: 0 auto;
            padding: 10mm;
            background: #fff;
            box-shadow: 0 2px 24px rgba(0,0,0,.18);
          }
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
            Agent statement — {agentName}
            {agentCode ? ` (${agentCode})` : ''}
          </div>
        </div>

        <table style={{ marginBottom: 10 }}>
          <tbody>
            <tr>
              <td>Customers</td>
              <td className="num">{summary.customers}</td>
              <td>Maturities</td>
              <td className="num">{summary.cases}</td>
              <td>Fully received</td>
              <td className="num">
                {summary.settledCustomers} of {summary.customers}
              </td>
            </tr>
            <tr>
              <td>Total maturity</td>
              <td className="num">{money(summary.maturityPaise)}</td>
              <td>Received</td>
              <td className="num">{money(summary.paidPaise)}</td>
              <td>Still owed</td>
              <td className="num">
                <strong>{money(summary.remainingPaise)}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        {groups.length === 0 ? (
          <p style={{ padding: '20px 0', textAlign: 'center' }}>
            This agent has no customers on the register.
          </p>
        ) : (
          <>
          <table>
            <thead>
              <tr>
                <th style={{ width: '4%' }}>#</th>
                <th style={{ width: "22%" }}>Customer / A/c no.</th>
                <th style={{ width: '15%' }}>Case</th>
                <th style={{ width: '9%' }}>Form in</th>
                <th style={{ width: '9%' }}>Due by</th>
                <th className="num" style={{ width: '11%' }}>Maturity</th>
                <th className="num" style={{ width: '11%' }}>Received</th>
                <th className="num" style={{ width: '10%' }}>Left</th>
                <th style={{ width: '9%' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                // A keyed Fragment, not `<>` — the shorthand cannot take one, and React needs it
                // to keep a customer's header row and its case rows together across re-renders.
                <Fragment key={g.customerId}>
                  <tr className="cust">
                    <td>{gi + 1}</td>
                    <td>
                      {g.customerName}
                      <div style={{ fontWeight: 400, fontSize: 9.5 }}>
                        {g.accountNumber ?? '—'}
                        {g.phone ? ` · ${g.phone}` : ''}
                      </div>
                    </td>
                    <td colSpan={3}>
                      {g.cases.length} maturit{g.cases.length === 1 ? 'y' : 'ies'}
                    </td>
                    <td className="num">{money(g.maturityPaise)}</td>
                    <td className="num">{money(g.paidPaise)}</td>
                    <td className="num">{money(g.remainingPaise)}</td>
                    <td>{g.allReceived ? 'All received' : 'Outstanding'}</td>
                  </tr>
                  {g.cases.map((c) => (
                    <tr key={c.caseId}>
                      <td />
                      <td style={{ fontSize: 9.5 }}>{c.schemeName ?? ''}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.caseNumber}</td>
                      <td>{c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'}</td>
                      <td>{c.deadlineOn ? formatDMY(c.deadlineOn) : '—'}</td>
                      <td className="num">{money(BigInt(c.maturityAmountPaise))}</td>
                      <td className="num">{money(paidOf(c))}</td>
                      <td className="num">{money(remainingOf(c))}</td>
                      <td style={{ fontSize: 9.5 }}>{SETTLEMENT_LABEL[settlementOf(c)]}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>
                  Total — {summary.customers} customer{summary.customers === 1 ? '' : 's'},{' '}
                  {summary.cases} maturit{summary.cases === 1 ? 'y' : 'ies'}
                </td>
                <td className="num">{money(summary.maturityPaise)}</td>
                <td className="num">{money(summary.paidPaise)}</td>
                <td className="num">{money(summary.remainingPaise)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          <h2 style={{ fontSize: 12, margin: '14px 0 4px', borderBottom: '1px solid #000', paddingBottom: 3 }}>
            Detailed customer payment schedules
          </h2>
          {cases.map((c) => {
            const plan = buildPlanRow(c, instalments, cal, today);
            return (
              <section className="case-block" key={`schedule-${c.caseId}`}>
                <div className="case-title">
                  {c.customerName} · A/c {c.accountNumber ?? '—'} · {c.caseNumber}
                  {c.schemeName ? ` · ${c.schemeName}` : ''} · {money(BigInt(c.maturityAmountPaise))}
                </div>
                <div className="lifecycle">
                  <strong>Maturity date:</strong> {c.instrumentMaturityOn ? formatDMY(c.instrumentMaturityOn) : '—'} ·{' '}
                  <strong>Form submission:</strong> {c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'} ·{' '}
                  <strong>Approval date:</strong> {c.approvedOn ? formatDMY(c.approvedOn) : '—'} ·{' '}
                  <strong>Payment starts:</strong> {c.paymentOn ? formatDMY(c.paymentOn) : plan.days[0] ? formatDMY(plan.days[0].dueOn) : '—'} ·{' '}
                  <strong>Final due:</strong> {c.deadlineOn ? formatDMY(c.deadlineOn) : plan.days.at(-1) ? formatDMY(plan.days.at(-1)!.dueOn) : '—'} ·{' '}
                  <strong>Pattern:</strong> {plan.parts} parts, {plan.cadence === 'ALTERNATE' ? 'alternate days' : 'daily'}
                </div>
                {plan.error ? <p style={{ border: '1px solid #999', padding: 6 }}>{plan.error}</p> : (
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Payment date</th><th className="num">Scheduled</th>
                        <th className="num">Cash</th><th className="num">Online</th>
                        <th className="num">Paid</th><th className="num">Remaining</th><th>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.days.map((d) => (
                        <tr key={`${c.caseId}-${d.seq}`} className={d.state === 'PAID' ? 'paid' : d.state === 'DUE_TODAY' ? 'today' : d.state === 'OVERDUE' ? 'missed' : ''}>
                          <td>{d.seq}</td>
                          <td>{formatDMY(d.dueOn)} · {weekdayShort(d.dueOn)}</td>
                          <td className="num">{money(d.amountPaise)}</td>
                          <td className="num">{money(d.cashPaise)}</td>
                          <td className="num">{money(d.onlinePaise)}</td>
                          <td className="num">{money(d.paidPaise)}</td>
                          <td className="num">{money(d.amountPaise > d.paidPaise ? d.amountPaise - d.paidPaise : 0n)}</td>
                          <td>{d.state === 'PAID' ? 'Given' : d.state === 'PARTIAL' ? 'Part given' : d.state === 'DUE_TODAY' ? 'Due today' : d.state === 'OVERDUE' ? 'Missed' : 'Upcoming'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
          </>
        )}

        <p style={{ marginTop: 12, fontSize: 9, color: '#444' }}>
          Amounts are as recorded in {PRODUCT_NAME} on {preparedOn}. &quot;Received&quot; is money
          actually paid out against the maturity, not what was scheduled.
        </p>
      </div>
    </>
  );
}
