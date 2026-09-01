import type { Permission } from '@/lib/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon:
    | 'dashboard'
    | 'plus'
    | 'inbox'
    | 'files'
    | 'upload'
    | 'calendar'
    | 'wallet'
    | 'banknote'
    | 'calculator'
    | 'users'
    | 'building'
    | 'chart'
    | 'shield'
    | 'settings';
  permission: Permission;
  /** Only shown to roles whose scope spans every branch. */
  headOfficeOnly?: boolean;
  badge?: 'dueToday' | 'overdue';
  description: string;
}

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Daily work',
    items: [
      {
        href: '/maturities',
        label: 'Register',
        icon: 'files',
        permission: 'case.view',
        description: 'The branch Excel sheet',
      },
      {
        href: '/cashbook',
        label: 'Daily cashbook',
        icon: 'calculator',
        permission: 'cashbook.view',
        description: 'Balance receipts, withdrawals and the physical drawer',
      },
      {
        href: '/maturity-operations',
        label: 'Maturities',
        icon: 'inbox',
        permission: 'case.approve',
        description: 'Operations review, automatic progression and payout dates',
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
    section: 'Planning',
    items: [
      {
        href: '/maturity-calendar',
        label: 'Maturity calendar',
        icon: 'calendar',
        permission: 'case.view',
        description: 'Current and next month upcoming maturities',
      },
      {
        href: '/cash-planner',
        label: 'Cash runway',
        icon: 'banknote',
        permission: 'cash.plan',
        description: 'Cash and NEFT to hold, 14 working days',
      },
      {
        href: '/dashboard',
        label: 'Summary',
        icon: 'dashboard',
        permission: 'case.view',
        description: 'Totals across the register',
      },
    ],
  },
  {
    section: 'Directory',
    items: [
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
    ],
  },
  {
    section: 'Administration',
    items: [
      {
        href: '/import',
        label: 'Import register',
        icon: 'upload',
        permission: 'data.import',
        description: 'Upload one branch or auto-sort a compiled workbook',
      },
      {
        href: '/reports',
        label: 'Reports',
        icon: 'chart',
        permission: 'report.export',
        description: 'Excel and CSV downloads',
      },
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
 * Screens that carry a title but never appear in the navigation, plus the ones
 * whose navigation label is not what you want printed as a page heading.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/account': 'My profile',
  '/account/password': 'Change password',
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
