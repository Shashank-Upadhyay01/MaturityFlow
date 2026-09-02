# Production status — 1 September 2026

## Live service

| Item | Current value |
|---|---|
| Public URL | `https://kggnl.in` |
| Vercel alias | `https://maturityflow.vercel.app` |
| Vercel project | `maturityflow` / `prj_lbQSLCn1Pb3hlXoiBkq0O6hiRT6o` |
| Production branch | `payout-cadence-phase-1` |
| Database | Supabase project `maturityflow` (`fktcubdpsgutcvyfdozt`, ap-south-1) |
| Schema | 21 tables, migration 0008 applied |
| DNS | Hostinger apex A record points directly to Vercel |

Vercel is linked to GitHub and automatically creates a production deployment from every push to
`payout-cadence-phase-1`. Confirm the exact deployed SHA with:

```powershell
vercel inspect https://kggnl.in
vercel api '/v13/deployments/<deployment-id>'
```

The health endpoint is `https://kggnl.in/api/health`. A healthy response is
`{"status":"ok","database":"connected",...}`. On 1 September the endpoint and an authenticated
browser smoke test both passed with no client errors.

## Important release facts

- Vercel Framework Preset must remain **Next.js**. It was initially “Other”, which produced a
  green deployment whose application routes all returned 404.
- `origin/main` is the old laptop-only baseline. Do not change Vercel back to `main` until it has
  deliberately been fast-forwarded and verified.
- Register layouts now carry a version. Any layout saved before the Excel-grid release is upgraded
  once to the current Account / Customer / Agent / Maturity / Payment / Due / Recommended /
  Paid / Taken layout; subsequent Admin column customisation remains saved.
- Supabase Row Level Security and role grants were reviewed after migrations 0005–0008. The app
  role cannot update, delete or truncate `audit_log`.

## Before real money is moved

Claude's deployment handoff recorded that Supabase still contained the demo organisation/logins
and no maturity cases. Verify the production Register yourself before replacing any data. Never
run `npm run db:seed` against Supabase: it truncates first.

Still required for durable production operations:

1. Replace every surviving demo password, including the seed one.
2. Configure an independent scheduled `pg_dump` backup for Supabase and test a restore.
3. Configure an uptime monitor for `/api/health`.
4. Replace local-disk document storage in `src/lib/storage.ts` with Supabase Storage/S3 before
   staff upload customer documents. Vercel's filesystem is ephemeral.

## Domain and deployment troubleshooting

- A Ready deployment serving 404: verify Framework Preset = Next.js.
- Domain works but the app has an old layout: check the deployment SHA and the branch's saved
  layout version, then reload after the current production deployment is promoted.
- Login loops: production must have `APP_URL=https://kggnl.in` and `COOKIE_SECURE=true`.
- Database errors: inspect `/api/health`, Supabase project state, session-pooler credentials and
  the `mfapp` grants before changing application queries.

---

## Data cutover — completed 13:10 IST

The demo data is gone. Supabase now holds the real register, loaded through the MCP tunnel
(this session cannot open a Postgres connection, so it went a few hundred rows per call).

| | |
|---|---|
| Branch | Azamgarh (AZM) — org **Kashi Gomti Gramin Nidhi Limited** |
| Staff accounts | 8, real names and real password hashes from the laptop |
| Agents / customers | 14 / 18 |
| Maturity cases | 18, all APPROVED |
| Live payout schedules | **132 instalments across all 18 cases** |
| Case events | 90 |
| Holidays / counters / org settings | all present |

**INV-2 verified against the live database**: for all 18 cases,
`Σ(instalments) === maturity_amount`, exact to the paise. No mismatches.

Due this week — 1 Sep ₹1,46,000 (18 instalments) · 2 Sep ₹55,000 · 3 Sep ₹1,44,000 ·
4 Sep ₹52,000 · 7 Sep ₹1,40,000.

### Still to load — run `backups/finish-load.sql`

The connection password is not stored in this repository. Use the Supabase dashboard
password and the session-pooler URI from the project settings.

- `maturity_forecasts` — 373 rows, next month's forecast planning. Absent until this runs.
- `audit_log` — 1,896 rows of laptop history. The trail is live and recording from today
  regardless; this is back-history only.
- `payout_instalments` schedule versions 1 and 2 — ~240 superseded draft rows. Version 3, the
  live one, is fully loaded.

Every statement is `ON CONFLICT (id) DO NOTHING` — safe to run twice, skips what is already
there, one transaction. `public.sessions` is deliberately excluded: those are stale laptop login
tokens and must never be copied onto a public URL.

### SECURITY — before anyone else signs in

All 8 accounts still carry the seed password. That literal used to sit in
**README.md line 109** and three files under `docs/`, in a **public GitHub repository** that now
backs a public production site. Anyone who reads the repo can sign in as `cmd`, the top role.
Rotate every password, then remove the literal from the repo — and treat it as burned, because it
remains in git history.

## 2026-09-02 — data cutover finished (and deliberately part-finished)

`backups/finish-load.sql` had three sections. Only one of them belonged in production.

**Loaded — `maturity_forecasts`, 373 rows.** These are the real `Maturity.xlsx` import
(August and September sheets). Production held 24; it now holds 379, the extra six being
rows it already had under the same `source_key`. Loaded in 13 chunks through the Supabase
MCP, each `ON CONFLICT DO NOTHING` — note *without* a conflict target, because
`maturity_forecasts_source_uq` on `source_key` is a second unique index and
`ON CONFLICT (id)` would not have caught a clash there; one duplicate `source_key` would
have aborted the whole transaction.

**Skipped — `payout_instalments`, 374 rows.** Checking first was worth it. All 18 cases
in that section already exist in production, each already carrying a complete live
schedule *and* its superseded history, and INV-2 (Σ instalments = maturity amount) holds
for every one. The 132 `PENDING` rows in the file come from schedule versions that only
ever existed on the laptop; loading them would have added a second live schedule to each
case and broken INV-2 on all 18. The 242 `SUPERSEDED` rows are dead weight.

**Skipped — `audit_log`, 1,896 rows.** 1,431 of them were written by automated test
actors — Ops Tester, Ops Tester (Admin), Auto Tester, Cashier A/B — against Concurrency
Customer and similar fixtures. The audit trail is the compliance record; filling it with
test-suite noise costs more than the 471 genuine rows are worth, and those genuine rows
describe a database that has since diverged.

Verified after the load: 44 cases, 0 breaking INV-2.

## Production branch

Vercel deploys `payout-cadence-phase-1` to `https://kggnl.in`. Push that branch to publish.
