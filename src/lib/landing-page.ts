import type { Role } from '@/db/schema';

export type LandingPage = '/dashboard' | '/maturities' | '/maturity-operations';

/**
 * The first working screen for a signed-in user.
 *
 * `OPS_HEAD` remains a legacy database role. Its original `ops` account was migrated to Admin
 * when the manual approval gate was retired, so the username check preserves the Operations
 * landing page without widening or changing that account's permissions.
 */
export function defaultLandingPage(identity: { role: Role; username?: string | null }): LandingPage {
  if (identity.role === 'CMD' || identity.role === 'CEO') return '/dashboard';
  if (identity.role === 'OPS_HEAD' || identity.username?.trim().toLowerCase() === 'ops') {
    return '/maturity-operations';
  }
  return '/maturities';
}
