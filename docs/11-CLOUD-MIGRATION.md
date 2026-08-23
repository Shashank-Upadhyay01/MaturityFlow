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

Do these in order. Each step is small; the risk is in the sequence, not the individual commands.

### 2.1 — Stand up managed Postgres

1. Create a project on [Neon](https://neon.tech) or [Supabase](https://supabase.com) (either is
   fine; both are Postgres 16-compatible).
2. Copy its **pooled** connection string. On Supabase that is the "Transaction pooler" URL (port
   `6543`); on Neon it is the "Pooled connection" endpoint. It will contain `sslmode=require` — the
   app's pool (`src/db/index.ts`) already turns TLS on automatically when it sees that.
3. Point a **local** shell at it and create the schema there:

   ```bash
   DATABASE_URL="postgresql://…pooled…?sslmode=require" npm run db:migrate
   ```

   Do **not** run `db:seed` against a database that will hold real data — it truncates every table
   first. Seed only if this cloud DB is a demo.

> **Why the pooled string, and why this matters on Vercel.** Each Vercel serverless invocation can
> spin up its own `pg` pool. Against a raw Postgres endpoint that exhausts the connection limit fast.
> The provider's pooler (pgBouncer) fixes this. Also set **`DB_POOL_MAX=1`** in the Vercel env
> (below): on serverless you want one connection per function instance, not twenty. The `max: 20`
> default in `src/db/index.ts` is sized for the single LAN server, not for many serverless workers.

### 2.2 — Move document storage off local disk

This is **the only code change** the cloud move needs, and it is isolated to one file.

- Documents are written and read through `src/lib/storage.ts` (its pure, tested half is
  `src/lib/storage-rules.ts` — leave that alone). On Vercel the filesystem is **ephemeral and
  read-only** at runtime, so local-disk storage silently loses every upload. It must go to blob.
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
   | `DATABASE_URL` | the pooled managed-Postgres string from 2.1 |
   | `DB_POOL_MAX` | `1` |
   | `SESSION_SECRET` | a fresh `openssl rand -base64 48` (do **not** reuse the laptop's) |
   | `SESSION_TTL_HOURS` | `12` |
   | `APP_URL` | the Vercel URL, e.g. `https://maturityflow.vercel.app` (https) |
   | `COOKIE_SECURE` | `true` (it's https now — the LAN's `false` was only for plain HTTP) |
   | `APP_TIMEZONE` | `Asia/Kolkata` |
   | `NODE_ENV` | `production` |
   | `STORAGE_*` | the blob bucket credentials from 2.2 |

3. Deploy. Vercel builds the same repo you build locally.
4. Check `https://<your-app>/api/health` returns OK, then sign in.

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

- [ ] Phase 1 gates green (`typecheck`, `test`, `test:db`, `build`)
- [ ] Repo pushed to GitHub
- [ ] Managed Postgres created; `db:migrate` run against it (pooled string, `sslmode=require`)
- [ ] `src/lib/storage.ts` swapped to blob (Vercel path) — or VPS path chosen to defer it
- [ ] Vercel env vars set (fresh `SESSION_SECRET`, `DB_POOL_MAX=1`, `COOKIE_SECURE=true`, `STORAGE_*`)
- [ ] `/api/health` OK on the cloud URL; sign-in works
- [ ] Users cut over; laptop demoted to dev box; `start-lan.bat` stopped
