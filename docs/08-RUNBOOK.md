# Runbook

Day-to-day operations, and what to do when something looks wrong.

## Daily rhythm

| When | Who | What |
|---|---|---|
| Start of day | Branch Manager | **Cash planner** → confirm today's opening cash covers the cash legs due. Arrange any shortfall now. |
| Through the day | Ops Head | **Approvals** → clear the queue. Every day a form sits here is a day the customer waits for nothing. |
| Through the day | Cashier | **Payout desk** → record each disbursement as it happens, not at close. |
| End of day | Branch Manager | **Dashboard** → "Overdue instalments" should be 0. Anything there is tomorrow's angry phone call. |
| Weekly | Ops Head | **Reports** → export and check the approval lag per approver. |

## Common tasks

### A customer wants their money faster
Open the case → an Ops Head can **re-plan remaining** with a shorter window, or raise the cash cap.
The schedule regenerates; paid instalments are untouched.

### A payout was recorded wrongly
Ops Head / CEO / CMD → case detail → the transaction → **reverse** with a reason. The original row
stays in the ledger, flagged. Then record the correct amount. Nothing is ever deleted.

### A branch ran out of cash mid-day
Record what was actually paid (a partial is fine). Then **re-plan remaining** — the system spreads
the shortfall across the working days left before the promised date and tells you immediately if
that is no longer possible.

### A new bank holiday is announced
Settings → **Bank holidays** → add it. New schedules skip it at once. Existing schedules are not
retroactively moved — re-plan any case whose instalment now falls on the closed day.

### Somebody left the bank
Settings → **Users** → deactivate. Their live sessions are revoked immediately, not at token
expiry. Their historical actions remain in the audit log under their name.

### A customer disputes what they were paid
**Audit log**, filtered to that case: who recorded each payment, when, from which IP, and the
before/after balance. Plus the case timeline in plain English.

## Running it for the whole branch network

| | |
|---|---|
| Start it | `start-production.bat` (or `npm run build && npm start`) |
| Survive a reboot | `install-autostart.bat` — run as Administrator. Registers a scheduled task and opens TCP 3000 on the firewall. |
| Check it from the server | `check-health.bat` — prints every address branches can use and pings `/api/health` |
| Check it from a branch | open `http://<server-ip>:3000/api/health` in a browser |

Two cashiers **can** safely work the same case at the same moment: writes serialise on the case
row, and the second attempt on an already-settled instalment is refused with a clear message
rather than silently double-paying. See [`docs/01-ARCHITECTURE.md`](./01-ARCHITECTURE.md) § 6.

If many branches report slowness at once, check `DB_POOL_MAX` (default 20) against Postgres
`max_connections` (100 by default) before blaming the application.

## Diagnostics

| Symptom | Check |
|---|---|
| Nobody can sign in | `/api/health`. If `degraded`, the database is unreachable. If `ok`, check `COOKIE_SECURE` — a `Secure` cookie over plain HTTP is silently dropped. |
| "Session expired" immediately after signing in | `SESSION_SECRET` changed, or two app instances have different secrets. |
| A schedule looks wrong | It cannot be. `generateSchedule` asserts `Σ = total` at runtime and refuses to produce a schedule that fails. Check instead whether the case was rescheduled — look at `scheduleVersion` and the timeline. |
| Dates land on a Sunday | The branch's `sundaysOff` flag is off. Settings → Branches. |
| Overdue count keeps climbing | Payouts are happening but not being recorded, or the branch genuinely cannot pay. Compare "paid today" against the cash actually issued. |
| "This instalment is already fully paid" | Correct behaviour — somebody else just paid it. Refresh the Payout desk. |
| A document will not upload | Over 10 MB, or not a PDF/JPG/PNG/WEBP/HEIC/TIFF. Scan at a lower resolution. |
| Documents 404 after a server move | `STORAGE_ROOT` moved. The files live on the app server's disk — copy the `storage/` folder across with the database backup. |

## Verifying the ledger

Any of these returning a row means something is wrong. All should return zero rows.

```sql
-- INV-4: no case has been overpaid
SELECT case_number FROM maturity_cases
WHERE paid_cash_paise + paid_online_paise > maturity_amount_paise;

-- INV-3: every instalment's legs reconcile
SELECT id FROM payout_instalments
WHERE cash_leg_paise + online_leg_paise <> amount_paise;

-- INV-2: every live schedule sums to its case amount
SELECT c.case_number, c.maturity_amount_paise, SUM(i.amount_paise) AS scheduled
FROM maturity_cases c
JOIN payout_instalments i
  ON i.case_id = c.id AND i.schedule_version = c.schedule_version
WHERE c.schedule_version > 0
GROUP BY c.id, c.case_number, c.maturity_amount_paise
HAVING SUM(i.amount_paise) <> c.maturity_amount_paise;

-- Case totals agree with the transaction ledger
SELECT c.case_number
FROM maturity_cases c
LEFT JOIN (
  SELECT case_id, SUM(cash_paise) c, SUM(online_paise) o
  FROM payout_transactions WHERE reversed_at IS NULL GROUP BY case_id
) t ON t.case_id = c.id
WHERE c.paid_cash_paise <> COALESCE(t.c, 0) OR c.paid_online_paise <> COALESCE(t.o, 0);
```

The first two are additionally enforced by CHECK constraints, so they cannot go wrong even via
raw SQL.

## Backups

```bash
# nightly
pg_dump "$DATABASE_URL" | gzip > /backup/mf-$(date +%F).sql.gz

# restore
gunzip -c /backup/mf-2026-08-18.sql.gz | psql "$DATABASE_URL"
```

Test a restore into a scratch database once, before you need it.
