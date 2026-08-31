# ADR-0006: Model the daily cashbook as a separate event ledger

- Status: Accepted
- Date: 2026-08-27

## Context

The branch's working spreadsheet mixed independent amount columns, manual portal figures,
denomination counts and named obligations on one visual sheet. A literal database table with
spreadsheet row positions would preserve accidental layout rather than business meaning. It
would also make a Renewal entered in cash appear twice (Renewal plus Receiving) and invite double
counting.

The existing maturity register and `register_days` cannot own this state. Register close controls
maturity-specific approved-today amounts and has side effects that do not belong to a whole-
branch physical cash reconciliation.

## Decision

Create a separate branch/date aggregate (`cashbook_days`) with two child ledgers:

- `cashbook_entries` for ordinary category/channel movements;
- `cashbook_commitments` for named Given Cash, Due Amount and Pending Withdrawal items.

Store only independent inputs while open. Derive Receiving, By Account, category totals, expected
physical cash, counted cash, difference and portal variance with the shared pure BigInt module.

Use category plus channel so one Renewal record projects into both Renewal and the correct Cash
or By-account reporting total. Do not persist redundant derived totals.

Use an OPEN → CLOSE_REQUESTED → CLOSED maker–checker lifecycle. At final close, lock the day,
re-read its children, recompute on the server and store a string-only approved snapshot. Allow an
authorised reopen only with a reason and revision/audit history.

All cashbook child writers lock the parent day first. Every money write and lifecycle transition
is audited in the same transaction. Named items may be settled later without rewriting their
source day's approved cash snapshot.

## Consequences

- The user enters each movement once and every projection stays arithmetically consistent.
- Layout can evolve without database migrations for fake spreadsheet row relationships.
- Closed reports are stable even when carried obligations are later settled.
- Dashboard reporting can show gross branch shortages and excesses without net masking.
- The cashbook and maturity register can cross-check one another without being coupled.
- More tables and a close workflow are required, and legacy-sheet import will need an explicit
  mapping rather than copying cells verbatim.

## Rejected alternatives

**Reuse `register_days`.** Rejected because its close semantics and maturity-side effects are
unrelated to daily branch cash.

**One wide row with JSON arrays for every column.** Rejected because row-level validation,
locking, names, settlement, indexing and audit diffs would be weak.

**Store Receiving and By Account as independent inputs.** Rejected because a cash Renewal would
have to be typed twice and could disagree with itself.

**Block every non-zero difference.** Rejected because a real branch sometimes must close with a
documented discrepancy. The system requires a reason and independent confirmation instead of
encouraging clerks to falsify a count to reach zero.

**Automatically post files to messaging groups from the browser.** Rejected for v1. Browsers
cannot safely choose group destinations or attach files to WhatsApp/Telegram share URLs. Native
share plus download fallback is honest; official bot/business APIs can be added later with
credentials, destination control and audit.
