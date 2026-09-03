# KGGNL Core — product memory

Read this before changing the Register, Maturities, import, payouts or Deposit interest.
This is what the operator asked for in plain language. Do not drop it between sessions.

**Operational Head** in conversation = the old Ops Head role. In code that account is **Admin**
(`OPS_HEAD` maps to `ADMIN`). HQ money control is **Admin, CMD and CEO**.

---

## What this portal is for

The job is **insight on maturities**, then **paying them smoothly from the Register**.

1. Feed customer data (import or type).
2. The system calculates how much is maturing **by month and by day**.
3. Staff filter by **customer** and **agent**, and by amount.
4. **₹1,00,000 and above** → **12 payout days** (every working day).
5. **Below ₹1,00,000** → **6 alternate payout days** (same overall deadline).
6. A clerk may set a **custom number of payout days** instead of 12 or 6. The amount is split
   across those days.
7. **Recommended** figures (12-day, 6-day, 3-day, and the per-day column) are **advice only**.
   They must never block a payment and must never be written as “what we have to pay today”.
8. **Due payment** is the schedule for that day. **Paid today** is what was actually given.

Processing still starts **maturity + 3 calendar days**, rolled to an open day. That is not a
payout day. The 12 / 6 numbers are **payout days**, not the whole window.

---

## Money rules that stay

- Money is **bigint paise**. No floats.
- `Σ(instalments) === maturity amount`, exactly. Last day carries leftover after rounding.
- **Round days 1 … n−1** to the rounding step. **Last day = whatever remains.** Do this for
  every customer, including after a custom payment.
- The client never invents instalment rows; the server derives the schedule.
- Case row lock first, then instalment. Audit in the same transaction.
- A bulk action is a loop over the single-row audited path.

---

## No cash cap on the customer

**Do not cap cash** for any customer. A cashier must be able to hand over the amount the
customer actually takes, including all cash. Recommended / cash-cap / “too much cash today”
must not refuse a Taken payment.

Cash vs online on the sheet is still a **split for insight**, not a limit.

---

## Custom amount → remaining days rebalance

Example: maturity ₹1,00,000, plan ₹10,000 × 10 days. Cashier pays **₹15,000**.

- Do **not** block.
- Record ₹15,000.
- Remaining ₹85,000 is **re-spread across the unpaid later days**, rounded except the last day.

Underpayment stays on that day as leftover (they can take the rest later). Overpayment grows
that day and shrinks later unpaid days.

---

## Register and Maturities should work like a sheet

Staff live on **Register** and **Maturities**. They expect Excel-like work:

- Edit cells, rows and columns.
- **Copy / paste** (Ctrl+C / Ctrl+V).
- **Undo / redo** (Ctrl+Z / Ctrl+Y) for cell edits.
- **Shift-click** to select a range of rows (already exists — keep it).
- Drag-select of cells is wanted; do not break money locks to fake it.

Recommended must not drive Taken. Taken opens the payment list (tick days, custom amount,
confirm). **Taken and Not taken stay available on every unpaid day, including missed days.**
Never hide or disable them just because a day was missed.

HQ opens **Azamgarh, ready to type and pay**. “All branches” is optional and read-only.
Taken / Not taken stay on for every unpaid day, including missed. Admin / CMD / CEO are not
locked out of a closed day.

---

## Who may change history

**Cashiers / branch managers** record **today’s** payment (and missed days that are still
unpaid). They cannot silently rewrite an earlier **already paid** amount.

**Admin / CMD / CEO:** open Taken on the customer, type a new **Paid** figure on the old day,
enter a reason, save. That is how old-day payments are edited.

**Admin, CMD, CEO** (and Operational Head = Admin) may change **any** value if something went
wrong: paid amount, amount still to pay, dates, custom figures. The schedule **rebalances live**.
They should not need a developer to fix a mistyped payout.

Corrections are audited. Replacing a recorded payment still needs a **reason**.

---

## Import

- The **Register / Maturities template** is the file to download for **any branch**.
- Import must accept that template **and** the older `MATURITY.xlsx` headers.
- **Blank or missing values must not abort the whole import.** Show a popup / toast of warnings
  (missing dates, blank agent, etc.) and **still import** the good fields.
- Missing form date → warn, default to maturity date or today. Missing maturity date → warn, still
  create the row. Amount still required and > 0.
- Do not require every optional column to be present in the header.

---

## Deposit interest

- Column **Agent Name**.
- **Download as PDF** of the calculated report.
- Rate box: **8.50% must not clip**. Search: magnifying glass must not sit on the placeholder text.

---

## HQ default Register

HQ lands on **Azamgarh, editable**. The live book is visible and Taken / cells work immediately.
“All branches” is still in the picker if they need a read-only combined view.

---

## Do not

- Do not treat Recommended as Due payment.
- Do not refuse Taken because of a cash cap.
- Do not disable Taken/Not taken on missed unpaid days.
- Do not dump a huge unrounded remainder on the last day **except** the true leftover after
  rounding (smooth days, last day takes residue).
- Do not invent a second faster money path without case lock + audit.
- Do not ask the operator to repeat this spec. Update this file when the product rule changes.
