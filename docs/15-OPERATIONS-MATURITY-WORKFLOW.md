# Operations maturity workflow

## The 15-day rule

The customer-facing clock starts on the maturity date:

1. Day 1 — instrument maturity date.
2. Day 2 — form submission date.
3. Day 3 — Operations records its review. If nobody records it, the case is listed under
   **Maturities → Not reviewed** but payment is never delayed.
4. Day 4 — first payout date.
5. The 15-day policy window contains three processing days and twelve payout days. The existing
   amount-based cadence still applies: cases at or above ₹1,00,000 pay every working day; smaller
   cases pay on alternate working days inside the same window.

`approvedOn` is the schedule anchor retained for compatibility. It is not the Operations review
date. Human acknowledgement lives only in `opsReviewedOn`, `opsReviewedAt`, and
`opsReviewedById`.

## Editing dates safely

Admin and roles holding `case.approve` can edit the workflow dates from the Maturities grid.
Changing maturity amount, maturity date, payment date, or window rebuilds an unpaid schedule in
the same case-locked transaction and writes both an event and audit rows. Once payment has begun,
those schedule inputs are locked until the payout is reversed through the normal audited path.
Form and Operations-review dates remain record fields and do not move money.

An explicit payment date is an authorised month-opening exception for that schedule month; normal
automatic scheduling still observes holidays, weekends, and the first-three-days month-start
block.

## August 2026 test cohort

The 18 activated August rows are the clean manually completed cohort:

- Maturity: 29-08-2026
- Form submission: 30-08-2026
- Operations review: 31-08-2026
- Payment begins: 01-09-2026
- Window: 15 days

The idempotent, audited repair is `scripts/backfill-august-operations-dates.ts`.

## Screens

- **Register** is the cashier sheet: account, customer, agent, maturity amount, payment date, due
  payment, recommended payment, actual paid today/cash/online, and Taken/Not taken controls.
- **Maturities** is the Operations sheet. Its first tab is the editable workflow table; the second
  contains automatically progressed rows that still lack a human Operations acknowledgement.
- Case detail shows maturity, form, Operations review, payment start, money, schedule, documents,
  payouts, and the immutable timeline.

Admin retains every application permission and receives direct links to Register, Import, Audit,
and Settings from the Maturities workbench. “Deep control” never means unaudited raw database
writes or arbitrary table creation; money invariants and row-lock order remain mandatory.
