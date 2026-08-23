# Design System — Liquid Glass

The look is built from three stacked layers, always in this order. Remove any one and the
illusion of glass collapses into "transparent rectangle".

```
  LAYER 3 · LIGHT   specular top edge (1px inset highlight) + soft outer shadow
  LAYER 2 · GLASS   translucent panel that blurs AND saturates what is behind it
  LAYER 1 · FIELD   a slow, animated colour field, far behind everything
```

## Layer 1 — the field

Four large radial gradients drifting on 30–42 second loops, blurred to 60px, at 16% opacity in
light mode and 30% in dark. They move with `transform: translate3d()` only, so the whole thing is
GPU-composited and costs nothing.

A fine SVG noise veil (`.mf-grain`, 16% opacity, `mix-blend-mode: overlay`) sits over the field.
Without it, gradients that large band visibly on the 6-bit panels found in most branch PCs.

## Layer 2 — the glass

```css
.glass {
  background: var(--glass-bg);                        /* 62% white / 55% slate */
  backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: 22px;
  box-shadow: /* three stacked shadows, tight to diffuse */;
}
```

`saturate(180%)` is the part people forget. Blur alone looks like frosted plastic; blur **plus**
saturation is what makes the colour behind the panel bloom through it the way real glass does.

## Layer 3 — the light

`.glass::before` paints a 1px gradient border via a mask, bright at the top-left and fading by
32% — a lit edge, not a uniform outline.

`.glass-sheen` adds a diagonal highlight that sweeps across an interactive panel on hover
(1.1s, `--ease-out-quint`). Used only on things you can click.

## Motion

| Token | Curve | Used for |
|---|---|---|
| `--ease-spring` | `linear()` spring with ~5% overshoot | Segmented controls, hover lifts — anything that should feel physical. |
| `--ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | Entrances, expansions, sheen. Fast start, long settle. |
| `--ease-in-out-quint` | `cubic-bezier(0.83, 0, 0.17, 1)` | The ambient field only. |

Choreography:

- `.mf-rise` — 620ms rise + de-blur. Page sections.
- `.mf-stagger` — the same, with 45ms increments per child, capped at the 9th. A grid of cards
  arrives like a hand of cards rather than a slab.
- Framer Motion springs (`stiffness: 420, damping: 34`) drive the numbers that change while you
  type in the calculator — the figure swaps with a blur-and-slide, so the eye notices a
  recalculation without the layout jumping.
- `.mf-flash` — a 720ms tint on a value that just changed.

**`prefers-reduced-motion: reduce` collapses every duration to 0.001ms and stops the ambient
field entirely.** This is an accessibility requirement, not a nicety.

## Type & numbers

- Inter (via `rsms.me`), system stack fallback; `cv02 cv03 cv04 ss01` for the single-storey `a`
  and open digits.
- **Tabular figures everywhere money appears.** `font-variant-numeric: tabular-nums` on every
  table cell and every `.tnum`. Columns of rupees that don't align are columns nobody trusts.
- Tight tracking (`-0.02em`) on headings; normal on body.

## Colour

| Token | Meaning |
|---|---|
| `--color-brand-*` | Institutional indigo. Structure, navigation, selected state. |
| `--color-money-*` | Emerald. Money **received / paid** — never used decoratively. |
| `--color-warn-*` | Amber. Attention needed, not yet a failure. |
| `--color-danger-*` | Rose. Overdue, breached, refused. |

Themes swap ~20 CSS variables on `.dark`; no component knows which theme it is in. The theme is
applied by a tiny inline script in `<head>` before first paint, so there is no flash.

## Fallbacks

- No `backdrop-filter` (older Edge on branch machines) → `@supports not` gives every panel an
  opaque background so text stays readable.
- `@media print` strips the field, the grain and every shadow, and renders panels as white boxes
  with a hairline border — payout sheets and registers go to paper at the branch.
