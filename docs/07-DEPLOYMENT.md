# Deployment

The same build runs on a branch server today and on a managed host tomorrow. The only thing that
changes is `DATABASE_URL`.

---

## A. Local / on-premises — running tomorrow morning

**Requirements:** Node 20.11+ and Docker (or an existing PostgreSQL 16).

```bash
cp .env.example .env
# edit .env — at minimum set SESSION_SECRET:
#   openssl rand -base64 48

npm install
docker compose up -d db          # Postgres 16 on :5432
npm run db:migrate               # create the schema
npm run db:seed                  # demo data + logins (SKIP for a real go-live)
npm run build
npm start                        # http://localhost:3000
```

Or, in one command: `npm run setup && npm run build && npm start`

### Letting other branches reach it

The app listens on all interfaces. From another machine on the LAN:
`http://<server-ip>:3000`

Two things must be right:

1. **`APP_URL`** — set it to the address branches actually type,
   e.g. `APP_URL="http://192.168.1.50:3000"`.
2. **`COOKIE_SECURE`** — session cookies are marked `Secure` when `APP_URL` is https. Over plain
   HTTP on the LAN a `Secure` cookie is silently dropped and **nobody can sign in**. Either put
   TLS in front (recommended) or set `COOKIE_SECURE=false`.

### Running the whole stack in Docker

```bash
SESSION_SECRET="$(openssl rand -base64 48)" docker compose --profile full up -d --build
```

Brings up Postgres **and** the app, with a healthcheck on `/api/health` and named volumes for the
database and uploaded documents.

### Keeping it up

```bash
sudo npm i -g pm2
pm2 start npm --name maturityflow -- start
pm2 startup && pm2 save          # survives a reboot
```

### Behind nginx with TLS (do this before real money moves)

```nginx
server {
  listen 443 ssl http2;
  server_name maturity.yourbank.internal;
  ssl_certificate     /etc/ssl/certs/bank.crt;
  ssl_certificate_key /etc/ssl/private/bank.key;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proto_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Then set `APP_URL="https://maturity.yourbank.internal"` and remove `COOKIE_SECURE`.

---

## B. Cloud — no code changes

Managed Postgres (**Supabase**, **Neon**, **RDS**) + any Node host (**Vercel**, **Fly**,
**Render**, **Railway**).

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
SESSION_SECRET="<openssl rand -base64 48>"
APP_URL="https://maturity.yourbank.com"
NODE_ENV=production
```

`src/db/index.ts` turns TLS on automatically when the connection string mentions `sslmode=require`,
`supabase`, `neon.tech` or `rds.amazonaws`.

Then, once:

```bash
npm run db:migrate      # applies drizzle/*.sql to the managed database
```

On Vercel, add the env vars in the project settings and deploy. Everything is a Server Component
or Server Action, so there is nothing else to configure.

---

## C. Environment variables

| Variable | Required | Default | Notes |
|---|:-:|---|---|
| `DATABASE_URL` | ✔ | — | The one line that differs between local and cloud. |
| `SESSION_SECRET` | ✔ | — | ≥32 chars. `openssl rand -base64 48`. Rotating it signs everyone out. |
| `APP_URL` | | `http://localhost:3000` | Also decides the default for `COOKIE_SECURE`. |
| `COOKIE_SECURE` | | derived from `APP_URL` | **Set to `false` for plain-HTTP LAN deployments.** |
| `SESSION_TTL_HOURS` | | `12` | One banking day. |
| `APP_TIMEZONE` | | `Asia/Kolkata` | What "today" means for due dates. |
| `STORAGE_ROOT` | | `./storage` | Where case documents are written. |
| `DB_POOL_MAX` | | `20` | Database connections. Keep below Postgres `max_connections` (100 by default) across all app instances. |

The app **refuses to start** with a missing or too-short `SESSION_SECRET` (`src/lib/env.ts`). That
is deliberate: a bank system that boots with a broken secret is worse than one that will not boot.

---

## D. Going live for real

1. **Do not run `db:seed`.** It truncates every table and inserts demo data.
2. Create the real branches, then users, then agents, then customers — in that order (foreign keys).
3. Every seeded/created account starts with `mustChangePassword = true`; the app forces a change at
   first sign-in.
4. Put TLS in front and unset `COOKIE_SECURE`.
5. Set up database backups **before** the first real approval:
   ```bash
   pg_dump "$DATABASE_URL" | gzip > mf-$(date +%F).sql.gz
   ```
6. Point an uptime check at `/api/health` — it returns 503 when the database is unreachable.

## E. Upgrading

```bash
git pull
npm install
npm run db:migrate     # additive migrations only; never destructive
npm run build
pm2 restart maturityflow
```
