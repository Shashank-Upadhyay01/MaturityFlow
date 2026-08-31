# Upcoming maturity forecast

The supplied `Maturity.xlsx` is a forecast, not a submitted payout register. It has no form
submission date, so its rows must never be inserted into `maturity_cases` with an invented date.
They live in `maturity_forecasts` until the real form arrives.

## Imported source (2026-08-29)

- Original: `C:\Users\Admin\Downloads\Maturity.xlsx`
- SHA-256: `93d0d33fb81d3842e5e0e3dfed6b761415b823626390af14eaea2eb13eff4bb1`
- Branch: `AZM — Azamgarh` (head branch; the workbook contains no branch column)
- August 2026: 18 customer rows, maturity total ₹11,57,315.00
- September 2026: 355 customer rows, current maturity total ₹2,88,32,855.10
- The September footer total row is not a customer and is deliberately skipped.

### Amount-source rule

- **August only:** use the manually entered `MaturityAmount` column. The user confirmed it already
  includes the 8.50% interest and completed this column because most calculated current-maturity
  values were missing.
- **September and later:** use `Current Maturity Amount` (with the parser's compatibility fallbacks
  only when that column is absent).

### August date rule

All 18 rows from the supplied August 2026 worksheet use **29-08-2026** as their maturity date,
as instructed by the user. The parser applies this correction when re-importing that August sheet;
September and later dates remain exactly as supplied.

All 373 rows were loaded through `importMaturityForecast()`, which stores money as integer paise,
uses a stable source key for idempotent re-imports, replaces rows removed from a later version of
the same workbook, and writes one `data.imported` audit entry in the same transaction.

## UI and import

- **Maturity calendar** shows Current month and Next month as separate selections, with counts,
  totals and a paginated customer table.
- **Import register → Upcoming maturity forecast** accepts monthly workbooks with `MaturityDate`
  and maturity amounts, applies the August-only source rule above, reads every monthly worksheet
  and imports into the selected branch.
- The normal payout-register importer remains separate because it requires Form Submission Date.

## Explicit testing activation

Forecast rows do not drive payouts by themselves. When the user explicitly authorised the August
2026 dataset for end-to-end testing, `scripts/activate-maturity-forecast.ts` promoted those rows
through the normal audited `createCase({ submitNow: true })` path. It creates missing agents and
customers, skips an already-matching active case, and generates the same schedules used everywhere
else. The actual activation date is stored as `formSubmittedOn`; no historical form date is invented.

With maturity date 29-08-2026, the promised date is 01-09-2026 (maturity + 3 calendar days). The
bank's existing month-open rule closes 1–3 September, so `scheduleAnchorFor()` correctly rolls the
first actual payout to **04-09-2026**. These scheduled cases now feed the Register, Payout Desk,
Cash Runway, dashboards, agent/customer books and reports.

## Code map

- `src/db/schema.ts` — `maturity_forecasts`, money in bigint paise.
- `src/lib/maturity-forecast.ts` — pure multi-sheet parser; cached Excel formula results supported.
- `src/services/forecast-service.ts` — audited idempotent import and role/branch-scoped month query.
- `src/app/(app)/maturity-calendar/page.tsx` — current/next month UI.
- `scripts/import-maturity-forecast.ts` — audited operator import using the same service.
- `scripts/activate-maturity-forecast.ts` — explicit idempotent forecast-to-case testing activation.
- `src/services/forecast-activation-service.ts` — audited fan-out through the real case scheduler.
- `artifacts/Maturity-normalized.xlsx` — cleaned source copy with separate Current/Next sheets.
