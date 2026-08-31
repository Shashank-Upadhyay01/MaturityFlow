'use client';

import {
  Banknote,
  Building2,
  Calculator,
  CalendarDays,
  ChevronLeft,
  FileStack,
  LayoutDashboard,
  type LucideIcon,
  Inbox,
  PieChart,
  Plus,
  Settings,
  Shield,
  Upload,
  Users,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { NAV } from './nav-config';
import type { SessionUser } from '@/lib/auth/session';
import { ROLE_SCOPE, roleCan, activeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  plus: Plus,
  inbox: Inbox,
  files: FileStack,
  upload: Upload,
  wallet: Wallet,
  banknote: Banknote,
  calculator: Calculator,
  calendar: CalendarDays,
  users: Users,
  building: Building2,
  chart: PieChart,
  shield: Shield,
  settings: Settings,
};

export interface NavBadges {
  dueToday?: number;
  overdue?: number;
}

export function Sidebar({
  session,
  badges,
  onNavigate,
}: {
  session: SessionUser;
  badges: NavBadges;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const sections = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => {
      if (!roleCan(session.role, i.permission)) return false;
      if (i.headOfficeOnly && ROLE_SCOPE[activeRole(session.role)] !== 'ALL') return false;
      return true;
    }),
  })).filter((s) => s.items.length > 0);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full flex-col gap-1 transition-[width] duration-500 [transition-timing-function:var(--ease-out-quint)]',
        collapsed ? 'w-[4.5rem]' : 'w-[15.5rem]',
      )}
    >
      <div className={cn('flex items-center gap-2.5 px-3 pb-3 pt-1', collapsed && 'justify-center px-0')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-[var(--color-brand-400)] to-[var(--color-brand-600)] shadow-[0_4px_12px_-4px_rgba(79,70,229,0.7)]">
          <Building2 className="h-[18px] w-[18px] text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.9375rem] font-semibold leading-tight tracking-[-0.01em]">
              {session.orgShortName || 'MaturityFlow'}
            </p>
            <p className="truncate text-[0.6875rem] text-[var(--faint-fg)]">
              {session.branchName ?? 'Head Office'}
            </p>
          </div>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className="hidden shrink-0 rounded-[9px] p-1.5 text-[var(--faint-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)] xl:block"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className="mx-auto mb-2 rounded-[9px] p-1.5 text-[var(--faint-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)]"
        >
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {sections.map((section) => (
          <div key={section.section}>
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[var(--faint-fg)]">
                {section.section}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active =
                  pathname === item.href ||
                  (item.href !== '/maturities' &&
                    item.href !== '/dashboard' &&
                    pathname.startsWith(item.href) &&
                    !(item.href === '/maturities' && pathname === '/maturities/new'));
                const badgeCount = item.badge ? badges[item.badge] : undefined;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : item.description}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-[13px] px-3 py-2 text-[0.875rem] font-medium',
                        'transition-all duration-300 [transition-timing-function:var(--ease-out-quint)]',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-[var(--glass-bg-strong)] text-[var(--page-fg)] shadow-[0_1px_0_var(--glass-highlight)_inset,0_4px_14px_-6px_rgba(15,23,42,0.25)]'
                          : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[var(--color-brand-500)]" />
                      )}
                      <Icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0 transition-transform duration-300',
                          active ? 'text-[var(--color-brand-500)]' : '',
                          'group-hover:scale-110',
                        )}
                      />
                      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                      {!collapsed && badgeCount != null && badgeCount > 0 && (
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums',
                            item.badge === 'overdue'
                              ? 'bg-[var(--color-danger-500)] text-white'
                              : 'bg-[var(--color-brand-500)] text-white',
                          )}
                        >
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </span>
                      )}
                      {collapsed && badgeCount != null && badgeCount > 0 && (
                        <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-[var(--color-brand-500)]" />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
