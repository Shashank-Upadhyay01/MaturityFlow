# The Register, Overhauled — Taken / Not Taken, and a Sheet That Reads the Schedule

The fourth part of the 2026-08-25 brainstorm, deliberately left out of
`2026-08-26-remove-approval-auto-schedule.md`. That plan gave every case a day-by-day payout
schedule. This one makes the Register — the screen the branch stares at all day — actually *show*
that schedule and let a clerk answer the only question they have: **did this customer turn up
today?**

## The user's words

> If any payment is not done or the agent or customer doesn't show up to withdrawal that day then
> that payment will be shown at a seperate tab on the register tab only so that it can easily be
> identified who did not withdrawal that day but dont remove the missed payment from the 12 day
> withdrawal list simply highlight it in light red and for the payments which are done mark them
> light green and this happens only after the user mark if the payment is taken or not taken that
> day so put 2 simple bottons one for it next to each payment so all the user has to do is to look
> at a payment and select if it has been withdrawal or not for each day.

> the system will automatically show and recommend based on the data on the register page so that
> the user can just look and mark how much is supposed to be done and the cash online and both were
> supposed to a button … this is the main page that will be used most of the time when working so
> overhaul the whole page, analyze each element so that it serves its purpose fully and if someone
> looks at anything they know what each element signifies and what it's for.

## What is wrong today

1. **The sheet cannot see the schedule.** `listRegister()` selected nothing from
   `payout_instalments`. The `Today` column was `todayApprovedPaise` — a figure a clerk typed by
   hand — on a system that now computes that figure exactly.
2. **`Given` is three text buttons in a 4.5rem cell.** They wrap to three lines and bleed over the
   next column. That is the defect in the user's screenshot.
3. **`markGiven()` writes `instalmentId: null`.** It pays the *case*, not the day. So the schedule
   never records what happened, and nothing can tell a missed day from an unpaid one.
4. **There is no "not taken".** The missed list has no input to be built from.

## Global constraints

- Money stays `bigint` paise; the client re-parses with `BigInt(...)`.
- Marking Taken goes through **`recordPayout()`** — case lock, then instalment `.for('update')`,
  INV-4 validation, audit row in the same transaction (CLAUDE.md #7). Never a second faster path.
- **"Taken" records the full scheduled amount for that day**, never a partial. A partial is a
  different act and belongs on the case page.
- Every mutation: `requireActor()` → `assertCanTypeRegister()` → `assertCan()`.
- Row tints must be defined for light **and** dark (`.dark` overrides) — see the token trap in
  CLAUDE.md.

## File structure

| File | Responsibility |
|---|---|
| `src/services/queries.ts` | `listRegister()` joins today's instalment + overdue aggregate **(done, uncommitted)** |
| `src/services/register-service.ts` | `markInstalmentTaken()` / `markInstalmentMissed()` — delegate to `recordPayout` |
| `src/actions/register.ts` | `markTakenAction` / `markMissedAction`; retire `markGivenAction` |
| `src/lib/register-view.ts` | `'missed'` tab; `dayStateOf(row)` — the single definition of taken / missed / due / none |
| `src/lib/register-layout.ts` | `Given` retired; the tender picker is furniture, not a data column |
| `src/app/(app)/maturities/register-sheet.tsx` | the Taken/Not-taken control, row tints, the Missed tab |
| `src/app/(app)/maturities/page.tsx` | pass the new instalment fields through |
| `src/app/globals.css` | `--row-done` / `--row-missed` tokens, light and dark |

## Tasks

### Task 1 — the sheet can see the schedule *(done, uncommitted)*
`listRegister(actor, date)` returns `todayInstalmentId`, `todayDuePaise`, `todayPaidPaise`,
`todayStatus`, `overdueCount`, `overduePaise`. Typecheck passes.

### Task 2 — carry the fields to the client
Widen `RegisterRow` in `register-sheet.tsx` and map the fields in `page.tsx`. No behaviour yet.

### Task 3 — `dayStateOf()`, pure and unit-tested
`'taken' | 'missed' | 'due' | 'none'` from one row. Every tint, tab and control reads this one
function — nothing recomputes it inline.

### Task 4 — the service and actions
`markInstalmentTaken(actor, instalmentId, tender)` → `recordPayout` with the full remaining
instalment amount split by tender. `markInstalmentMissed()` sets `MISSED` under the case lock with
an audit row. Both refuse a superseded instalment.

### Task 5 — the control replaces `Given`
One ✓ / ✗ pair, always the same width. Tender is a small popover on ✓ defaulting to the schedule's
own cash/online legs, so the common case is a single click.

### Task 6 — tints and the Missed tab
Light green on taken, light red on missed, in both themes. Missed rows **stay** on the day list.
New `'missed'` tab listing everyone with an overdue instalment.

### Task 7 — the element-by-element pass
Every column gets a title that says what it is for. `Today` shows the recommended figure from the
schedule. Verify with `npm test`, `npm run typecheck`, `npm run build`,
`node scripts/check-register.mjs`, and screenshots in both themes.

## What this plan does not do

- It does not touch `payout-engine.ts`. The arithmetic is settled.
- It does not add partial-payment entry to the sheet. Taken is all-or-nothing by design; the case
  page handles the exceptions.
- It does not run `markMissedInstalments()` on a read path. Missed stays derived from `due_on`.
