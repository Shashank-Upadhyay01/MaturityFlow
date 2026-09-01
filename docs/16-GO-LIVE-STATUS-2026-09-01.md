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

1. Replace every surviving demo password, including `Maturity@2026`.
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
