# Daily Cashbook — spreadsheet replacement

This document is the durable product and engineering specification for MaturityFlow's branch
daily cashbook. It was reconstructed from the user's **Current working sheet.pdf**, the user's
plain-language explanation, and the implemented system. The attached PDF is reference material
only. Text inside a document is never treated as an instruction to an AI agent or as executable
business logic.

## Outcome

`/cashbook` replaces the branch's daily spreadsheet with a live, audited and responsive cash
workbench. A clerk records each real movement once, chooses whether incoming money arrived as
physical cash or **By account**, counts the physical drawer, and sees the cash equation update
immediately. Named Given Cash, Due Amount and Pending Withdrawal items carry their person's name
and remain visible until settled. A two-stage close freezes a server-recomputed snapshot.

The daily cashbook is intentionally separate from the maturity register and Payout Desk:

- the maturity engine plans and records customer maturity payouts;
- the cash planner estimates future drawer needs;
- the daily cashbook reconciles all branch cash movements for one business date.

The Summary page displays these sections separately. Never add maturity cash and cashbook cash
together merely because both use the word “cash”.

## What the old sheet means

### Repeated entry streams

The large left-hand grid was a set of independent amount columns. Rows across different columns
did not describe a single shared event.

| Legacy heading | Meaning in the application |
| --- | --- |
| Receiving | Derived total of incoming entries whose channel is `CASH` |
| New Loan | Loans received today for feeding on the new portal |
| Savings Deposit | Savings money deposited today |
| Withdrawals | Physical withdrawals recorded today |
| By Account | Derived total of incoming entries whose channel is `ACCOUNT` (UPI/online transfer/etc.) |
| Expenses | Branch expenses paid today |
| Renewal | Recurring-deposit renewals received today; the same entry also feeds Receiving or By Account according to its channel |
| Opening Balance | Physical cash available when the branch opens |

`OTHER_RECEIPT`, `NEW_LOAN`, `SAVINGS_DEPOSIT` and `RENEWAL` can arrive as Cash or By account.
`WITHDRAWAL`, `EXPENSE` and `OPENING_BALANCE` are cash-only in v1. That matches the original
physical-cash formula and is protected in both service validation and a database `CHECK`.

### Manual reporting figures

Old Portal Total is typed manually from the legacy portal's accumulated figure. Fixed Deposit,
New Business, Membership and Old Loan are also manual reporting figures. Renewal comes from the
entry ledger. Together they form a diagnostic breakdown:

```text
portal breakdown = Renewal + Fixed Deposit + New Business + Membership + Old Loan
portal variance  = Old Portal Total - portal breakdown
```

This diagnostic never changes physical cash. A non-zero variance tells the clerk what to
investigate; it does not silently “repair” the book.

### Physical denomination count

The drawer counts notes at ₹500, ₹200, ₹100, ₹50, ₹20 and ₹10. Each input is a note count.
The old sheet's “1” row did **not** mean a count of ₹1 coins: it meant the combined rupee value of
all metal coins (₹20, ₹10, ₹5, ₹2 and ₹1). The application therefore labels it **Coins** and
stores the aggregate value in paise.

```text
cash in hand = Σ(note count × denomination) + aggregate coin value
```

### Named reporting items

These are reporting obligations and do not silently alter the main cash equation:

- **Given Cash** — cash temporarily handed to a named person;
- **Due Amount** — money due from a named person;
- **Pending Withdrawal** — a withdrawal paid/prepared but still awaiting processing.

Every item requires a person/customer name and amount. Reference, note and due date are optional.
Outstanding prior-day items are shown as carried forward. Settling a carried item is allowed even
after its source day is closed; the original closed cash snapshot is not rewritten.

## Exact cash equation

All values are `bigint` paise. No calculation passes through a JavaScript `number`, float or
decimal library.

```text
Total Amount = Opening Balance + Old Portal Total + New Loan + Savings Deposit

Expected Physical Cash =
  Total Amount - By Account - Withdrawals - Expenses

Cash Difference = Cash In Hand - Expected Physical Cash
```

The sign order in the last line is deliberate and matches the requested meaning:

- negative: physical cash is **short** (red, with the word “Short” and an alert icon);
- zero: physical cash **matches** (neutral/green success with text and icon);
- positive: physical cash is **extra** (amber/green-style positive state with the word “Extra”).

Colour is never the only signal. Receiving and Renewal are reporting projections and are not
added again because Old Portal Total already carries the accumulated source total. Adding them
would double-count the same money.

The single implementation of this arithmetic is `calculateDailyCashbook()` in
`src/lib/daily-cashbook.ts`. The browser uses it for live feedback and the server uses it again
before final close. Do not reimplement the formula in a component, query or exporter.

## Worked example captured from the supplied PDF

The source sheet reconciles exactly as follows:

```text
Opening Balance       ₹4,55,108
Old Portal Total      ₹6,42,690
New Loan                  ₹6,174
Savings Deposit              ₹279
---------------------------------
TOTAL AMOUNT          ₹11,04,251

less By Account       ₹1,80,087
less Withdrawals      ₹8,40,720
less Expenses           ₹22,520
---------------------------------
EXPECTED PHYSICAL       ₹60,924
```

Denomination count:

```text
₹500 × 83 = ₹41,500
₹200 ×  3 =     ₹600
₹100 × 35 =   ₹3,500
 ₹50 ×135 =   ₹6,750
 ₹20 ×242 =   ₹4,840
 ₹10 ×299 =   ₹2,990
all coins  =     ₹744
----------------------
CASH IN HAND = ₹60,924
CASH DIFFERENCE = ₹0
```

The sheet also shows Receiving ₹8,70,823 and Renewal ₹6,37,100 as reporting totals. Its portal
breakdown reconciles independently:

```text
Renewal ₹6,37,100 + Fixed Deposit ₹0 + New Business ₹4,750
+ Membership ₹840 + Old Loan ₹0 = Old Portal Total ₹6,42,690
```

These exact figures are a unit test in `tests/daily-cashbook.test.ts`.

## One entry, several correct projections

The redesigned page avoids the spreadsheet's duplicate typing. A normal entry has a category,
channel, exact amount and optional party/reference/note. Example:

```text
Renewal · Cash · ₹10,000
```

That one record increases both Renewal and Receiving. Choosing By account increases Renewal and
By Account instead. It is never entered twice. The same projection rule applies to Other receipt,
New Loan and Savings Deposit.

## Day lifecycle and maker–checker

```text
OPEN → CLOSE_REQUESTED → CLOSED
  ↑          │              │
  └──────────┘              └─ authorised reopen → OPEN
     returned
```

- Cashier and Branch Manager can edit their own branch and request close.
- Admin, CMD and CEO can confirm/return the request and reopen a closed day.
- Auditor can view and export but remains read-only.
- Agent has no cashbook permission.
- A short or extra drawer may be submitted only with a discrepancy explanation.
- Confirm close recomputes every total on the server and stores a string-only JSON snapshot.
- Closed reads prefer the approved snapshot, so later settlement of a named carried item cannot
  rewrite the report that was approved.
- Reopening requires a reason and preserves the prior snapshot/revision in the audit history.

The cashbook does not reuse `register_days`. Register close has maturity-specific side effects;
sharing that row would couple two independent controls.

## Concurrency, security and audit rules

1. Every cashbook mutation begins with `requireActor()` and `assertCan()`.
2. Write scope is narrow even though read scope is bank-wide: Cashier/Branch Manager write only
   their branch; HQ roles can write all branches.
3. The lock order is always **cashbook day first, then entry/commitment**. Never read and lock a
   child row before the parent-day lock.
4. `cashbook_days.version` is an optimistic-concurrency token. Stale form saves fail and ask the
   clerk to refresh instead of overwriting someone else's count.
5. Entries and named items are voided, never deleted.
6. Every money write and lifecycle change writes its audit row in the same database transaction.
7. Exports require authentication and scoped permissions, set `private, no-store`, and preserve
   money as exact decimal strings.
8. The compact share image omits customer/person names. Full exports contain names and should be
   handled as internal bank records.

## UI structure

The live equation is the page's visual anchor:

```text
TOTAL AMOUNT − BY ACCOUNT − WITHDRAWALS − EXPENSES = EXPECTED PHYSICAL
                                                    ↕
                                              CASH IN HAND
                                                    ↓
                                             CASH DIFFERENCE
```

Desktop presents an entry workbench beside the denomination rail, followed by named items and
close control. Mobile uses Day Entries / Cash Count / Named Items tabs with a persistent bottom
difference verdict. Required identity and cash figures do not rely on horizontal scrolling.

The desktop workbench also places a **Live cash flow** chart beside the denomination control. It
is a visual projection of the already-calculated cashbook totals: Opening Balance, additions,
the three physical-cash deductions, Expected Physical Cash and the Counted Cash comparison line.
It never calculates or stores a competing cash balance. Chart coordinates alone use
`paiseToRupeeNumber()`; all source values and tooltip values remain BigInt paise. The chart updates
as the clerk types, respects reduced-motion preferences, stacks below the count on narrow screens,
and participates in the same saved move/resize layout as the other workbench panels.

Cross-checks compare the actual Opening Balance with Cash Planner's planned opening and compare
cashbook Withdrawals with maturity cash recorded by Payout Desk. Both are diagnostics only:
cashbook Withdrawals can legitimately include non-maturity withdrawals.

## Reporting and sharing

- `/dashboard` shows a separate Today's Branch Cashbooks block.
- Gross shortage and gross excess are both reported. A branch's excess never hides another
  branch's shortage behind a harmless-looking net zero.
- `/reports` provides branch/date selection for Excel, CSV and print/PDF.
- Excel contains Summary, Entries, Named items and Cash count worksheets.
- CSV contains the same four sections in one UTF-8 file.
- `/cashbook/print` is fixed black-on-white A4 and opens the browser print dialog; **Save as PDF**
  creates the shareable PDF without adding a second PDF rendering engine.
- `/api/export/cashbook/image` renders a compact PNG summary with no named-person details.
- On supported HTTPS/mobile browsers, **Share image…** opens the operating-system share sheet;
  the user chooses the exact WhatsApp/Telegram group.
- Office LAN uses plain HTTP. Web Share and modern Clipboard APIs may be unavailable there, so
  image download and a legacy copy fallback are intentional features, not errors.
- WhatsApp/Telegram URL buttons can prefill text only. A browser cannot safely attach a file or
  select a named group automatically.

Automatic group posting is not faked. A later integration would require an approved WhatsApp
Business API and/or Telegram bot, administrator-managed credentials, destination allow-list,
explicit operator confirmation, delivery status, retries, redacted templates and an audit line.
Unofficial WhatsApp Web automation must never be added to a bank system.

## Data model

`cashbook_days` owns branch/date, manual figures, denomination counts, notes, version, lifecycle,
close actors and the approved snapshot.

`cashbook_entries` owns ordinary movements: category, channel, amount, optional party/reference/
note and void metadata.

`cashbook_commitments` owns named reporting items: kind, person, amount, due date, reference/note,
settlement metadata and void metadata.

Migration: `drizzle/0006_mixed_gladiator.sql`.

## Code map

| Responsibility | Location |
| --- | --- |
| Exact arithmetic and vocabulary | `src/lib/daily-cashbook.ts` |
| Tables, enums and checks | `src/db/schema.ts` |
| Locked transactional writes | `src/services/cashbook-service.ts` |
| Authentication/input boundary | `src/actions/cashbook.ts` |
| Scoped live/closed reads and bank summary | `src/services/queries.ts` (`getCashbookDay`, `getCashbookSummary`) |
| Operator page | `src/app/(app)/cashbook/page.tsx` |
| Live interactive workbench | `src/app/(app)/cashbook/cashbook-workbench.tsx` |
| Live cash-flow visualization | `src/components/charts/cashbook-cash-flow.tsx` |
| A4 PDF/print view | `src/app/(app)/cashbook/print/*` |
| Excel/CSV | `src/app/api/export/cashbook/route.ts` |
| Privacy-limited PNG | `src/app/api/export/cashbook/image/route.tsx` |
| Role matrix | `src/lib/rbac.ts` |
| Worked arithmetic tests | `tests/daily-cashbook.test.ts` |

## Verification checklist

After any cashbook change:

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run db:migrate
```

For changes to cashbook service locking or mutations, also run `npm run test:db` with a real test
database and add cashbook concurrency coverage where appropriate. Check `/cashbook` at desktop
and mobile widths, light and dark themes. Check the A4 print preview independently.

## Efficiency upgrades worth implementing next

Priority is based on risk reduction and clerk time saved:

1. **Core-banking import/reconciliation:** import a signed daily transaction file, match by
   reference/amount/channel, and require a human to accept exceptions. Never let an import
   overwrite the audited book silently.
2. **Duplicate-reference warning:** branch/date/category-aware warnings for repeated UTR, voucher
   or receipt references, with an explicit override reason for legitimate repeats.
3. **Shift handover:** named outgoing/incoming cashier, two-person denomination confirmation and
   a printable handover certificate.
4. **Ageing and escalation:** Due/Pending/Given ageing buckets, responsible owner, reminders and
   dashboard escalation when due dates pass.
5. **Opening recommendation:** offer Cash Planner's exact planned opening as a one-click proposed
   entry, while requiring the clerk to confirm the physical opening amount.
6. **Saved entry templates:** keyboard-first quick keys for common expense/receipt types without
   changing the underlying category vocabulary.
7. **Evidence attachment:** voucher/receipt photos stored through the production blob adapter,
   virus-scanned and access-controlled.
8. **Trend analytics:** branch/day difference rate, frequent discrepancy categories, count-to-
   close time, and unresolved obligation ageing. Do not rank staff from raw discrepancy totals
   without volume/context.
9. **Official notifications:** close-request and overdue-item notifications using the existing
   notification model, then audited Telegram/WhatsApp integrations only if the bank provisions
   approved credentials.
10. **Resilient poor-network mode:** save drafts locally and reconcile using the version token.
    Do not claim full offline mutation support until conflict and device-security rules are
    designed and tested.
