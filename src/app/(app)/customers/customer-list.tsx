'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, FileText, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Glass } from '@/components/ui/glass';
import { EmptyState } from '@/components/ui/misc';
import { formatPaise } from '@/lib/money';
import { SETTLEMENT_LABEL, settlementOf, type BookCase } from '@/lib/agent-book';
import { buildPlanRow, type PlanCase, type PlanInstalment } from '@/lib/plan-view';
import { cn } from '@/lib/utils';
import { formatDMY, makeCalendar, weekdayShort, type SaturdayRule } from '@/lib/working-days';

export interface CustomerCase extends PlanCase, BookCase {
  customerId: string;
  customerCode: string | null;
  email: string | null;
  address: string | null;
  payoutBank: string | null;
  payoutAccount: string | null;
  payoutIfsc: string | null;
  branchName: string;
  agentId: string;
}

export interface CalendarSnapshot {
  holidays: string[];
  sundaysOff: boolean;
  saturdayRule: SaturdayRule;
}

const inr = (v: bigint) => formatPaise(v, { decimals: false });
const paidOf = (c: CustomerCase) => BigInt(c.paidCashPaise) + BigInt(c.paidOnlinePaise);
const leftOf = (c: CustomerCase) => {
  const l = BigInt(c.maturityAmountPaise) - paidOf(c);
  return l > 0n ? l : 0n;
};

const DAY_STYLE: Record<string, string> = {
  PAID: 'bg-[color-mix(in_oklab,var(--color-money-500)_14%,transparent)] text-[var(--color-money-700)] dark:text-[var(--color-money-400)]',
  PARTIAL:
    'bg-[color-mix(in_oklab,var(--color-warn-500)_16%,transparent)] text-[var(--color-warn-600)] dark:text-[var(--color-warn-400)]',
  DUE_TODAY:
    'bg-[color-mix(in_oklab,var(--color-brand-500)_18%,transparent)] font-semibold text-[var(--color-brand-600)] dark:text-[var(--color-brand-300)]',
  OVERDUE:
    'bg-[color-mix(in_oklab,var(--color-danger-500)_14%,transparent)] text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]',
  UPCOMING: '',
};

const TONE = {
  SETTLED: 'money',
  PARTLY_PAID: 'warn',
  NOTHING_YET: 'danger',
  NOT_STARTED: 'neutral',
} as const;

interface Group {
  customerId: string;
  name: string;
  code: string | null;
  accountNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  payoutBank: string | null;
  payoutAccount: string | null;
  payoutIfsc: string | null;
  agentName: string;
  branchName: string;
  cases: CustomerCase[];
  maturity: bigint;
  given: bigint;
  left: bigint;
  allReceived: boolean;
}

/**
 * Every customer of the bank, with what they are owed and when it lands.
 *
 * The Agents page answers "what is this agent carrying"; this answers "what does this person get,
 * and has it arrived" — the question asked when a customer rings the branch. Grouping and the
 * "received in full?" rule come from agent-book.ts, and the day-by-day schedule from
 * plan-view.ts, so a customer's dates here and on the Register's plan cannot disagree.
 */
export function CustomerList({
  cases,
  instalments,
  calendar,
  today,
}: {
  cases: CustomerCase[];
  instalments: PlanInstalment[];
  calendar: CalendarSnapshot;
  today: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openCase, setOpenCase] = useState<Record<string, boolean>>({});

  const cal = useMemo(
    () =>
      makeCalendar(calendar.holidays, {
        sundaysOff: calendar.sundaysOff,
        saturdayRule: calendar.saturdayRule,
      }),
    [calendar],
  );

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const c of cases) {
      let g = m.get(c.customerId);
      if (!g) {
        g = {
          customerId: c.customerId,
          name: c.customerName,
          code: c.customerCode,
          accountNumber: c.accountNumber,
          phone: c.phone,
          email: c.email,
          address: c.address,
          payoutBank: c.payoutBank,
          payoutAccount: c.payoutAccount,
          payoutIfsc: c.payoutIfsc,
          agentName: c.agentName,
          branchName: c.branchName,
          cases: [],
          maturity: 0n,
          given: 0n,
          left: 0n,
          allReceived: true,
        };
        m.set(c.customerId, g);
      }
      g.cases.push(c);
      g.maturity += BigInt(c.maturityAmountPaise);
      g.given += paidOf(c);
      g.left += leftOf(c);
      if (settlementOf(c) !== 'SETTLED') g.allReceived = false;
      g.accountNumber ??= c.accountNumber;
      g.phone ??= c.phone;
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'en-IN'));
  }, [cases]);

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(n) ||
        (g.accountNumber ?? '').toLowerCase().includes(n) ||
        (g.phone ?? '').toLowerCase().includes(n) ||
        g.agentName.toLowerCase().includes(n) ||
        g.cases.some((c) => c.caseNumber.toLowerCase().includes(n)),
    );
  }, [groups, q]);

  const totals = useMemo(
    () =>
      visible.reduce(
        (a, g) => ({
          maturity: a.maturity + g.maturity,
          given: a.given + g.given,
          left: a.left + g.left,
          settled: a.settled + (g.allReceived ? 1 : 0),
        }),
        { maturity: 0n, given: 0n, left: 0n, settled: 0 },
      ),
    [visible],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find by name, A/c no., phone, agent or case number"
            aria-label="Search customers"
            className="mf-input h-9 w-full max-w-md !pl-8 text-[0.8125rem]"
          />
        </div>
        <p className="text-[0.75rem] tabular-nums text-[var(--muted-fg)]">
          <strong>{visible.length}</strong> customer{visible.length === 1 ? '' : 's'} ·{' '}
          {totals.settled} fully received · owed{' '}
          <strong className="text-[var(--page-fg)]">{inr(totals.left)}</strong>
        </p>
      </div>

      <Glass className="p-0">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No customers"
            description={
              q.trim()
                ? 'Nothing matches that search.'
                : 'Import the register to see customers here.'
            }
          />
        ) : (
          <div className="divide-y">
            {visible.map((g) => {
              const isOpen = Boolean(open[g.customerId]);
              return (
                <div key={g.customerId}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen((s) => ({ ...s, [g.customerId]: !s[g.customerId] }))}
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
                        <span className="block truncate font-medium">{g.name}</span>
                        <span className="block truncate text-[0.72rem] text-[var(--faint-fg)]">
                          {g.accountNumber ?? '—'}
                          {g.phone ? ` · ${g.phone}` : ''} · {g.agentName} · {g.cases.length}{' '}
                          maturit{g.cases.length === 1 ? 'y' : 'ies'}
                        </span>
                      </span>
                    </button>

                    <span className="flex shrink-0 items-center gap-3 text-[0.75rem] tabular-nums">
                      {g.allReceived ? (
                        <Badge tone="money">received in full</Badge>
                      ) : (
                        <Badge tone="warn">owed</Badge>
                      )}
                      <span className="text-[var(--faint-fg)]">
                        of {inr(g.maturity)} given{' '}
                        <span className="text-[var(--color-money-700)] dark:text-[var(--color-money-400)]">
                          {inr(g.given)}
                        </span>
                      </span>
                      <span className="font-semibold">{inr(g.left)}</span>
                      <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        title="Printable statement — save as PDF"
                      >
                        <Link href={`/customers/${g.customerId}/statement`} target="_blank">
                          <FileText className="h-3.5 w-3.5" />
                          PDF
                        </Link>
                      </Button>
                    </span>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 bg-[var(--glass-bg-subtle)] px-4 pb-4 pt-1">
                          {/* who they are */}
                          <div className="grid gap-x-6 gap-y-1 text-[0.72rem] sm:grid-cols-2 lg:grid-cols-4">
                            {[
                              ['Branch', g.branchName],
                              ['Agent', g.agentName],
                              ['Customer code', g.code ?? '—'],
                              ['Phone', g.phone ?? '—'],
                              ['Email', g.email ?? '—'],
                              ['Address', g.address ?? '—'],
                              ['Payout bank', g.payoutBank ?? '—'],
                              [
                                'Payout A/c',
                                g.payoutAccount
                                  ? `${g.payoutAccount}${g.payoutIfsc ? ` · ${g.payoutIfsc}` : ''}`
                                  : '—',
                              ],
                            ].map(([k, v]) => (
                              <span key={k}>
                                <span className="block text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">
                                  {k}
                                </span>
                                <span className="break-words">{v}</span>
                              </span>
                            ))}
                          </div>

                          {/* their maturities */}
                          {g.cases.map((c) => {
                            const plan = buildPlanRow(c, instalments, cal, today);
                            const state = settlementOf(c);
                            const caseOpen = Boolean(openCase[c.caseId]);
                            return (
                              <div
                                key={c.caseId}
                                className="rounded-[10px] border border-[var(--hairline)] bg-[var(--page-bg)]"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenCase((s) => ({ ...s, [c.caseId]: !s[c.caseId] }))
                                  }
                                  aria-expanded={caseOpen}
                                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                                >
                                  <ChevronRight
                                    className={cn(
                                      'h-3.5 w-3.5 shrink-0 text-[var(--faint-fg)] transition-transform',
                                      caseOpen && 'rotate-90',
                                    )}
                                  />
                                  <span className="min-w-0 flex-1 text-[0.75rem]">
                                    <span className="font-medium tabular-nums">{c.caseNumber}</span>
                                    {c.schemeName ? (
                                      <span className="text-[var(--faint-fg)]">
                                        {' '}
                                        · {c.schemeName}
                                      </span>
                                    ) : null}
                                    <span className="block text-[0.68rem] text-[var(--faint-fg)]">
                                      form in{' '}
                                      {c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'}
                                      {c.deadlineOn
                                        ? ` · due by ${formatDMY(c.deadlineOn)}`
                                        : ''} · {plan.parts} part{plan.parts === 1 ? '' : 's'}
                                      {plan.cadence === 'ALTERNATE'
                                        ? ', alternate days'
                                        : ', daily'}
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-3 text-[0.72rem] tabular-nums">
                                    <span>{inr(BigInt(c.maturityAmountPaise))}</span>
                                    <span className="text-[var(--color-money-700)] dark:text-[var(--color-money-400)]">
                                      {inr(paidOf(c))}
                                    </span>
                                    <span className="font-semibold">{inr(leftOf(c))}</span>
                                    <Badge tone={TONE[state]}>{SETTLEMENT_LABEL[state]}</Badge>
                                  </span>
                                </button>

                                {caseOpen && (
                                  <div className="border-t border-[var(--hairline)] px-3 py-2">
                                    {plan.error ? (
                                      <p className="text-[0.72rem] text-[var(--color-danger-600)] dark:text-[var(--color-danger-400)]">
                                        {plan.error}
                                      </p>
                                    ) : (
                                      <>
                                        <div className="mb-2 grid gap-1 rounded-[8px] bg-[var(--glass-bg-subtle)] p-2 text-[0.68rem] sm:grid-cols-3 lg:grid-cols-6">
                                          {[
                                            ['Maturity date', c.instrumentMaturityOn ? formatDMY(c.instrumentMaturityOn) : '—'],
                                            ['Form submission', c.formSubmittedOn ? formatDMY(c.formSubmittedOn) : '—'],
                                            ['Approval date', c.approvedOn ? formatDMY(c.approvedOn) : '—'],
                                            ['Payment starts', c.paymentOn ? formatDMY(c.paymentOn) : plan.days[0] ? formatDMY(plan.days[0].dueOn) : '—'],
                                            ['Final payment due', c.deadlineOn ? formatDMY(c.deadlineOn) : plan.days.at(-1) ? formatDMY(plan.days.at(-1)!.dueOn) : '—'],
                                            ['Payment pattern', `${plan.parts} parts · ${plan.cadence === 'ALTERNATE' ? 'alternate days' : 'daily'}`],
                                          ].map(([label, value]) => (
                                            <span key={label}>
                                              <span className="block text-[0.58rem] font-medium uppercase tracking-wide text-[var(--faint-fg)]">{label}</span>
                                              <span className="font-semibold tabular-nums">{value}</span>
                                            </span>
                                          ))}
                                        </div>
                                        <table className="w-full border-collapse text-[0.7rem]">
                                          <thead>
                                            <tr className="text-[0.62rem] uppercase tracking-wide text-[var(--faint-fg)]">
                                              <th className="py-1 pr-2 text-left font-medium">#</th>
                                              <th className="py-1 pr-2 text-left font-medium">
                                                Date
                                              </th>
                                              <th className="py-1 pr-2 text-right font-medium">
                                                Scheduled
                                              </th>
                                              <th className="py-1 pr-2 text-right font-medium">Cash</th>
                                              <th className="py-1 pr-2 text-right font-medium">Online</th>
                                              <th className="py-1 pr-2 text-right font-medium">Paid</th>
                                              <th className="py-1 text-left font-medium">State</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {plan.days.map((d) => (
                                              <tr
                                                key={d.seq}
                                                className={cn(
                                                  'border-t border-[var(--hairline)]',
                                                  DAY_STYLE[d.state],
                                                )}
                                              >
                                                <td className="py-1 pr-2 tabular-nums">{d.seq}</td>
                                                <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
                                                  {formatDMY(d.dueOn)}{' '}
                                                  <span className="text-[0.6rem] opacity-70">
                                                    {weekdayShort(d.dueOn)}
                                                  </span>
                                                </td>
                                                <td className="py-1 pr-2 text-right tabular-nums">
                                                  {inr(d.amountPaise)}
                                                </td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{inr(d.cashPaise)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{inr(d.onlinePaise)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{inr(d.paidPaise)}</td>
                                                <td className="py-1 text-[0.6rem] uppercase tracking-wide">
                                                  {d.state === 'PAID'
                                                    ? 'given'
                                                    : d.state === 'PARTIAL'
                                                      ? 'part given'
                                                      : d.state === 'DUE_TODAY'
                                                        ? 'today'
                                                        : d.state === 'OVERDUE'
                                                          ? 'missed'
                                                          : ''}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        <p className="pt-1.5 text-[0.62rem] text-[var(--faint-fg)]">
                                          {plan.isProjection
                                            ? 'Projected — real dates are set when the case is approved.'
                                            : `Approved ${plan.approvedOn ? formatDMY(plan.approvedOn) : ''}`}
                                        </p>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </Glass>
    </div>
  );
}
