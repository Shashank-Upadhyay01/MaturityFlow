import 'server-only';

import { cache } from 'react';

import { db, type Queryable } from '@/db';
import { systemSettings } from '@/db/schema';
import {
  ORG_DEFAULTS,
  orgSettingsToRows,
  parseOrgSettings,
  type OrgSettings,
} from '@/lib/org-settings';

export const loadOrgSettings = cache(async (): Promise<OrgSettings> => {
  try {
    const rows = await db.select({ key: systemSettings.key, value: systemSettings.value }).from(systemSettings);
    return parseOrgSettings(rows);
  } catch {
    return { ...ORG_DEFAULTS };
  }
});

export async function persistOrgSettings(
  tx: Queryable,
  next: OrgSettings,
  updatedBy: string,
): Promise<void> {
  const now = new Date();
  for (const row of orgSettingsToRows(next)) {
    await tx
      .insert(systemSettings)
      .values({ key: row.key, value: row.value, updatedAt: now, updatedBy })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: row.value, updatedAt: now, updatedBy },
      });
  }
}
