# Compiled multi-branch register import

## Business rule

Azamgarh (`AZM`) is the head branch. Admin, CEO and CMD default to the compiled bank view and may
upload one workbook containing rows for several branches. Branch managers and cashiers see only
their assigned branch; agents see only their own portfolio. Auditor remains bank-wide read-only.

## Workbook routing

The Import screen has two explicit destinations:

- **All branches — auto-sort by Branch Code:** headquarters-only. Each row must contain `Branch
  Code` (recommended) or an exact `Branch Name`.
- **One branch:** supports the existing branch-specific `MATURITY.xlsx`; every row is assigned to
  the branch selected on screen.

Routing is exact, case-insensitive and punctuation-insensitive. It never uses partial/fuzzy name
matching and never creates a branch from spreadsheet text. A blank, unknown or ambiguous branch is
skipped and named in the result log instead of being guessed into Azamgarh.

The compiled template is `/api/export/template?scope=all`. It places `Branch Code` before the
normal register columns. After import, the screen reports created/skipped counts per branch.

## Data ownership and audit

Each maturity case, customer and imported agent is written with the resolved `branch_id`.
Customer account-number matching and generated agent records are branch-local. Each branch batch
runs in its own transaction and writes its own `data.imported` audit row. A failure cannot leave a
half-written branch batch; another branch already committed by the same upload remains auditable.

## Adding the next branch

1. Admin creates the branch under **Settings → Branches** with a unique short code.
2. Admin assigns branch users to that branch.
3. The new code appears automatically under **Active branch codes** on the Import screen.
4. Headquarters uses that exact code in compiled workbooks. No code deployment is required.

## Code map

- `src/lib/branch-routing.ts` — exact routing and the all-branches sentinel.
- `src/lib/excel-register.ts` — reads the optional Branch Code/Name column.
- `src/services/import-service.ts` — groups rows and imports/audits each branch.
- `src/actions/import.ts` — server-side headquarters authorization.
- `src/app/(app)/import/*` — destination picker, template and per-branch result UI.
- `src/lib/rbac.ts` — compiled HQ visibility versus branch/agent visibility.
