# MaturityFlow — go-live design (19 Aug 2026)

This is the working spec for tomorrow morning. It is not a rewrite. The engine, roles,
and screens already exist. This file is the checklist so nothing from the original
prompt is missed, and so dummy/slow/broken behaviour is not what gets shown.

---

## 1. The problem (one paragraph)

An agent submits a maturity form on date A. An Operations Head approves it on date B
(same day or later). Money only becomes payable on **B**. The customer is told
“within 12–15 days”, but nobody computes how much must leave the branch each day.
A ₹5,00,000 case gets the same window as a small one, daily cash per customer is
capped, and the branch discovers tomorrow’s cash need tomorrow. Agents and customers
get angry. The clock is often started at A instead of B.

## 2. The rule that fixes it

At the moment of approval the server writes an exact, day-by-day schedule.

- `Σ(instalments) === maturity amount` exactly (bigint paise, never floats).
- Each day is a round number. Remainder sits on the **last** working day.
- Days are **working days** (Sundays, 2nd/4th Saturdays, holidays skipped).
- Schedule is anchored to **approvedOn**, never form-submitted-on.
- Cash vs online is planned per day (cash-only, online-only, or cash cap).
- Cashiers record actuals against that plan. Over-payment is impossible.

The same pure function runs in the browser (live preview) and on the server
(persisted schedule). What you see is what gets stored.

## 3. Users

| Role | Who (this install) | Can do |
|---|---|---|
| CMD | Ravi Prakash Tiwari | Everything, every branch |
| CEO | Hareram Yadav | Everything except system-level audit deletion |
| ADMIN | Shashank Upadhyay | Users, branches, holidays. Cannot approve or pay |
| OPS_HEAD | Operations Head | Approve / reject / return; set schedule parameters |
| BRANCH_MANAGER | Hazratganj | Own branch: create, view, cash plan, pay |
| CASHIER | Hazratganj | Payout desk |
| AGENT | one per paying branch | Own customers only |
| AUDITOR | Auditor | Read-only, including audit log |

Seed logins all share whatever `MF_SEED_PASSWORD` was set to when the database was seeded. It is
deliberately not written down here — a password in the repository is a published password.

## 4. Screens vs the original list

| Asked for | Where it lives |
|---|---|
| Maturity amount, given-within days | New maturity + Approvals (live calculator) |
| Form submitted on / approved on | Case detail — two dates, never mixed |
| Cash / online / total given / remaining | Dashboard, case, payout desk |
| Today’s forms / today’s approvals | Dashboard |
| Agent name, maturities per agent | Agents, Reports |
| Per-branch maturity | Branches, Reports |
| Extra cash opening needed | Cash planner |
| Documents with the form | Case → Documents |
| Audit of every money action | Audit log |

## 5. Money safety (non-negotiable)

Already in code and in Postgres CHECK constraints. Do not weaken.

1. All money is `bigint` paise.
2. Schedule sum equals maturity amount, or the engine throws.
3. Client never sends instalment rows — only parameters.
4. Every write: `requireActor()` then `assertCan()`.
5. Money mutations write `audit_log` in the same transaction.
6. Writers lock the **case row first**.
7. Approval is idempotent.

## 6. What is *not* in v1 (say this if asked)

- Core banking does not execute the transfer. The cashier **records** cash/UTR.
- No SMS/WhatsApp to the customer.
- Documents sit on this PC (`STORAGE_ROOT`). One app instance only.
- Docker is installed but **not on PATH until Windows is restarted**. Local
  PostgreSQL 18 is already running and is what the app uses.

## 7. Current machine state

- App: `http://localhost:3000` (also `http://192.168.31.148:3000` on the LAN).
- Database: local PostgreSQL 18, `maturityflow` / `maturityflow`.
- Dummy customers, dummy cases, dummy payouts: **removed**.
- First open of a screen in `npm run dev` compiles (~10–20s). After that it is fast.

## 8. How to show it tomorrow (no dummy ledger)

1. Sign in as CMD (`cmd@bank.test`) — name must read **Ravi Prakash Tiwari**.
2. New maturity → add a **real** customer → type **500000** → days **15**.
   Screen must show 5 days of ₹34,000 then 10 days of ₹33,000, Σ = ₹5,00,000.
3. Submit → sign in as Ops Head → Approvals → approve. Schedule is written
   from **today**, not from the submission date if they differ.
4. Cash planner: tomorrow’s cash vs opening → extra cash to arrange.
5. Cashier: Payout desk → record today’s instalment.
6. Auditor: can read the audit log, cannot pay.

## 9. Remaining work before morning (execution, after you confirm)

1. Production start (`next build` + `next start`) so branches do not hit the
   10–20s compile delay.
2. Empty-state copy on dashboard / register / payouts so a clean ledger looks
   intentional, not broken.
3. Confirm live calculator on New maturity after the data wipe.
4. LAN: `APP_URL` + firewall note for other PCs.
5. After you **restart Windows**, Docker can run Postgres instead of the
   native install — same app, no code change.
