import {
  ArrowLeft,
  Banknote,
  CalendarCheck2,
  CalendarClock,
  FileText,
  Phone,
  Send,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Badge, CaseStatusBadge, InstalmentStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Glass, GlassCard, PageHeader } from '@/components/ui/glass';
import { Callout, KeyValue } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { Progress } from '@/components/ui/progress';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { getSession, toActor } from '@/lib/auth/session';
import { formatPaise, percentOf } from '@/lib/money';
import { roleCan } from '@/lib/rbac';
import { serialize } from '@/lib/serialize';
import { daysBetween, formatISODate, formatISODateShort, todayISO, weekdayShort } from '@/lib/working-days';
import { getCalendarSnapshot } from '@/services/calendar-service';
import { getCaseDetail } from '@/services/queries';
import { CaseActions } from './case-actions';
import { CaseDocuments } from './case-documents';
import { PaymentRows } from './payment-rows';
import { CaseTimeline } from './case-timeline';
import { ScheduleAdjust } from './schedule-adjust';
import { WindowReplan } from './window-replan';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return { title: 'Case' };
  const detail = await getCaseDetail(toActor(session), id);
  return { title: detail ? detail.c.caseNumber : 'Case' };
}

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect('/login');
  const { id } = await params;
  const detail = await getCaseDetail(toActor(session), id);
  if (!detail) notFound();

  const c = detail.c;
  const today = todayISO();
  const paid = c.paidCashPaise + c.paidOnlinePaise;
  const remaining = c.maturityAmountPaise - paid;
  const isLive = c.status === 'APPROVED' || c.status === 'IN_PROGRESS';
  const overdue = isLive && c.deadlineOn != null && c.deadlineOn < today && remaining > 0n;
  const reviewLag = c.opsReviewedOn ? daysBetween(c.formSubmittedOn, c.opsReviewedOn) : null;
  const daysLeft = c.deadlineOn ? daysBetween(today, c.deadlineOn) : null;

  const liveInstalments = detail.instalments.filter((i) => i.status !== 'SUPERSEDED');
  const calendar = await getCalendarSnapshot(c.branchId);
  const canOverride = roleCan(session.role, 'schedule.override');
  const canReplan = roleCan(session.role, 'schedule.reschedule');

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link href="/maturities">
            <ArrowLeft className="h-4 w-4" />
            All maturities
          </Link>
        </Button>
        <PageHeader
          eyebrow={`${detail.branch.code} · ${detail.branch.name}`}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {c.caseNumber}
              <CaseStatusBadge status={c.status} />
              {overdue && <Badge tone="danger">past the promised date</Badge>}
            </span>
          }
          description={`${detail.customer.name}${detail.customer.phone ? ` · ${detail.customer.phone}` : ''} · agent ${detail.agent.name}`}
          actions={
            <CaseActions
              caseId={c.id}
              status={c.status}
              hasPayments={paid > 0n}
              permissions={{
                hold: roleCan(session.role, 'case.hold'),
                cancel: roleCan(session.role, 'case.cancel'),
                reschedule: roleCan(session.role, 'schedule.reschedule'),
                submit: roleCan(session.role, 'case.submit'),
              }}
            />
          }
        />
      </div>

      {c.holdReason && (
        <Callout tone="warn" title="On hold">
          {c.holdReason}
        </Callout>
      )}
      {c.returnReason && c.status === 'RETURNED' && (
        <Callout tone="warn" title="Returned for correction">
          {c.returnReason}
        </Callout>
      )}
      {c.rejectionReason && (
        <Callout tone="danger" title="Rejected">
          {c.rejectionReason}
        </Callout>
      )}
      {overdue && (
        <Callout tone="danger" title="This case is past the date the bank promised">
          {formatPaise(remaining)} is still owed. It was due in full by{' '}
          {c.deadlineOn ? formatISODate(c.deadlineOn) : '—'}
          {roleCan(session.role, 'schedule.reschedule')
            ? ' — use "Re-plan remaining" to spread what is left over the days that are actually available.'
            : '.'}
        </Callout>
      )}

      {/* ── Money position ────────────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Glass className="mf-rise p-5">
          <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[var(--faint-fg)]">
            Maturity amount
          </p>
          <p className="mt-2 text-[1.875rem] font-semibold leading-none tracking-[-0.02em]">
            <Money paise={c.maturityAmountPaise} />
          </p>
          <Progress
            value={percentOf(paid, c.maturityAmountPaise)}
            className="mt-4"
            showLabel
            tone={paid >= c.maturityAmountPaise ? 'money' : overdue ? 'danger' : 'brand'}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-[0.875rem]">
            <div>
              <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">Given</p>
              <p className="mt-0.5 font-semibold">
                <Money paise={paid} tone="money" />
              </p>
            </div>
            <div>
              <p className="text-[0.6875rem] uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                Remaining
              </p>
              <p className="mt-0.5 font-semibold">
                <Money paise={remaining} tone={overdue ? 'danger' : 'default'} />
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-[0.8125rem] text-[var(--muted-fg)]">
            <p className="flex items-center gap-1.5">
              <Banknote className="h-3.5 w-3.5 text-[var(--color-money-500)]" />
              <Money paise={c.paidCashPaise} compact /> cash
            </p>
            <p className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-[var(--color-brand-500)]" />
              <Money paise={c.paidOnlinePaise} compact /> online
            </p>
          </div>
        </Glass>

        <GlassCard className="mf-rise lg:col-span-2" title="Maturity workflow dates">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[15px] border border-[var(--input-border)] p-4">
              <p className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                <CalendarClock className="h-3.5 w-3.5" /> Maturity date
              </p>
              <p className="mt-2 text-[1.05rem] font-semibold">
                {c.instrumentMaturityOn ? formatISODate(c.instrumentMaturityOn) : 'Not recorded'}
              </p>
              <p className="mt-1 text-[0.75rem] text-[var(--muted-fg)]">Day 1</p>
            </div>
            <div className="rounded-[15px] border border-[var(--input-border)] p-4">
              <p className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                <FileText className="h-3.5 w-3.5" />
                Form submitted
              </p>
              <p className="mt-2 text-[1.125rem] font-semibold">
                {formatISODate(c.formSubmittedOn)}
              </p>
              <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">
                Day 2 · by {detail.agent.name}
              </p>
            </div>

            <div
              className={`rounded-[15px] border p-4 ${
                c.opsReviewedOn
                  ? 'border-[color-mix(in_oklab,var(--color-money-500)_38%,transparent)] bg-[color-mix(in_oklab,var(--color-money-500)_8%,transparent)]'
                  : 'border-[color-mix(in_oklab,var(--color-warn-600)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-warn-600)_7%,transparent)]'
              }`}
            >
              <p className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
                <CalendarCheck2 className="h-3.5 w-3.5" />
                Operations approval
              </p>
              <p className="mt-2 text-[1.125rem] font-semibold">
                {c.opsReviewedOn ? formatISODate(c.opsReviewedOn) : 'Not manually reviewed'}
              </p>
              <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">
                {c.opsReviewedOn
                  ? `Day 3 · ${reviewLag === 0 ? 'same day as form' : `${reviewLag} day${reviewLag === 1 ? '' : 's'} after form`}`
                  : 'Automatic progression keeps payment on time.'}
              </p>
            </div>

            <div className="rounded-[15px] border border-[color-mix(in_oklab,var(--color-brand-500)_30%,transparent)] bg-[var(--color-brand-50)] p-4">
              <p className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--color-brand-700)]">
                <CalendarCheck2 className="h-3.5 w-3.5" /> Payment begins
              </p>
              <p className="mt-2 text-[1.05rem] font-semibold">
                {c.firstPayoutOn || c.paymentOn || c.approvedOn
                  ? formatISODate(c.firstPayoutOn ?? c.paymentOn ?? c.approvedOn!)
                  : 'Not scheduled'}
              </p>
              <p className="mt-1 text-[0.75rem] text-[var(--muted-fg)]">Day 4 · first withdrawal</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-4">
            <KeyValue label="Window">{c.windowDays} working days</KeyValue>
            <KeyValue label="Rounding">
              {formatPaise(c.roundingPaise, { decimals: false })}
            </KeyValue>
            <KeyValue label="Mode">
              {c.cashPolicy === 'CASH_ONLY'
                ? 'Cash only'
                : c.cashPolicy === 'ONLINE_ONLY'
                  ? 'Online only'
                  : `Cash up to ${formatPaise(c.cashCapPerDayPaise ?? 0n, { decimals: false })}/day`}
            </KeyValue>
            <KeyValue label="Promised by">
              {c.deadlineOn ? (
                <span className={overdue ? 'text-[var(--color-danger-500)]' : ''}>
                  {formatISODate(c.deadlineOn)}
                  {daysLeft != null && isLive && remaining > 0n && (
                    <span className="ml-1 text-[0.75rem] text-[var(--faint-fg)]">
                      ({daysLeft >= 0 ? `${daysLeft}d left` : `${-daysLeft}d late`})
                    </span>
                  )}
                </span>
              ) : (
                '—'
              )}
            </KeyValue>
          </div>
        </GlassCard>
      </section>

      {isLive && remaining > 0n && (
        <GlassCard
          className="mf-rise"
          title="Daily withdrawal plan"
          subtitle="Type the number of days. The same engine that writes the ledger shows the daily amount here — then apply or tweak individual days."
        >
          <WindowReplan
            caseId={c.id}
            remainingPaise={remaining.toString()}
            currentDays={c.windowDays}
            roundingPaise={c.roundingPaise.toString()}
            distribution={c.distribution}
            cashKind={c.cashPolicy}
            cashCapPaise={(c.cashCapPerDayPaise ?? 0n).toString()}
            calendar={calendar}
            today={today}
            canApply={canReplan}
          />
        </GlassCard>
      )}

      {/* ── Schedule ──────────────────────────────────────────────────── */}
      {liveInstalments.length > 0 ? (
        <GlassCard
          className="mf-rise"
          title="Payout schedule"
          subtitle={`${liveInstalments.length} instalments · generated at approval, version ${c.scheduleVersion}`}
          bodyClassName="p-0 sm:p-0"
        >
          <Table>
            <THead>
              <TH>Day</TH>
              <TH>Due</TH>
              <TH align="right">Planned</TH>
              <TH align="right">Cash</TH>
              <TH align="right">Online</TH>
              <TH align="right">Paid</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {liveInstalments.map((i) => {
                const instPaid = i.paidCashPaise + i.paidOnlinePaise;
                const isToday = i.dueOn === today;
                return (
                  <TR key={i.id} highlight={isToday}>
                    <TD className="text-[var(--muted-fg)]">
                      {i.seq}
                      {i.isFinal && (
                        <span className="ml-2 text-[0.625rem] font-semibold text-[var(--color-brand-500)]">
                          FINAL
                        </span>
                      )}
                    </TD>
                    <TD>
                      <span className="font-medium">{formatISODateShort(i.dueOn)}</span>{' '}
                      <span className="text-[0.75rem] text-[var(--faint-fg)]">
                        {weekdayShort(i.dueOn)}
                      </span>
                      {isToday && (
                        <Badge tone="brand" className="ml-2">
                          today
                        </Badge>
                      )}
                    </TD>
                    <TD align="right" className="font-semibold">
                      <Money paise={i.amountPaise} decimals={i.amountPaise % 100n !== 0n} />
                    </TD>
                    <TD align="right" className="text-[var(--muted-fg)]">
                      {i.cashLegPaise > 0n ? <Money paise={i.cashLegPaise} decimals={false} /> : '—'}
                    </TD>
                    <TD align="right" className="text-[var(--muted-fg)]">
                      {i.onlineLegPaise > 0n ? (
                        <Money paise={i.onlineLegPaise} decimals={false} />
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD align="right">
                      {instPaid > 0n ? <Money paise={instPaid} tone="money" /> : '—'}
                    </TD>
                    <TD>
                      <InstalmentStatusBadge status={i.status} />
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {canOverride && isLive && remaining > 0n && (
            <ScheduleAdjust
              caseId={c.id}
              roundingPaise={c.roundingPaise.toString()}
              rows={liveInstalments.map((i) => ({
                id: i.id,
                seq: i.seq,
                dueOn: i.dueOn,
                amountPaise: i.amountPaise.toString(),
                paidPaise: (i.paidCashPaise + i.paidOnlinePaise).toString(),
                status: i.status,
                isFinal: i.isFinal,
              }))}
            />
          )}
        </GlassCard>
      ) : (
        <GlassCard className="mf-rise" title="Payout schedule">
          <div className="flex items-start gap-3 text-[0.875rem] text-[var(--muted-fg)]">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-[var(--faint-fg)]" />
            <p>
              No schedule yet. One is generated the moment this case is submitted — anchored to the
              customer&rsquo;s maturity date plus three days, so the first payout is a date they can
              work out for themselves.
            </p>
          </div>
        </GlassCard>
      )}

      {/* ── Payments + timeline ───────────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <GlassCard
          className="mf-rise"
          title="Recorded payouts"
          subtitle={`${detail.transactions.length} entr${detail.transactions.length === 1 ? 'y' : 'ies'} · what actually went out`}
          bodyClassName="p-0 sm:p-0"
        >
          <PaymentRows
            canReverse={roleCan(session.role, 'payout.reverse')}
            payments={detail.transactions.map(({ t, recordedBy }) => ({
              id: t.id,
              cashPaise: t.cashPaise.toString(),
              onlinePaise: t.onlinePaise.toString(),
              totalPaise: t.totalPaise.toString(),
              reference: t.reference,
              valueDate: t.valueDate,
              reversedAt: t.reversedAt ? t.reversedAt.toISOString() : null,
              reversalReason: t.reversalReason,
              recordedByName: recordedBy?.name ?? null,
            }))}
          />
        </GlassCard>

        <GlassCard className="mf-rise" title="Case history" subtitle="Every step, in order.">
          <CaseTimeline events={serialize(detail.timeline)} />
        </GlassCard>
      </section>

      {/* ── Documents ─────────────────────────────────────────────────── */}
      <GlassCard
        className="mf-rise"
        title="Documents"
        subtitle="The maturity form and KYC papers, attached to the case rather than carried around in a folder."
      >
        <CaseDocuments
          caseId={c.id}
          canUpload={
            roleCan(session.role, 'case.edit') &&
            !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(c.status)
          }
          canVerify={roleCan(session.role, 'case.approve')}
          documents={detail.documents.map((d) => ({
            id: d.id,
            kind: d.kind,
            fileName: d.fileName,
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
            uploadedAt: d.uploadedAt.toISOString(),
            uploadedByName: d.uploadedByName,
            verifiedAt: d.verifiedAt ? d.verifiedAt.toISOString() : null,
            verifiedByName: d.verifiedByName,
          }))}
        />
      </GlassCard>

      {/* ── Customer ──────────────────────────────────────────────────── */}
      <GlassCard className="mf-rise" title="Customer &amp; instrument">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="Customer">
            <span className="flex items-center gap-2">
              <User className="h-4 w-4 text-[var(--faint-fg)]" />
              {detail.customer.name}
            </span>
          </KeyValue>
          <KeyValue label="Phone">
            {detail.customer.phone ? (
              <span className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-[var(--faint-fg)]" />
                {detail.customer.phone}
              </span>
            ) : (
              '—'
            )}
          </KeyValue>
          <KeyValue label="Account">{detail.customer.accountNumber ?? '—'}</KeyValue>
          <KeyValue label="Payout account">
            {detail.customer.payoutAccount
              ? `${detail.customer.payoutBank ?? ''} ${detail.customer.payoutAccount}`
              : '—'}
          </KeyValue>
          <KeyValue label="Scheme">{c.schemeName ?? '—'}</KeyValue>
          <KeyValue label="Policy number">{c.policyNumber ?? '—'}</KeyValue>
          <KeyValue label="Instrument matured on">
            {c.instrumentMaturityOn ? formatISODate(c.instrumentMaturityOn) : '—'}
          </KeyValue>
          <KeyValue label="Notes">{c.notes ?? '—'}</KeyValue>
        </div>
      </GlassCard>
    </div>
  );
}
