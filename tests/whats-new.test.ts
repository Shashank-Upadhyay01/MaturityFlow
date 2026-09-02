import { describe, expect, it } from 'vitest';

import {
  formatIndiaWhen,
  parseBugDraft,
  parseUpdateDraft,
  reportScreens,
  updateCountLabel,
} from '../src/lib/whats-new';

describe('updateCountLabel', () => {
  it('uses everyday English', () => {
    expect(updateCountLabel(0)).toBe('No updates yet');
    expect(updateCountLabel(1)).toBe('1 update so far');
    expect(updateCountLabel(12)).toBe('12 updates so far');
  });
});

describe('parseUpdateDraft', () => {
  it('accepts a plain-language note with a real time', () => {
    const parsed = parseUpdateDraft({
      title: 'You can now pay a missed day',
      body: 'If a customer did not take money on a past due day, the cashier can still mark it taken.',
      kind: 'NEW',
      publishedAt: '2026-09-03T10:30:00.000Z',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.title).toMatch(/missed day/);
  });

  it('rejects jargon-free but too-short copy', () => {
    const parsed = parseUpdateDraft({
      title: 'Hi',
      body: 'Done',
      kind: 'NEW',
      publishedAt: '2026-09-03T10:30:00.000Z',
    });
    expect(parsed.ok).toBe(false);
  });
});

describe('parseBugDraft', () => {
  it('accepts a counter clerk’s description', () => {
    const parsed = parseBugDraft({
      screen: '/cashbook',
      tryingTo: 'Close the daily cashbook',
      whatHappened: 'The save button did nothing when I pressed it',
      extra: '',
      severity: 'STOPPED_WORK',
    });
    expect(parsed.ok).toBe(true);
  });

  it('asks for a real screen and a real sentence', () => {
    expect(parseBugDraft({
      screen: '/not-a-page',
      tryingTo: 'pay',
      whatHappened: 'bad',
      severity: 'ANNOYING',
    }).ok).toBe(false);
  });

  it('lists the screens a person already knows from the menu', () => {
    const ids = reportScreens().map((s) => s.id);
    expect(ids).toContain('unsure');
    expect(ids).toContain('/maturities');
    expect(ids).toContain('/whats-new');
  });
});

describe('formatIndiaWhen', () => {
  it('prints an India date and time a clerk can read', () => {
    const text = formatIndiaWhen('2026-09-03T10:45:00.000+05:30');
    expect(text).toMatch(/September 2026/);
    expect(text.toLowerCase()).toMatch(/am|pm/);
  });
});
