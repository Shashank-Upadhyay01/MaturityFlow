# ADR 0003 — The schedule is anchored to the approval date

> **Superseded by [ADR 0005](0005-schedule-anchored-to-maturity.md) on 2026-08-26.** The schedule
> is no longer anchored to approval; there is no approval step and no Operations Head. The anchor
> is the customer's maturity date plus three calendar days. The reasoning below is kept because
> the problem it identifies — two parties counting from two different dates — is real, and ADR 0005
> solves it by picking the date *both* parties already know rather than the one only the branch does.

**Status:** Superseded · **Date:** 2026-08-18

## Context

An agent submits a maturity form on one date. The Operations Head approves it on the same day, or
three days later, or next week. The money becomes payable at **approval**, because that is when
the transfer to the customer's account is authorised.

In the manual process these two dates blur together. The customer is told "12 to 15 days" when
they hand in the form; the branch counts from approval. Both sides then believe different
deadlines, and the argument that follows is unwinnable because there is no record of either date.

## Decision

`formSubmittedOn` and `approvedOn` are **separate, mandatory, audited columns**. The payout
schedule and the SLA clock are both anchored to `approvedOn`. A CHECK constraint forbids
`approvedOn < formSubmittedOn`.

The submission→approval lag is measured, displayed on the case, and reported per approver.

## Consequences

- The promise made to the customer is a date the system computed (`deadlineOn`), not a phrase.
- Approval delay becomes a **visible, separately-owned problem** rather than being absorbed into
  "the payout is late". The dashboard shows the total value sitting unapproved with the line
  *"every day here is a day the customer waits for nothing"*, because that is the honest framing.
- An Ops Head may back-date an approval to the day they actually signed — bounded by the
  submission date and today.
