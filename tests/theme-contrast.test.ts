import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The themes, measured rather than eyeballed.
 *
 * Both complaints that produced this file were invisible to a contrast checker pointed at text:
 * every label already passed. What failed was the STRUCTURE — grid lines at 1.26:1, a zebra
 * stripe 1.05:1 from the row beside it, and in dark mode a page, a panel and a stripe within
 * half a percent of each other. A register is read by tracking one row across fourteen columns,
 * so separators are not decoration and they get budgets of their own here.
 */
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
  // Take the LAST block for the selector; ':root' also appears earlier for non-themed vars.
  const blocks = [...css.matchAll(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g'))];
  const out: Record<string, string> = {};
  for (const b of blocks) {
    for (const m of b[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  }
  return out;
}

const srgb = (h: string) => {
  const v = h.replace('#', '');
  const full = v.length === 3 ? [...v].map((c) => c + c).join('') : v;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const channel = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const luminance = (h: string) => {
  const [r, g, b] = srgb(h);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** foreground, background, minimum, what it is */
const BUDGET: [string, string, number, string][] = [
  ['--page-fg', '--glass-bg', 7, 'body text on a panel'],
  ['--muted-fg', '--glass-bg', 7, 'muted text on a panel'],
  ['--muted-fg', '--glass-bg-subtle', 7, 'muted text on a striped row'],
  ['--faint-fg', '--glass-bg', 4.5, 'faint text on a panel'],
  ['--faint-fg', '--glass-bg-subtle', 4.5, 'faint text on a striped row'],
  ['--page-fg', '--page-bg', 7, 'body text on the page'],
  ['--page-fg', '--input-bg', 7, 'a typed value in its field'],
  ['--row-taken-fg', '--row-taken', 4.5, 'the taken label in its tint'],
  ['--row-missed-fg', '--row-missed', 4.5, 'the missed label in its tint'],
  ['--row-partial-fg', '--row-partial', 4.5, 'the partial label in its tint'],
  // Structure. These are the ones that were failing.
  ['--hairline', '--glass-bg', 1.85, 'a grid line on a panel'],
  ['--hairline', '--glass-bg-subtle', 1.4, 'a grid line on a striped row'],
  ['--glass-border', '--glass-bg', 2.1, 'a panel edge'],
  ['--input-border', '--glass-bg', 3, 'a control boundary (WCAG 1.4.11)'],
  ['--input-border', '--input-bg', 3, 'a control boundary against its own fill'],
  ['--glass-bg-subtle', '--surface-solid', 1.25, 'the zebra stripe against the row beside it'],
  ['--glass-bg', '--page-bg', 1.18, 'a panel sitting above the page'],
];

describe.each([
  ['light', ':root'],
  ['dark', '\\.dark'],
])('%s theme', (themeName, selector) => {
  const t = tokens(selector);

  it('defines every token the budget measures', () => {
    for (const [fg, bg] of BUDGET) {
      expect(t[fg], `${fg} missing from ${themeName}`).toBeTruthy();
      expect(t[bg], `${bg} missing from ${themeName}`).toBeTruthy();
    }
  });

  it.each(BUDGET)('%s on %s is at least %s:1 — %s', (fg, bg, min) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });

  it('keeps the light page off pure white and the dark page out of the murk', () => {
    const panel = luminance(t['--glass-bg']);
    if (themeName === 'light') {
      // Glare: a full screen of #ffffff is what the branch complained about.
      expect(panel).toBeLessThan(0.98);
      expect(panel).toBeGreaterThan(0.9);
    } else {
      expect(panel).toBeGreaterThan(luminance(t['--page-bg']));
      expect(panel).toBeLessThan(0.06);
    }
  });
});
