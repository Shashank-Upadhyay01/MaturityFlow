# ADR 0005 — The schedule is anchored to the maturity date, and approval is gone

**Status:** Accepted · **Date:** 2026-08-26 · **Supersedes:** [ADR 0003](0003-schedule-anchored-to-approval.md)

## Context

ADR 0003 anchored the payout schedule to `approvedOn` on the reasoning that money becomes payable
when an Operations Head authorises it. That was true of the manual process it described. It has
two costs that only became visible once the register held real cases.

**The customer cannot predict their own money.** "Twelve to fifteen days from approval" is not a
date anybody outside the branch can work out, because approval is an internal event with no fixed
relationship to anything the customer knows. The date they *do* know is their maturity date — it is
printed on the instrument.

**The queue does not clear itself.** 78 of the register's 81 cases sat in `SUBMITTED`, waiting.
Every one of them was a form that had been handed in, checked, and then parked pending a click
that nobody had a reason to prioritise. The approval step was not protecting anything: an Admin
could approve and then pay out the same case, so the maker-checker separation it nominally
provided already did not hold for the account that does most of the work.

## Decision

**There is no approval step, and no `OPS_HEAD` role.** Submitting a maturity generates its
schedule, in the same transaction, with the same audit row that approval used to write.

**The anchor is the customer's maturity date plus three CALENDAR days**, rolled forward to the next
day the counter is open. `scheduleAnchorFor()` in `src/lib/payout-policy.ts` is the single
definition.

Calendar days, not working days, on purpose: "three days after your maturity" is a promise the
customer can check on a wall calendar. Counting in working days would turn a Friday maturity into a
following-Wednesday payout because a weekend and a 2nd Saturday fell in between, and no customer
would accept that as "three days".

**The anchor is never earlier than today.** The register carries cases that matured as far back as
June 2024 and were never paid. Anchoring those on their own maturity date would write a schedule
that was overdue the moment it existed, with a deadline in the past and every instalment already
missed. `scheduleAnchorFor` takes the later of the promised date and today.

**A case with no maturity date is refused, not guessed at.** There is no honest default; any date
invented there puts real money on a day nobody agreed to.

### What survives, and why

**`approvedOn` stays as a column** — it holds the anchor and starts the SLA clock. What changed is
what writes it and what it means.

**`approvedById IS NULL` is how an auto-scheduled case is told apart from a historically approved
one.** Cases approved by a person before the cutover keep their approver; nothing rewrites history.

**`APPROVED` stays in `caseStatusEnum`** and is still the status a scheduled case holds, because
that is what it has always meant downstream: payable. **`OPS_HEAD` stays in `roleEnum`.** Postgres
has no `ALTER TYPE … DROP VALUE`; removing either would mean recreating the type and rewriting
every dependent column, risking history for no user-visible gain. Both are retired *in the
application* instead — not assignable, not in the permission matrix, no login path — which is the
same stance the register already takes for rows it cancels rather than deletes.

**`SUBMITTED` and `UNDER_REVIEW` stay in `ALLOWED_TRANSITIONS` as sources only.** Nothing moves a
case into them now, but rows written before the cutover must be able to leave.

`activeRole()` reads a stored `OPS_HEAD` as the `ADMIN` its account was migrated to. This is a
widening — the old role held 24 permissions and Admin holds all 29 — and it is deliberate: the one
account involved (`ops@bank.test`) was migrated to Admin in the same change.

## Consequences

**Good.** The customer and the branch can both work out the first payout date from the same public
fact. Nothing sits in a queue. One code path decides when money becomes payable, so the anchor
cannot drift between two doors into the same state — `createCase({ submitNow: true })` and
`submitCase()` share `scheduleCaseInTx`.

**The cost.** There is no longer any maker-checker control on the money path at all. Approval was
the only one, and for Admin it never applied. What remains is the audit row written in the same
transaction as every schedule and every payout, which makes the work reviewable after the fact
rather than preventable before it. If a second pair of eyes is wanted, it has to be built
deliberately rather than inherited from a workflow step nobody was using as a control.

**A window subtlety, recorded because it is easy to reintroduce.** `firstPayoutOn` spends its three
days in *calendar* days. The engine's `startOffsetWorkingDays` spends three more in *working* days.
Passing both counts the same gap twice and pushes every first payout about a week past the promise.
`persistSchedule` therefore passes `startOffsetWorkingDays: 0` and treats the anchor as day one.
`payoutPlanFor()` is untouched, so the instalment count and the money split do not move: still 12
daily or 6 alternate in a 15-day window.

The deadline follows the same logic. It is now the last instalment's own date, not
`deriveDeadline(anchor, windowDays)` — measuring a full window from an anchor that is already day
one would silently extend every promise by the processing days. The one place that still uses the
old formula is the reschedule path's fallback, which only fires for rows scheduled before this
change, where the old formula is the correct one.
