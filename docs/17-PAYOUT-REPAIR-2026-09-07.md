# Payout repair verification — 7 September 2026

## Changes prepared locally

- Register payment edits use bigint paise internally and decimal rupees at action inputs,
  including Taken. Custom payments update linked receipts and schedule balances under a case lock.
- Default recommendations are twelve working-day payouts at/above ₹1 lakh and six alternate
  calendar-day payouts below it, rolling closed days forward. A custom one-payment settlement is allowed.
- Explicit payment dates remain editable. Automatic first payment follows approval on the next open day.
- Form submission uses the audited scheduling path. Removing a form cannot discard an existing schedule/payment.
- Not taken remains visible in overdue follow-up. Payment/date changes retain transaction metadata and audit history.
- Customer/account identity checks prevent ambiguous reuse across customers or agents within a branch.
- Imports commit and report each row independently, allocate historical receipts, reject malformed values,
  and correctly detect repeated rows whose maturity date was blank.
- Settings → Operations Health diagnoses receipt/schedule/cache discrepancies and offers reason-required
  repair of safe derived totals. Conflicting receipts or schedules require investigation; it does not invent money.
- Customer and statement caches are invalidated with payout/register/case mutations.
- Due today badge counts the day's work, blank entry rows appear only under unfiltered All, and
  Still to give no longer subtracts paid receipts twice.

## Verification

- Full unit suite: 588 passed, one skipped, including 100,000 payout-engine fuzz cases.
- Database suite: 34 passed, including concurrent payments, schedule edits and import regressions.
- Typecheck and the final production build passed, including the final cache and filtered-row changes.
- Lint passes with existing warnings (including React Compiler/TanStack Virtual compatibility).
- `node scripts/check-repair-pages.mjs` checks local authenticated routes, customer expansion/statement,
  Due today badge consistency and browser runtime errors. All checks passed (eight routes, 24 matching
  Due today rows, customer expansion and statement, no runtime errors). It refuses non-local targets.
- The older `check-register.mjs` contains obsolete column/date assumptions and is not release evidence.

## Production boundary

Authenticated production Customers/Register/Dashboard were inspected read-only. These source changes
have not been deployed and no production financial records have been altered by this repair.
Existing production schedules are not automatically rewritten by a code deployment. Inspect Operations
Health after deployment and apply audited corrections per affected case. Preserve a database backup
and record the deployed commit before staff use the changed payout workflows.

Paid, remaining and schedule totals are linked quantities: changes must go through audited input or
receipt corrections. This work does not make arbitrary conflicting derived totals independently writable.
