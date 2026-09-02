'use client';

import {
  BookOpenCheck,
  Building2,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  ContactRound,
  FileSpreadsheet,
  FileUp,
  HandCoins,
  Handshake,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  ScrollText,
  SlidersHorizontal,
  Vault,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { SessionUser } from '@/lib/auth/session';
import { ROLE_SCOPE, activeRole, roleCan } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { NAV, TOP_LEVEL_NAV, type NavItem } from './nav-config';

const ICONS: Record<NavItem['icon'], LucideIcon> = {
  summary: LayoutDashboard,
  register: FileSpreadsheet,
  cashbook: BookOpenCheck,
  maturities: ClipboardCheck,
  payout: HandCoins,
  followUp: ListTodo,
  maturityCalendar: CalendarClock,
  cashRunway: Vault,
  customers: ContactRound,
  agents: Handshake,
  branches: Building2,
  import: FileUp,
  reports: ChartNoAxesCombined,
  audit: ScrollText,
  settings: SlidersHorizontal,
};

export interface NavBadges {
  dueToday?: number;
  overdue?: number;
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
}

function badgeText(count: number | undefined) {
  if (!count || count < 1) return null;
  return count > 99 ? '99+' : String(count);
}

function Destination({
  item,
  pathname,
  badges,
  compact = false,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  badges: NavBadges;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];
  const active = isActive(pathname, item.href);
  const count = item.badge ? badgeText(badges[item.badge]) : null;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex min-w-0 items-start gap-2.5 rounded-[11px] border px-3 py-2.5 transition-colors',
        active
          ? 'border-[color-mix(in_oklab,var(--color-brand-500)_28%,var(--glass-border))] bg-[var(--color-brand-50)] text-[var(--page-fg)]'
          : 'border-transparent text-[var(--muted-fg)] hover:border-[var(--glass-border-quiet)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
      )}
    >
      <span
        data-nav-icon={item.icon}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)] text-[var(--muted-fg)]',
          active && 'border-[color-mix(in_oklab,var(--color-brand-500)_24%,var(--glass-border))] bg-[color-mix(in_oklab,var(--color-brand-500)_10%,var(--surface-solid))] text-[var(--color-brand-500)]',
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.8125rem] font-semibold">{item.label}</span>
          {count && (
            <span className="rounded-full bg-[var(--color-brand-500)] px-1.5 py-0.5 text-[0.625rem] font-bold leading-none text-white">
              {count}
            </span>
          )}
        </span>
        {!compact && (
          <span className="mt-0.5 block text-[0.6875rem] leading-snug text-[var(--faint-fg)]">
            {item.description}
          </span>
        )}
      </span>
    </Link>
  );
}

export function TopNavigation({
  session,
  badges,
  mobile = false,
  onNavigate,
}: {
  session: SessionUser;
  badges: NavBadges;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const rootRef = useRef<HTMLElement>(null);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const sections = NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!roleCan(session.role, item.permission)) return false;
      return !item.headOfficeOnly || ROLE_SCOPE[activeRole(session.role)] === 'ALL';
    }),
  })).filter((section) => section.items.length > 0);
  const topLevelItems = TOP_LEVEL_NAV.filter((item) => {
    if (!roleCan(session.role, item.permission)) return false;
    return !item.headOfficeOnly || ROLE_SCOPE[activeRole(session.role)] === 'ALL';
  });

  useEffect(() => {
    if (!openSection) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenSection(null);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSection(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [openSection]);

  const finishNavigation = () => {
    setOpenSection(null);
    onNavigate?.();
  };

  if (mobile) {
    return (
      <nav aria-label="Main" className="grid gap-3 p-3 sm:grid-cols-2">
        {topLevelItems.map((item) => (
          <div key={item.href} className="sm:col-span-2">
            <Destination item={item} pathname={pathname} badges={badges} compact onNavigate={finishNavigation} />
          </div>
        ))}
        {sections.map((section) => (
          <section key={section.section} className="border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)] p-2">
            <h2 className="px-2 pb-1.5 pt-1 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-[var(--faint-fg)]">
              {section.section}
            </h2>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <Destination key={item.href} item={item} pathname={pathname} badges={badges} compact onNavigate={finishNavigation} />
              ))}
            </div>
          </section>
        ))}
      </nav>
    );
  }

  return (
    <nav ref={rootRef} aria-label="Main" className="flex h-10 items-center gap-1">
      {topLevelItems.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[0.78rem] font-semibold transition-colors',
              active
                ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
            )}
          >
            <Icon data-nav-icon={item.icon} className="h-3.5 w-3.5" strokeWidth={1.9} />
            {item.label}
          </Link>
        );
      })}
      {topLevelItems.length > 0 && sections.length > 0 && (
        <span className="mx-1 h-5 w-px bg-[var(--glass-border-quiet)]" aria-hidden />
      )}
      {sections.map((section) => {
        const active = section.items.some((item) => isActive(pathname, item.href));
        const expanded = openSection === section.section;
        const sectionBadge = section.items.reduce((total, item) => {
          if (!item.badge) return total;
          return total + (badges[item.badge] ?? 0);
        }, 0);

        return (
          <div key={section.section} className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={expanded}
              onClick={() => setOpenSection(expanded ? null : section.section)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[0.78rem] font-semibold transition-colors',
                active || expanded
                  ? 'bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                  : 'text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]',
              )}
            >
              {section.section}
              {sectionBadge > 0 && (
                <span className="rounded-full bg-[var(--color-brand-500)] px-1.5 py-0.5 text-[0.625rem] font-bold leading-none text-white">
                  {sectionBadge > 99 ? '99+' : sectionBadge}
                </span>
              )}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
            </button>

            {expanded && (
              <div className="absolute left-0 top-full z-50 pt-1.5">
                <div className="glass w-[34rem] p-2 shadow-[var(--glass-shadow-lifted)]">
                  <div className="mb-1 flex items-center justify-between px-2 py-1">
                    <p className="text-[0.6875rem] font-bold uppercase tracking-[0.11em] text-[var(--faint-fg)]">
                      {section.section}
                    </p>
                    <p className="text-[0.6875rem] text-[var(--faint-fg)]">{section.items.length} destinations</p>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {section.items.map((item) => (
                      <Destination key={item.href} item={item} pathname={pathname} badges={badges} onNavigate={finishNavigation} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
