/**
 * Organisation-wide dials the Admin can change without a code deploy.
 *
 * Pure parse/defaults. I/O lives in src/services/org-settings.ts.
 * Money stays bigint paise — JSON stores it as a decimal string.
 */

export const DEFAULT_CASH_CAP_PAISE = 2_500_000n; // ₹25,000
export const DEFAULT_ROUNDING_PAISE = 100_000n; // ₹1,000
export const DEFAULT_WINDOW_DAYS = 15;
export const DEFAULT_ORG_NAME = 'Bhawarnath Branch, Azamgarh';
export const DEFAULT_ORG_SHORT = 'Bhawarnath';

export const ORG_KEYS = {
  name: 'org.name',
  shortName: 'org.shortName',
  cashCapPaise: 'policy.cashCapPaise',
  maxWindowDays: 'policy.maxWindowDays',
  defaultRoundingPaise: 'policy.defaultRoundingPaise',
} as const;

export interface OrgSettings {
  orgName: string;
  orgShortName: string;
  cashCapPaise: bigint;
  defaultWindowDays: number;
  defaultRoundingPaise: bigint;
}

export const ORG_DEFAULTS: OrgSettings = {
  orgName: DEFAULT_ORG_NAME,
  orgShortName: DEFAULT_ORG_SHORT,
  cashCapPaise: DEFAULT_CASH_CAP_PAISE,
  defaultWindowDays: DEFAULT_WINDOW_DAYS,
  defaultRoundingPaise: DEFAULT_ROUNDING_PAISE,
};

/** Seed and older rows wrap the scalar as `{ value }`. Accept either shape. */
export function unwrapSetting(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function asString(raw: unknown, fallback: string): string {
  const v = unwrapSetting(raw);
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function asInt(raw: unknown, fallback: number, min: number, max: number): number {
  const v = unwrapSetting(raw);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asPaise(raw: unknown, fallback: bigint): bigint {
  const v = unwrapSetting(raw);
  if (typeof v === 'bigint') return v >= 0n ? v : fallback;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return BigInt(v.trim());
  return fallback;
}

export function parseOrgSettings(rows: { key: string; value: unknown }[]): OrgSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    orgName: asString(map.get(ORG_KEYS.name), ORG_DEFAULTS.orgName),
    orgShortName: asString(map.get(ORG_KEYS.shortName), ORG_DEFAULTS.orgShortName),
    cashCapPaise: asPaise(map.get(ORG_KEYS.cashCapPaise), ORG_DEFAULTS.cashCapPaise),
    defaultWindowDays: asInt(map.get(ORG_KEYS.maxWindowDays), ORG_DEFAULTS.defaultWindowDays, 1, 60),
    defaultRoundingPaise: asPaise(
      map.get(ORG_KEYS.defaultRoundingPaise),
      ORG_DEFAULTS.defaultRoundingPaise,
    ),
  };
}

export function orgSettingsToRows(
  s: OrgSettings,
): { key: string; value: { value: string | number } }[] {
  return [
    { key: ORG_KEYS.name, value: { value: s.orgName } },
    { key: ORG_KEYS.shortName, value: { value: s.orgShortName } },
    { key: ORG_KEYS.cashCapPaise, value: { value: s.cashCapPaise.toString() } },
    { key: ORG_KEYS.maxWindowDays, value: { value: s.defaultWindowDays } },
    { key: ORG_KEYS.defaultRoundingPaise, value: { value: s.defaultRoundingPaise.toString() } },
  ];
}
