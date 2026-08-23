import type { Permission } from '@/lib/rbac';

export interface NavItem {
  href: string;
  label: string;
  icon:
    | 'dashboard' | 'plus' | 'inbox' | 'files' | 'wallet' | 'banknote'
    | 'users' | 'building' | 'chart' | 'shield' | 'settings';
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
      { href: '/maturities', label: 'Register', icon: 'files', permission: 'case.view', description: 'The branch Excel sheet' },
      { href: '/dashboard', label: 'Summary', icon: 'dashboard', permission: 'case.view', description: 'Totals across the register' },
      { href: '/approvals', label: 'Approvals', icon: 'inbox', permission: 'case.approve', badge: 'approvals', description: 'Forms waiting for sign-off' },
    ],
  },
  {
    section: 'Plan',
    items: [
      { href: '/cash-planner', label: 'Cash runway', icon: 'banknote', permission: 'cash.plan', description: 'Cash and NEFT to hold, 14 working days' },
      { href: '/agents', label: 'Agents', icon: 'users', permission: 'agent.view', description: 'Per-agent totals' },
      { href: '/branches', label: 'Branches', icon: 'building', permission: 'branch.view', headOfficeOnly: true, description: 'Per-branch rollup' },
      { href: '/reports', label: 'Reports', icon: 'chart', permission: 'report.export', description: 'Excel and CSV downloads' },

    ],
  },
  {
    section: 'Control',
    items: [
      { href: '/audit', label: 'Audit log', icon: 'shield', permission: 'audit.view', description: 'Every action, immutable' },
      { href: '/settings', label: 'Settings', icon: 'settings', permission: 'case.view', description: 'Profile, users, holidays, organisation' },
    ],
  },
];
