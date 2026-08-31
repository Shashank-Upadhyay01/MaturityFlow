'use client';

import { AlertCircle, ArrowRight, Building2, CheckCircle2, Save, UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { createCaseAction, createCustomerAction } from '@/actions/cases';
import {
  SchedulePreview,
  type CalendarSnapshot,
} from '@/components/domain/schedule-preview';
import { Button } from '@/components/ui/button';
import { Field, Input, MoneyInput, SegmentedControl, Select, Stepper, Textarea } from '@/components/ui/field';
import { Glass, GlassCard } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { ROUNDING_STEPS, tryParseRupeesToPaise } from '@/lib/money';
import type { CashPolicy, Distribution } from '@/lib/payout-engine';
import { MIN_WINDOW_DAYS, scheduleAnchorFor } from '@/lib/payout-policy';
import { makeCalendar } from '@/lib/working-days';
import type { Role } from '@/db/schema';

interface Options {
  branches: {
    id: string;
    code: string;
    name: string;
    defaultRoundingPaise: string;
    defaultWindowDays: number;
    dailyCashComfortPaise: string;
  }[];
  agents: { id: string; code: string; name: string; branchId: string }[];
  customers: {
    id: string;
    name: string;
    phone: string | null;
    branchId: string;
    agentId: string | null;
    accountNumber: string | null;
  }[];
}

const DEFAULT_CALENDAR: CalendarSnapshot = {
  holidays: [],
  sundaysOff: true,
  saturdayRule: 'SECOND_FOURTH',
};

export function NewMaturityForm({
  session,
  options,
  calendars,
  today,
  canOverride,
}: {
  session: { role: Role; branchId: string | null; agentId: string | null };
  options: Options;
  calendars: Record<string, CalendarSnapshot>;
  today: string;
  canOverride: boolean;
}) {
  const router = useRouter();

  const [branchId, setBranchId] = useState(() => {
    const paying = options.branches.filter((b) => options.agents.some((a) => a.branchId === b.id));
    const pool = paying.length ? paying : options.branches;
    if (session.branchId && pool.some((b) => b.id === session.branchId)) return session.branchId;
    return pool[0]?.id ?? '';
  });
  const branch = options.branches.find((b) => b.id === branchId);

  const branchAgents = useMemo(
    () => options.agents.filter((a) => a.branchId === branchId),
    [options.agents, branchId],
  );
  const [agentId, setAgentId] = useState(session.agentId ?? branchAgents[0]?.id ?? '');

  const branchCustomers = useMemo(
    () => options.customers.filter((c) => c.branchId === branchId),
    [options.customers, branchId],
  );
  const [customerId, setCustomerId] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [showNewCustomer, setShowNewCustomer] = useState(
    () => options.customers.filter((c) => !session.agentId || !c.agentId || c.agentId === session.agentId).length === 0,
  );

  const [amount, setAmount] = useState('');
  const [instrumentMaturityOn, setInstrumentMaturityOn] = useState('');
  const [formSubmittedOn, setFormSubmittedOn] = useState(today);
  const [schemeName, setSchemeName] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [days, setDays] = useState(branch?.defaultWindowDays ?? 15);
  const [roundingPaise, setRoundingPaise] = useState(
    BigInt(branch?.defaultRoundingPaise ?? '100000'),
  );
  const [distribution, setDistribution] = useState<Distribution>('FRONT_LOADED');
  const [cashMode, setCashMode] = useState<CashPolicy['kind']>('CASH_ONLY');
  const [cashCap, setCashCap] = useState('20000');
  const [startNext, setStartNext] = useState(false);

  /** Switching branch adopts that branch's own policy — done here rather than in an effect
   *  so the state change is a direct consequence of the user's action. */
  function selectBranch(nextBranchId: string) {
    setBranchId(nextBranchId);
    const next = options.branches.find((b) => b.id === nextBranchId);
    if (!next) return;
    setDays(next.defaultWindowDays);
    setRoundingPaise(BigInt(next.defaultRoundingPaise));
    const agentsHere = options.agents.filter((a) => a.branchId === nextBranchId);
    if (!agentsHere.some((a) => a.id === agentId)) setAgentId(agentsHere[0]?.id ?? '');
    setCustomerId('');
    setCustomerQuery('');
  }

  const filteredCustomers = useMemo(() => {
    const pool = agentId ? branchCustomers.filter((c) => !c.agentId || c.agentId === agentId) : branchCustomers;
    const q = customerQuery.trim().toLowerCase();
    if (!q) return pool.slice(0, 60);
    return pool
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q))
      .slice(0, 60);
  }, [branchCustomers, agentId, customerQuery]);

  const totalPaise = tryParseRupeesToPaise(amount || '0');
  const cashCapPaise = tryParseRupeesToPaise(cashCap || '0') ?? 0n;

  const cashPolicy: CashPolicy =
    cashMode === 'CASH_CAP' ? { kind: 'CASH_CAP', cashCapPerDayPaise: cashCapPaise } : { kind: cashMode };

  const calendar = useMemo(() => calendars[branchId] ?? DEFAULT_CALENDAR, [branchId, calendars]);
  const previewAnchor = useMemo(() => {
    if (!instrumentMaturityOn) return today;
    return scheduleAnchorFor(
      instrumentMaturityOn,
      today,
      makeCalendar(calendar.holidays, {
        sundaysOff: calendar.sundaysOff,
        saturdayRule: calendar.saturdayRule,
      }),
    );
  }, [calendar, instrumentMaturityOn, today]);

  const [state, formAction, pending] = useActionState(createCaseAction, null);
  const [submitNow, setSubmitNow] = useState(true);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(`Maturity ${state.data.caseNumber} created`, {
        description: submitNow ? 'Scheduled — the payout dates are set.' : 'Saved as a draft.',
      });
      router.push(`/maturities/${state.data.id}`);
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const selectedCustomer = branchCustomers.find((c) => c.id === customerId);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
      {/* ── Form ───────────────────────────────────────────────────────── */}
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="branchId" value={branchId} />
        <input type="hidden" name="agentId" value={agentId} />
        <input type="hidden" name="customerId" value={customerId} />
        <input type="hidden" name="roundingPaise" value={roundingPaise.toString()} />
        <input type="hidden" name="distribution" value={distribution} />
        <input type="hidden" name="cashPolicy" value={cashMode} />
        <input type="hidden" name="windowDays" value={days} />
        <input type="hidden" name="startOnNextWorkingDay" value={startNext ? 'on' : ''} />
        <input type="hidden" name="submitNow" value={submitNow ? 'on' : ''} />
        {cashMode === 'CASH_CAP' && <input type="hidden" name="cashCapPerDay" value={cashCap} />}

        <GlassCard title="Who" subtitle="Branch, agent and the customer whose deposit has matured.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch" required error={fe.branchId} htmlFor="branch">
              <Select
                id="branch"
                value={branchId}
                onChange={(e) => selectBranch(e.target.value)}
                disabled={options.branches.length === 1}
              >
                {options.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Agent" required error={fe.agentId} htmlFor="agent">
              <Select
                id="agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={Boolean(session.agentId)}
              >
                <option value="">Choose an agent…</option>
                {branchAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4">
            <Field
              label="Customer"
              required
              error={fe.customerId}
              hint={
                selectedCustomer
                  ? `${selectedCustomer.phone ?? 'no phone on file'}${selectedCustomer.accountNumber ? ` · A/c ${selectedCustomer.accountNumber}` : ''}`
                  : 'Search by name or phone number'
              }
            >
              <div className="space-y-2">
                <Input
                  aria-label="Search customers by name or phone"
                  placeholder="Search customers…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                />
                <Select aria-label="Choose customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">
                    {filteredCustomers.length === 0 ? 'No matching customer' : 'Choose a customer…'}
                  </option>
                  {filteredCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </Field>
            <button
              type="button"
              onClick={() => setShowNewCustomer((v) => !v)}
              className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-[var(--color-brand-500)] hover:underline"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {showNewCustomer ? 'Cancel' : 'Add a customer who is not on the list'}
            </button>

            {showNewCustomer && (
              <NewCustomerInline
                branchId={branchId}
                agentId={agentId}
                onCreated={(c) => {
                  options.customers.push({
                    id: c.id,
                    name: c.name,
                    phone: null,
                    branchId,
                    agentId,
                    accountNumber: null,
                  });
                  setCustomerId(c.id);
                  setCustomerQuery(c.name);
                  setShowNewCustomer(false);
                }}
              />
            )}
          </div>
        </GlassCard>

        <GlassCard
          title="What"
          subtitle="The matured amount and the dates that control scheduling and record-keeping."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Maturity amount" required error={fe.maturityAmount} htmlFor="amount">
              <MoneyInput
                id="amount"
                name="maturityAmount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5,00,000"
                required
              />
            </Field>

            <Field
              label="Maturity date"
              required={submitNow}
              error={fe.instrumentMaturityOn}
              htmlFor="maturityOn"
              hint="Payouts begin three calendar days after this date, or today when that date has already passed."
            >
              <Input
                id="maturityOn"
                name="instrumentMaturityOn"
                type="date"
                value={instrumentMaturityOn}
                onChange={(e) => setInstrumentMaturityOn(e.target.value)}
                required={submitNow}
              />
            </Field>

            <Field
              label="Form submitted on"
              required
              error={fe.formSubmittedOn}
              htmlFor="submittedOn"
              hint="The date the agent handed in the form. The schedule is anchored to the maturity date, not to this."
            >
              <Input
                id="submittedOn"
                name="formSubmittedOn"
                type="date"
                value={formSubmittedOn}
                max={today}
                onChange={(e) => setFormSubmittedOn(e.target.value)}
                required
              />
            </Field>

            <Field label="Scheme" htmlFor="scheme">
              <Input
                id="scheme"
                name="schemeName"
                value={schemeName}
                onChange={(e) => setSchemeName(e.target.value)}
                placeholder="Fixed Deposit — 5 Year"
              />
            </Field>

            <Field label="Policy / receipt number" htmlFor="policy">
              <Input
                id="policy"
                name="policyNumber"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                placeholder="POL123456"
              />
            </Field>
          </div>
        </GlassCard>

        <GlassCard
          title="How it will be paid"
          subtitle="Set the window and the system does the arithmetic. Change anything and the plan on the right updates instantly."
        >
          <div className="space-y-5">
            <Field
              label="Give the full amount within"
              hint="Counted in working days — Sundays, 2nd/4th Saturdays and bank holidays are skipped."
            >
              <Stepper value={days} onChange={setDays} min={MIN_WINDOW_DAYS} max={60} suffix="working days" label="days" />
            </Field>

            <Field
              label="Round each day's payout to"
              hint="Every instalment is a whole multiple of this. The remainder lands on the final day."
            >
              <SegmentedControl
                value={roundingPaise.toString()}
                onChange={(v) => setRoundingPaise(BigInt(v))}
                options={ROUNDING_STEPS.map((s) => ({ value: s.paise.toString(), label: s.label }))}
                size="sm"
              />
            </Field>

            <Field label="How is it handed over?">
              <SegmentedControl
                value={cashMode}
                onChange={(v) => setCashMode(v as CashPolicy['kind'])}
                options={[
                  { value: 'CASH_ONLY', label: 'All cash' },
                  { value: 'CASH_CAP', label: 'Cash up to a limit' },
                  { value: 'ONLINE_ONLY', label: 'All online' },
                ]}
              />
            </Field>

            {cashMode === 'CASH_CAP' && (
              <Field
                label="Maximum cash per day"
                error={fe.cashCapPerDay}
                hint="Anything above this on a given day is scheduled as an online transfer."
              >
                <MoneyInput
                  value={cashCap}
                  onChange={(e) => setCashCap(e.target.value)}
                  placeholder="20,000"
                />
              </Field>
            )}

            {canOverride && (
              <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
                <Field
                  label="Heavier days sit"
                  hint="Front-loaded gives the customer more money earlier."
                >
                  <SegmentedControl
                    value={distribution}
                    onChange={(v) => setDistribution(v as Distribution)}
                    options={[
                      { value: 'FRONT_LOADED', label: 'Early' },
                      { value: 'EVEN', label: 'Spread' },
                      { value: 'BACK_LOADED', label: 'Late' },
                    ]}
                    size="sm"
                  />
                </Field>
                <Field label="First payout" hint="Approval day itself, or the next working day.">
                  <SegmentedControl
                    value={startNext ? 'next' : 'same'}
                    onChange={(v) => setStartNext(v === 'next')}
                    options={[
                      { value: 'same', label: 'On approval day' },
                      { value: 'next', label: 'Next working day' },
                    ]}
                    size="sm"
                  />
                </Field>
              </div>
            )}

            <Field label="Notes" htmlFor="notes">
              <Textarea
                id="notes"
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the approver should know…"
              />
            </Field>
          </div>
        </GlassCard>

        {state && !state.ok && (
          <Callout tone="danger" icon={<AlertCircle className="h-4 w-4 text-[var(--color-danger-500)]" />}>
            {state.error}
          </Callout>
        )}

        <Glass className="sticky bottom-4 z-20 flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1 text-[0.8125rem] text-[var(--muted-fg)]">
            {submitNow
              ? 'This schedules the payouts straight away.'
              : 'Saved as a draft — you can submit it later.'}
          </div>
          <Button
            type="submit"
            variant="glass"
            onClick={() => setSubmitNow(false)}
            disabled={pending || !customerId || !agentId}
          >
            <Save className="h-4 w-4" />
            Save draft
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={pending}
            onClick={() => setSubmitNow(true)}
            disabled={!customerId || !agentId || !instrumentMaturityOn || !totalPaise || totalPaise <= 0n}
          >
            Submit &amp; schedule
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Glass>
      </form>

      {/* ── Live preview ───────────────────────────────────────────────── */}
      <div className="xl:sticky xl:top-20 xl:self-start">
        <SchedulePreview
          title="Live payout plan"
          input={{
            totalPaise: instrumentMaturityOn ? totalPaise : null,
            days,
            roundingPaise,
            startDate: previewAnchor,
            distribution,
            cashPolicy,
            startOnNextWorkingDay: startNext,
            calendar,
          }}
        />
        <p className="mt-3 flex items-start gap-2 px-1 text-[0.75rem] leading-relaxed text-[var(--faint-fg)]">
          <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The schedule is anchored to the customer&rsquo;s maturity date plus three days, rolled to
          the next day the counter is open. A maturity already in the past starts from today.
        </p>
      </div>
    </div>
  );
}

function NewCustomerInline({
  branchId,
  agentId,
  onCreated,
}: {
  branchId: string;
  agentId: string;
  onCreated: (c: { id: string; name: string }) => void;
}) {
  const [state, action, pending] = useActionState(createCustomerAction, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      toast.success(`${state.data.name} added`);
      onCreated(state.data);
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <div className="mf-fade mt-3 rounded-[15px] border border-dashed border-[var(--input-border)] p-4">
      <p className="mb-3 flex items-center gap-2 text-[0.8125rem] font-semibold">
        <Users className="h-4 w-4 text-[var(--color-brand-500)]" />
        New customer
      </p>
      {/* Nested <form> is invalid HTML — these fields post through their own action. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="__name" id="nc-name" aria-label="Customer full name" placeholder="Full name" />
        <Input name="__phone" id="nc-phone" aria-label="Customer phone" placeholder="Phone" />
        <Input name="__account" id="nc-account" aria-label="Customer account number" placeholder="Account number" />
        <Input name="__bank" id="nc-bank" aria-label="Customer payout bank" placeholder="Payout bank (for online legs)" />
      </div>
      <Button
        type="button"
        variant="glass"
        size="sm"
        className="mt-3"
        loading={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set('name', (document.getElementById('nc-name') as HTMLInputElement)?.value ?? '');
          fd.set('phone', (document.getElementById('nc-phone') as HTMLInputElement)?.value ?? '');
          fd.set('accountNumber', (document.getElementById('nc-account') as HTMLInputElement)?.value ?? '');
          fd.set('payoutBank', (document.getElementById('nc-bank') as HTMLInputElement)?.value ?? '');
          fd.set('branchId', branchId);
          fd.set('agentId', agentId);
          action(fd);
        }}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Add customer
      </Button>
    </div>
  );
}
