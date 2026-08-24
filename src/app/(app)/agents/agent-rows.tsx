'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, FileText, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import {
  SETTLEMENT_LABEL,
  groupByCustomer,
  paidOf,
  remainingOf,
  settlementOf,
  summariseBook,
  type BookCase,
  type SettlementState,
} from '@/lib/agent-book';
import { cn } from '@/lib/utils';
import { formatDMY } from '@/lib/working-days';

export interface AgentRow {
  agentId: string;
  agentName: string;
  agentCode: string;
  branchName: string;
  liveCases: number;
  totalPaise: string;
  paidPaise: string;
}

const TONE: Record<SettlementState, 'money' | 'warn' | 'danger' | 'neutral'> = {
  SETTLED: 'money',
  PARTLY_PAID: 'warn',
  NOTHING_YET: 'danger',
  NOT_STARTED: 'neutral',
};

/**
 * The agents list, one expandable row per agent.
 *
 * Every agent's cases are already on the page — expanding is a local state change, not a
 * round-trip, so the list opens instantly and works the same offline as on the LAN. Grouping and
 * the "received everything?" question come from agent-book.ts, which is unit-tested; nothing here
 * decides whether a customer has been paid.
 */
export function AgentRows({ agents, cases }: { agents: AgentRow[]; cases: (BookCase & { agentId: string })[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const booksByAgent = useMemo(() => {
    const m = new Map<string, BookCase[]>();
    for (const c of cases) {
      const list = m.get(c.agentId);
      if (list) list.push(c);
      else m.set(c.agentId, [c]);
    }
    return m;
  }, [cases]);

  return (
    <div className="divide-y">
      {agents.map((a) => {
        const book = booksByAgent.get(a.agentId) ?? [];
        const groups = groupByCustomer(book);
        const summary = summariseBook(groups);
        const isOpen = Boolean(open[a.agentId]);

        return (
          <div key={a.agentId}>
            {/* ── the agent line ─────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [a.agentId]: !s[a.agentId] }))}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 shrink-0 text-[var(--faint-fg)] transition-transform',
                    isOpen && 'rotate-90',
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.agentName}</span>
                  <span className="block text-[0.72rem] text-[var(--faint-fg)]">
                    {a.agentCode} · {a.branchName} · {summary.customers} customer
                    {summary.customers === 1 ? '' : 's'} · {summary.cases} maturit
                    {summary.cases === 1 ? 'y' : 'ies'}
                  </span>
                </span>
              </button>

              <span className="flex shrink-0 items-center gap-3 text-[0.75rem] tabular-nums">
                {summary.outstandingCustomers === 0 && summary.customers > 0 ? (
                  <Badge tone="money">all received</Badge>
                ) : (
                  <Badge tone="warn">{summary.outstandingCustomers} owed</Badge>
                )}
                <span className="text-[var(--faint-fg)]">
                  paid <Money paise={summary.paidPaise} decimals={false} />
                </span>
                <span className="font-semibold">
                  <Money paise={summary.remainingPaise} decimals={false} />
                </span>
                <Button asChild variant="ghost" size="sm" title="Printable statement — save as PDF">
                  <Link href={`/agents/${a.agentId}/statement`} target="_blank">
                    <FileText className="h-3.5 w-3.5" />
                    PDF
                  </Link>
                </Button>
              </span>
            </div>

            {/* ── the customers ──────────────────────────────────────────── */}
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden"
                >
                  <div className="bg-[var(--glass-bg-subtle)] px-4 pb-4">
                    {groups.length === 0 ? (
                      <p className="py-4 text-center text-[0.8125rem] text-[var(--muted-fg)]">
                        <Users className="mx-auto mb-1 h-4 w-4" />
                        No customers on this agent yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[0.75rem]">
                          <thead>
                            <tr className="border-b text-[0.68rem] uppercase tracking-wide text-[var(--faint-fg)]">
                              <th className="py-1.5 pr-2 text-left font-medium">Customer</th>
                              <th className="py-1.5 pr-2 text-left font-medium">A/c no.</th>
                              <th className="py-1.5 pr-2 text-left font-medium">Case</th>
                              <th className="py-1.5 pr-2 text-left font-medium">Form in</th>
                              <th className="py-1.5 pr-2 text-left font-medium">Due by</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Maturity</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Received</th>
                              <th className="py-1.5 pr-2 text-right font-medium">Left</th>
                              <th className="py-1.5 text-left font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groups.map((g) =>
                              g.cases.map((c, i) => {
                                const state = settlementOf(c);
                                return (
                                  <tr
                                    key={c.caseId}
                                    className={cn(
                                      'border-b border-[var(--hairline)] last:border-0',
                                      i === 0 && 'border-t-0',
                                    )}
                                  >
                                    <td className="py-1.5 pr-2">
                                      {i === 0 ? (
                                        <span className="font-medium">{g.customerName}</span>
                                      ) : (
                                        <span className="text-[var(--faint-fg)]">↳</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 pr-2 tabular-nums text-[var(--muted-fg)]">
                                      {i === 0 ? (g.accountNumber ?? '—') : ''}
                                    </td>
                                    <td className="py-1.5 pr-2">
                                      <Link
                                        href={`/maturities/${c.caseId}`}
                                        className="tabular-nums hover:text-[var(--color-brand-600)]"
                                      >
                                        {c.caseNumber}
                                      </Link>
                                    </td>
                                    <td className="py-1.5 pr-2 tabular-nums text-[var(--muted-fg)]">
                                      {c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'}
                                    </td>
                                    <td className="py-1.5 pr-2 tabular-nums text-[var(--muted-fg)]">
                                      {c.deadlineOn ? formatDMY(c.deadlineOn) : '—'}
                                    </td>
                                    <td className="py-1.5 pr-2 text-right">
                                      <Money paise={BigInt(c.maturityAmountPaise)} decimals={false} />
                                    </td>
                                    <td className="py-1.5 pr-2 text-right">
                                      <Money paise={paidOf(c)} decimals={false} tone="money" />
                                    </td>
                                    <td className="py-1.5 pr-2 text-right font-semibold">
                                      <Money paise={remainingOf(c)} decimals={false} />
                                    </td>
                                    <td className="py-1.5">
                                      <Badge tone={TONE[state]}>{SETTLEMENT_LABEL[state]}</Badge>
                                    </td>
                                  </tr>
                                );
                              }),
                            )}
                          </tbody>
                          <tfoot>
                            <tr className="border-t font-semibold">
                              <td className="py-2 pr-2" colSpan={5}>
                                {summary.customers} customer{summary.customers === 1 ? '' : 's'} ·{' '}
                                {summary.settledCustomers} fully received
                              </td>
                              <td className="py-2 pr-2 text-right">
                                <Money paise={summary.maturityPaise} decimals={false} />
                              </td>
                              <td className="py-2 pr-2 text-right">
                                <Money paise={summary.paidPaise} decimals={false} tone="money" />
                              </td>
                              <td className="py-2 pr-2 text-right">
                                <Money paise={summary.remainingPaise} decimals={false} />
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
