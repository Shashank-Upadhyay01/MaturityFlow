import type { Permission } from '@/lib/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon:
    | 'dashboard'
    | 'plus'
    | 'inbox'
    | 'files'
    | 'wallet'
    | 'banknote'
    | 'users'
    | 'building'
    | 'chart'
    | 'shield'
    | 'settings';
  permission: Permission;
  /** Only shown to roles whose scope spans every branch. */
  headOfficeOnly?: boolean;
  badge?: 'approvals' | 'dueToday' | 'overdue';
  description: string;
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Work',
    items: [
      {
        href: '/maturities',
        label: 'Register',
        icon: 'files',
        permission: 'case.view',
        description: 'The branch Excel sheet',
      },
      {
        href: '/maturities/new',
        label: 'New maturity',
        icon: 'plus',
        permission: 'case.create',
        description: 'Take one form in, with the live schedule',
      },
      {
        href: '/dashboard',
        label: 'Summary',
        icon: 'dashboard',
        permission: 'case.view',
        description: 'Totals across the register',
      },
      {
        href: '/approvals',
        label: 'Approvals',
        icon: 'inbox',
        permission: 'case.approve',
        badge: 'approvals',
        description: 'Forms waiting for sign-off',
      },
      {
        href: '/payouts',
        label: 'Payout desk',
        icon: 'wallet',
        permission: 'payout.record',
        badge: 'dueToday',
        description: 'Record what actually goes across the counter',
      },
      {
        href: '/follow-up',
        label: 'Follow-up',
        icon: 'shield',
        permission: 'case.view',
        description: 'Missed days, today’s counter, large cases, broken promises',
      },
    ],
  },
  {
    section: 'Plan',
    items: [
      {
        href: '/cash-planner',
        label: 'Cash runway',
        icon: 'banknote',
        permission: 'cash.plan',
        description: 'Cash and NEFT to hold, 14 working days',
      },
      {
        href: '/customers',
        label: 'Customers',
        icon: 'users',
        permission: 'case.view',
        description: 'Who is owed what, and when it lands',
      },
      {
        href: '/agents',
        label: 'Agents',
        icon: 'users',
        permission: 'agent.view',
        description: 'Per-agent totals',
      },
      {
        href: '/branches',
        label: 'Branches',
        icon: 'building',
        permission: 'branch.view',
        headOfficeOnly: true,
        description: 'Per-branch rollup',
      },
      {
        href: '/reports',
        label: 'Reports',
        icon: 'chart',
        permission: 'report.export',
        description: 'Excel and CSV downloads',
      },
    ],
  },
  {
    section: 'Control',
    items: [
      {
        href: '/audit',
        label: 'Audit log',
        icon: 'shield',
        permission: 'audit.view',
        description: 'Every action, immutable',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: 'settings',
        permission: 'case.view',
        description: 'Profile, users, holidays, organisation',
      },
    ],
  },
];

/**
 * Screens that carry a title but never appear in the sidebar, plus the ones
 * whose sidebar label is not what you want printed as a page heading.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/account': 'My profile',
  '/account/password': 'Change password',
  '/import': 'Import',
};

/**
 * The page name for the top bar. Longest matching prefix wins, so
 * `/maturities/<id>` still reads "Register" rather than falling back.
 */
export function pageTitleFor(pathname: string): string {
  const exact = EXTRA_TITLES[pathname];
  if (exact) return exact;

  const items = NAV.flatMap((s) => s.items);
  const hit = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return hit?.label ?? 'MaturityFlow';
}
