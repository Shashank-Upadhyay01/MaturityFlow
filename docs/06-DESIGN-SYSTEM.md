# MaturityFlow design system

MaturityFlow is an internal banking workstation. Its visual language must make dense operational
data easy to scan for hours at a time, make money states unmistakable, and remain fast on ordinary
branch PCs. It is deliberately clean and restrained—not a marketing dashboard.

## Principles

1. **The ledger is the product.** Customer identity and money columns stay aligned and tabular.
2. **Colour has a job.** Blue means structure or selection, green means paid/balanced, amber means
   attention, and red means unpaid/short/refused. Do not use status colours decoratively.
3. **Opaque beats atmospheric.** Panels use solid surfaces and borders. Blur, animated background
   fields, sheen, glow and hover lift are disabled because they reduce clarity and consume GPU time.
4. **Compact, not cramped.** Primary controls are at least 40px high; dense sheet cells may be
   smaller when keyboard navigation provides the primary interaction.
5. **One signature.** Page headers carry a three-pixel institutional-blue ledger rail. It provides
   identity without competing with the data.
6. **The same hierarchy everywhere.** Page header → command/filter bar → primary working surface →
   supporting detail. Avoid duplicate titles and card grids that do not express a real grouping.

## Tokens and surfaces

The token layer is in `src/app/globals.css`. Components consume semantic variables rather than
hard-coded light/dark colours.

| Token family | Purpose |
|---|---|
| `--page-*` | Application canvas and primary text |
| `--glass-*` | Historical name for the standard opaque panel API |
| `--input-*` | Inputs, selects and compact toolbar controls |
| `--color-brand-*` | Navigation, selected state and focus |
| `--color-money-*` | Paid, received and balanced |
| `--color-warn-*` | Attention or partial state |
| `--color-danger-*` | Unpaid, overdue, short or destructive |
| `--row-*` | Register verdict rows in both themes |

`.glass` remains the shared component class to avoid rewriting every screen, but it now means an
opaque bordered surface with a small shadow. New code should use `Glass` / `GlassCard`; it should
not add backdrop blur or translucent panels.

## Type and numbers

- Inter with the system stack fallback.
- Body text is 14–15px; supporting text is never below 11px unless it is a dense table annotation.
- Money and table figures use tabular numerals. Columns of rupees must align.
- Sentence case for controls and section headings. Uppercase is reserved for short metadata labels.
- Use precise operational words: “Paid today?”, “Not paid”, “Cash difference”; avoid ambiguous
  labels such as “Taken?” or generic dashboard jargon.

## Spacing and shape

- Standard panel radius: 12px; nested controls: 8–9px.
- Page gaps: 20px for ordinary screens, 12px for the Register and Cashbook workbenches.
- Card headers: 16px vertical, 20–24px horizontal.
- Shadows are limited to one subtle elevation level. Separation comes from the canvas and border.

## Interaction and motion

- Standard transitions are 150–180ms colour/opacity changes.
- Page entrance is a 3px fade/rise; no blur, spring overshoot or stagger longer than 20ms.
- No decorative infinite animation. Loading indicators may spin while work is actually pending.
- `prefers-reduced-motion` collapses all motion.
- Every icon-only control needs an `aria-label` and usually a tooltip/title.
- Register and Cashbook grids keep focus on Arrow keys and Enter; the page must not scroll while a
  cell is active. Backspace/Delete edit the cell normally.

## Responsive behaviour

- No document-level horizontal overflow.
- Ordinary tables may scroll inside `.mf-hscroll`.
- The Register does **not** scroll sideways: `columnsThatFit()` keeps required identity columns and
  moves lower-priority columns into the row expander.
- Toolbars stack into logical rows on small screens; action groups may not overlap filters or labels.
- Audit uses a table from `sm` upward and record cards on mobile.
- Cashbook panels use their container rules and user-controlled spans without overlaying siblings.

## Accessibility and verification

- WCAG 2.1 AA contrast is the baseline in light and dark themes.
- Every input has a programmatic label; placeholders are examples, not labels.
- Focus uses the shared blue ring and remains visible on all surfaces.
- Status never relies on colour alone: text/icon labels accompany every verdict.
- Check changes with `scripts/audit-ui.mjs` at desktop, mobile and dark mode, plus keyboard testing
  in `scripts/check-register.mjs` and `scripts/check-cashbook.mjs`.

## Print

Print removes navigation and decorative motion, renders panels white with a hairline border, and
allows operational tables to use the full page. Register and cashbook print/export views are part
of the workflow and must be tested whenever their layouts change.
