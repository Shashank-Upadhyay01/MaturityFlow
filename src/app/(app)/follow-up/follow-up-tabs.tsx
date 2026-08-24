'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Glass } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { daysBetween, formatDMY } from '@/lib/working-days';

/** Every row carries the case it belongs to; the instalment fields are present per tab. */
export interface FollowUpRow {
  caseId: string;
  caseNumber: string;
  customerName: string;
  accountNumber: string | null;
  agentName: string;
  agentId: string;
  branchName: string;
  maturityAmountPaise: string;
  paidCashPaise: string;
  paidOnlinePaise: string;
  approvedOn: string | null;
  deadlineOn: string | null;
  cadence: string;
  instalmentId?: string;
  dueOn?: string;
  dueAmountPaise?: string;
  duePaidPaise?: string;
  dueTodayPaise?: string;
}

type TabKey = 'missed' | 'today' | 'priority' | 'breached';

const paid = (r: FollowUpRow) => BigInt(r.paidCashPaise) + BigInt(r.paidOnlinePaise);
const remaining = (r: FollowUpRow) => {
  const left = BigInt(r.maturityAmountPaise) - paid(r);
  return left > 0n ? left : 0n;
};

function CaseCell({ r }: { r: FollowUpRow }) {
  return (
    <div className="leading-tight">
      <Link
        href={`/maturities/${r.caseId}`}
        className="font-medium hover:text-[var(--color-brand-600)]"
      >
        {r.customerName}
      </Link>
      <div className="text-[0.7rem] text-[var(--faint-fg)]">
        {r.accountNumber ?? r.caseNumber} · {r.agentName}
      </div>
    </div>
  );
}

/** Paid-so-far and what is left, which is the question every one of these lists is asked. */
function ProgressCells({ r }: { r: FollowUpRow }) {
  return (
    <>
      <TD align="right">
        <Money paise={BigInt(r.maturityAmountPaise)} compact />
      </TD>
      <TD align="right">
        <Money paise={paid(r)} compact tone="money" />
      </TD>
      <TD align="right">
        <span className="font-semibold">
          <Money paise={remaining(r)} compact />
        </span>
      </TD>
    </>
  );
}

export function FollowUpTabs({
  today,
  missed,
  notTaken,
  priority,
  breached,
}: {
  today: string;
  missed: FollowUpRow[];
  notTaken: FollowUpRow[];
  priority: FollowUpRow[];
  breached: FollowUpRow[];
}) {
  const [tab, setTab] = useState<TabKey>('missed');

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'missed', label: 'Missed', count: missed.length },
    { key: 'today', label: 'Not taken today', count: notTaken.length },
    { key: 'priority', label: 'Priority (≥ ₹1L)', count: priority.length },
    { key: 'breached', label: 'Past deadline', count: breached.length },
  ];

  /** Priority is grouped by agent — "who is holding how much" is the question it answers. */
  const byAgent = useMemo(() => {
    const m = new Map<string, { agentName: string; rows: FollowUpRow[] }>();
    for (const r of priority) {
      const e = m.get(r.agentId) ?? { agentName: r.agentName, rows: [] };
      e.rows.push(r);
      m.set(r.agentId, e);
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [priority]);

  return (
    <div className="space-y-3">
      <Glass className="flex flex-wrap items-center gap-1 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[0.8125rem]',
              tab === t.key
                ? 'bg-[var(--glass-bg-strong)] font-medium shadow-sm'
                : 'text-[var(--muted-fg)] hover:text-[var(--page-fg)]',
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[0.68rem] tabular-nums',
                t.count > 0
                  ? 'bg-[var(--color-brand-500)] text-white'
                  : 'bg-[var(--glass-bg-subtle)] text-[var(--faint-fg)]',
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </Glass>

      <Glass className="overflow-hidden">
        <div className="overflow-x-auto">
          {tab === 'missed' &&
            (missed.length === 0 ? (
              <EmptyState title="Nothing missed" description="Every past day was paid in full." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Was due</TH>
                    <TH align="right">Overdue by</TH>
                    <TH align="right">That day</TH>
                    <TH align="right">Maturity</TH>
                    <TH align="right">Paid</TH>
                    <TH align="right">Left</TH>
                  </TR>
                </THead>
                <TBody>
                  {missed.map((r) => (
                    <TR key={r.instalmentId}>
                      <TD>
                        <CaseCell r={r} />
                      </TD>
                      <TD>{r.dueOn ? formatDMY(r.dueOn) : '—'}</TD>
                      <TD align="right">
                        <Badge tone="danger">
                          {r.dueOn ? `${daysBetween(r.dueOn, today)}d` : '—'}
                        </Badge>
                      </TD>
                      <TD align="right">
                        <Money
                          paise={BigInt(r.dueAmountPaise ?? '0') - BigInt(r.duePaidPaise ?? '0')}
                          compact
                        />
                      </TD>
                      <ProgressCells r={r} />
                    </TR>
                  ))}
                </TBody>
              </Table>
            ))}

          {tab === 'today' &&
            (notTaken.length === 0 ? (
              <EmptyState
                title="Nobody is waiting"
                description="Every amount due today has been handed over."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH align="right">Still to give today</TH>
                    <TH align="right">Maturity</TH>
                    <TH align="right">Paid</TH>
                    <TH align="right">Left</TH>
                  </TR>
                </THead>
                <TBody>
                  {notTaken.map((r) => (
                    <TR key={r.instalmentId}>
                      <TD>
                        <CaseCell r={r} />
                      </TD>
                      <TD align="right">
                        <span className="font-semibold">
                          <Money
                            paise={BigInt(r.dueAmountPaise ?? '0') - BigInt(r.duePaidPaise ?? '0')}
                            compact
                          />
                        </span>
                      </TD>
                      <ProgressCells r={r} />
                    </TR>
                  ))}
                </TBody>
              </Table>
            ))}

          {tab === 'priority' &&
            (priority.length === 0 ? (
              <EmptyState
                title="No large cases running"
                description="Nothing at or above ₹1,00,000 is live right now."
              />
            ) : (
              <div className="divide-y">
                {byAgent.map((g) => {
                  const dueToday = g.rows.reduce((a, r) => a + BigInt(r.dueTodayPaise ?? '0'), 0n);
                  const takenSoFar = g.rows.reduce((a, r) => a + paid(r), 0n);
                  const left = g.rows.reduce((a, r) => a + remaining(r), 0n);
                  return (
                    <div key={g.agentName} className="px-4 py-3">
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <span className="font-medium">{g.agentName}</span>
                        <span className="text-[0.75rem] text-[var(--muted-fg)] tabular-nums">
                          {g.rows.length} case{g.rows.length === 1 ? '' : 's'} · withdrawable today{' '}
                          <strong className="text-[var(--page-fg)]">
                            <Money paise={dueToday} compact />
                          </strong>{' '}
                          · taken so far <Money paise={takenSoFar} compact /> · left{' '}
                          <Money paise={left} compact />
                        </span>
                      </div>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Customer</TH>
                            <TH align="right">Today</TH>
                            <TH align="right">Maturity</TH>
                            <TH align="right">Paid</TH>
                            <TH align="right">Left</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {g.rows.map((r) => (
                            <TR key={r.caseId}>
                              <TD>
                                <CaseCell r={r} />
                              </TD>
                              <TD align="right">
                                <Money paise={BigInt(r.dueTodayPaise ?? '0')} compact />
                              </TD>
                              <ProgressCells r={r} />
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  );
                })}
              </div>
            ))}

          {tab === 'breached' &&
            (breached.length === 0 ? (
              <EmptyState
                title="Every promise is being kept"
                description="No live case is past its completion date with money still owed."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Approved</TH>
                    <TH>Promised by</TH>
                    <TH align="right">Late by</TH>
                    <TH align="right">Maturity</TH>
                    <TH align="right">Paid</TH>
                    <TH align="right">Left</TH>
                  </TR>
                </THead>
                <TBody>
                  {breached.map((r) => (
                    <TR key={r.caseId}>
                      <TD>
                        <CaseCell r={r} />
                      </TD>
                      <TD>{r.approvedOn ? formatDMY(r.approvedOn) : '—'}</TD>
                      <TD>{r.deadlineOn ? formatDMY(r.deadlineOn) : '—'}</TD>
                      <TD align="right">
                        <Badge tone="danger">
                          {r.deadlineOn ? `${daysBetween(r.deadlineOn, today)}d` : '—'}
                        </Badge>
                      </TD>
                      <ProgressCells r={r} />
                    </TR>
                  ))}
                </TBody>
              </Table>
            ))}
        </div>
      </Glass>
    </div>
  );
}
