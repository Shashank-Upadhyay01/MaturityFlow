import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CASH_CAP_PAISE,
  ORG_DEFAULTS,
  orgSettingsToRows,
  parseOrgSettings,
} from '../src/lib/org-settings';

describe('parseOrgSettings', () => {
  it('returns defaults for an empty store', () => {
    expect(parseOrgSettings([])).toEqual(ORG_DEFAULTS);
  });

  it('unwraps the { value } seed shape and keeps money as bigint', () => {
    const s = parseOrgSettings([
      { key: 'org.name', value: { value: 'Test Bank' } },
      { key: 'org.shortName', value: { value: 'Test' } },
      { key: 'policy.cashCapPaise', value: { value: '2500000' } },
      { key: 'policy.maxWindowDays', value: { value: 12 } },
      { key: 'policy.defaultRoundingPaise', value: { value: '100000' } },
    ]);
    expect(s.orgName).toBe('Test Bank');
    expect(s.orgShortName).toBe('Test');
    expect(s.cashCapPaise).toBe(DEFAULT_CASH_CAP_PAISE);
    expect(s.defaultWindowDays).toBe(12);
    expect(s.defaultRoundingPaise).toBe(100_000n);
  });

  it('round-trips through orgSettingsToRows', () => {
    const rows = orgSettingsToRows(ORG_DEFAULTS);
    expect(parseOrgSettings(rows)).toEqual(ORG_DEFAULTS);
  });

  it('clamps the window to 1–60', () => {
    expect(parseOrgSettings([{ key: 'policy.maxWindowDays', value: 99 }]).defaultWindowDays).toBe(60);
    expect(parseOrgSettings([{ key: 'policy.maxWindowDays', value: 0 }]).defaultWindowDays).toBe(1);
  });
});
