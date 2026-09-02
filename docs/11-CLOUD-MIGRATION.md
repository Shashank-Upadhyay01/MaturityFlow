# Cloud migration — laptop → 24/7 URL

The runbook for taking MaturityFlow from "runs on this laptop" to "runs in the cloud, all day,
without this laptop." Read this alongside [`07-DEPLOYMENT.md`](07-DEPLOYMENT.md), which has the raw
commands; this file is the *ordering and the reasoning*.

---

## The one thing to understand first

MaturityFlow is **a single full-stack Next.js app** — the pages, the server actions, and the API
routes are one deployable unit. There is no separate "frontend" you can put online while the
"backend" stays on the laptop. So the mental model of "get a URL first, move the backend later"
doesn't map onto this app. What *is* separable is the **database** and the **document files**.

That gives three moving parts:

| Part | Today (laptop) | In the cloud |
|---|---|---|
| **The app** (pages + server actions + API) | `npm run dev` / `start-lan.bat` | Vercel |
| **The database** (Postgres) | Docker on this laptop | Neon or Supabase (managed Postgres) |
| **Documents** (uploaded KYC/maturity scans) | local disk under `STORAGE_ROOT` | S3 / Azure Blob |

And one rule that forces their ordering: **a Vercel app cannot reach a database running on your
laptop** (your laptop has no public address and sits behind your router). So the moment the app
goes to Vercel, the database must already be somewhere the app can reach. **The URL and the managed
database move together.** They are one phase, not two.

---

## Phase 1 — now: the laptop is both dev box and host

Nothing to migrate yet. This is the current state and it is a legitimate way to run for a branch or
two:

- **You develop** with `npm run dev` on `http://localhost:3000`.
- **Branches use it** over the LAN via `start-lan.bat` (build + `next start` on port 3000).
- **Postgres** runs in Docker here (`docker compose up -d db`).

Everything the app needs that differs between machines lives in `.env` — `DATABASE_URL`,
`SESSION_SECRET`, `APP_URL`, `COOKIE_SECURE`, `STORAGE_ROOT`. That is what makes Phase 2 mostly a
matter of setting those five somewhere else.

**Before you leave Phase 1**, make sure these are green — they are what protect the money and the
two-cashiers-at-once safety:

```bash
npm run typecheck
npm test
npm run test:db      # needs a running Postgres
npm run build
```

---

## Phase 2 — the cloud: app on Vercel, database on Neon/Supabase, docs on blob

> **⏸️ PAUSED — resume only when the user says "deploy to cloud".** Phase 1 (laptop/localhost) is
> the current focus. Cloud deployment was scaffolded on 2026-08-23 and then intentionally paused.
> **Nothing below needs redoing** — here is the exact saved state and where to pick up:
>
> - **Supabase DB** — `maturityflow` (`fktcubdpsgutcvyfdozt`, ap-south-1), schema synced (0004
>   applied), 10 demo logins. ✅
> - **Vercel project** — `maturityflow` under `shashank-upadhyay01s-projects`
>   (`prj_lbQSLCn1Pb3hlXoiBkq0O6hiRT6o`), created + linked (`.vercel/`), with these **production**
>   env vars already set: `SESSION_SECRET`, `DB_POOL_MAX=1`, `SESSION_TTL_HOURS=12`,
>   `APP_TIMEZONE=Asia/Kolkata`, `COOKIE_SECURE=true`. ✅
> - **To resume (only 3 things left):** (1) a fresh Vercel token — the 2026-08-23 one was deleted and
>   should be revoked; (2) the Supabase Transaction-pooler `DATABASE_URL` → set it as the last env
>   var; (3) `vercel --prod`, then set `APP_URL` to the assigned URL and redeploy. Then verify
>   `/api/health`.
>
> Do these in order. Each step is small; the risk is in the sequence, not the individual commands.

### 2.1 — Managed Postgres — ALREADY DONE ✅

A Supabase project already exists and its schema is in sync with the app:

| | |
|---|---|
| **Project** | `maturityflow` |
| **Ref / ID** | `fktcubdpsgutcvyfdozt` |
| **Region** | `ap-south-1` (Mumbai) |
| **Postgres** | 17 |
| **Schema** | all 17 tables present (migration `0004` applied to it on 2026-08-23) |
| **Accounts** | 10 seeded demo logins, every role, valid bcrypt hashes — password set by `MF_SEED_PASSWORD` at seed time, not recorded here |
| **Data** | demo only (4 branches, holidays, settings; 0 real cases) — the real 107-case laptop register was **not** copied (it is customer PII; copy it deliberately, later, if you want it in the cloud) |

**The one thing to fetch yourself:** the connection string, because it contains the database
password, which no tool exposes. In the Supabase dashboard: **Project → Connect → Connection
pooling → Transaction mode**, and copy the URI. It looks like:

```
postgresql://postgres.fktcubdpsgutcvyfdozt:[YOUR-DB-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

The host contains `supabase`, so `src/db/index.ts` turns TLS on automatically — no `?sslmode=`
needed. If you ever forgot the DB password, reset it under **Project → Database → Settings**.

> **Why the pooled string, and why it matters on Vercel.** Each Vercel serverless invocation can
> spin up its own `pg` pool; against a raw endpoint that exhausts the connection limit fast. The
> Transaction-mode pooler (pgBouncer, port `6543`) fixes this. Also set **`DB_POOL_MAX=1`** in the
> Vercel env (below): on serverless you want one connection per function instance, not twenty. The
> `max: 20` default in `src/db/index.ts` is sized for the single LAN server. drizzle + node-postgres
> issue unnamed queries, so they are compatible with transaction-mode pooling. (If you ever hit a
> prepared-statement error, switch to the **Session** pooler on port `5432` instead.)

### 2.2 — Document storage — deferred, does NOT block the first deploy

There are **zero uploaded documents** today (`case_documents` is empty on both the laptop and the
cloud DB), and the core flow — maturity → approval → schedule → payout — never touches storage. So
you can deploy to Vercel now and wire blob storage later, before anyone uploads a KYC/maturity scan
in production. Until then, document *upload* is the only feature that won't work on Vercel (the
serverless filesystem is ephemeral); everything else works.

When you want it (it is **the only code change** the cloud move needs, isolated to one file):

- Documents are written and read through `src/lib/storage.ts` (its pure, tested half is
  `src/lib/storage-rules.ts` — leave that alone). On Vercel the filesystem is **ephemeral and
  read-only** at runtime, so local-disk storage silently loses every upload. It must go to blob.
- You already have Supabase — the natural choice is a **Supabase Storage** bucket (or S3 / Vercel
  Blob). Swap the disk implementation for the blob adapter, keeping the exported function
  signatures identical so nothing upstream changes; `serverActions.bodySizeLimit` in
  `next.config.ts` stays as-is.
- Swap the disk implementation in `src/lib/storage.ts` for an S3 or Azure Blob adapter (e.g. the AWS
  SDK `@aws-sdk/client-s3`, or Vercel Blob). Keep the exported function signatures identical so
  nothing upstream changes; `serverActions.bodySizeLimit` in `next.config.ts` stays as-is.
- Add the bucket's credentials to the env (`STORAGE_*` keys of your choosing) and read them in the
  adapter instead of `STORAGE_ROOT`.
- Run `npm test` — `tests/storage-rules.test.ts` still covers the pure rules; if you add adapter
  logic, test the seam.

> If you are **not ready to touch code yet**, use the VPS path below instead — it keeps local-disk
> storage working — and come back to blob when you decompose.

### 2.3 — Deploy the app to Vercel

1. Push the repo to GitHub (already done — `github.com/Shashank-Upadhyay01/MaturityFlow`) and import
   it into Vercel. Framework preset: **Next.js**, no build overrides needed.
2. Set the environment variables in Vercel (Project → Settings → Environment Variables):

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the pooled Supabase string from 2.1 (Transaction pooler, `:6543`) |
   | `DB_POOL_MAX` | `1` |
   | `SESSION_SECRET` | a fresh 48-byte base64 secret — `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` — **not** the laptop's |
   | `SESSION_TTL_HOURS` | `12` |
   | `APP_URL` | the Vercel URL (fill in after the first deploy assigns it, e.g. `https://maturityflow.vercel.app`), then redeploy |
   | `COOKIE_SECURE` | `true` (it's https now — the LAN's `false` was only for plain HTTP) |
   | `APP_TIMEZONE` | `Asia/Kolkata` |
   | `NODE_ENV` | `production` |
   | `STORAGE_ROOT` | `./storage` — placeholder; only document *upload* uses it, and that's deferred (2.2) |

3. Deploy. Vercel builds the same repo you build locally.
4. Check `https://<your-app>/api/health` returns `{"status":"ok","database":"connected"}`, then sign
   in with any seeded account.

### 2.4 — Cut over

- Point users at the Vercel URL. Stop running `start-lan.bat` on the laptop.
- The laptop is now **purely a development box**: `npm run dev` against local Docker Postgres,
  push to GitHub, Vercel redeploys automatically.
- Keep the laptop's Docker Postgres for development, but production data now lives in the managed
  database and is backed up by the provider.

**Rollback:** if anything is wrong, the laptop + `start-lan.bat` still work unchanged — you have
lost nothing by trying Vercel. Point branches back at the LAN address until the cloud issue is
fixed.

---

## Alternative — one cloud VPS (if you'd rather move the whole stack as-is)

If you prefer the literal "lift the entire backend to the cloud" and want **zero code change now**
(local-disk documents keep working), rent a small Linux VM and run the existing Docker stack on it:

```bash
SESSION_SECRET="$(openssl rand -base64 48)" docker compose --profile full up -d --build
```

This brings up Postgres **and** the app together on the VM, with the `/api/health` healthcheck and
named volumes for the database and uploaded documents (see `docker-compose.yml`). Put TLS in front
with nginx or a managed load balancer (config in [`07-DEPLOYMENT.md`](07-DEPLOYMENT.md)) and set
`APP_URL` to the public https address with `COOKIE_SECURE=true`.

Trade-off: you own the box — OS patching, Postgres backups, and uptime are yours, not a provider's.
It is the smoothest lift from today's architecture, and you can decompose to Vercel + managed
Postgres + blob later without redoing the app. Choose this if you want to move *now* and defer the
storage code change; choose Vercel (above) for the least operational burden long-term.

---

## Checklist

- [x] Phase 1 gates green (`typecheck`, `lint`, `test` 191✓, `test:db` 5✓, `build`)
- [x] Repo pushed to GitHub
- [x] Managed Postgres ready — Supabase `maturityflow` (`fktcubdpsgutcvyfdozt`, ap-south-1), schema
      synced (migration `0004` applied), 10 demo logins verified
- [ ] **You:** copy the Transaction-pooler `DATABASE_URL` from the Supabase dashboard
- [ ] **You:** import the repo into Vercel and set the env vars (table in 2.3)
- [ ] `/api/health` OK on the cloud URL; sign-in works
- [ ] Users cut over; laptop demoted to dev box; `start-lan.bat` stopped
- [ ] *(later)* `src/lib/storage.ts` swapped to Supabase Storage / S3 blob before uploading real docs
- [ ] *(optional)* copy the real 107-case laptop register into the cloud DB, if wanted (it's PII)
