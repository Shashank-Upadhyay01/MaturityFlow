'use client';

import { KeyRound, LogOut, Menu, UserCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { logoutAction } from '@/actions/auth';
import { UserAvatar } from '@/components/domain/user-avatar';
import { BrandMark } from '@/components/layout/brand-mark';
import type { SessionUser } from '@/lib/auth/session';
import { PRODUCT_NAME } from '@/lib/brand';
import { ROLE_LABEL, ROLE_SHORT, activeRole } from '@/lib/rbac';
import { cn } from '@/lib/utils';
import { pageTitleFor } from './nav-config';
import { GlobalSearch } from './global-search';
import { ThemeToggle } from './theme-toggle';
import { TopNavigation, type NavBadges } from './top-navigation';

export function Topbar({
  session,
  badges,
  todayLabel,
}: {
  session: SessionUser;
  badges: NavBadges;
  todayLabel: string;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const pathname = usePathname();
  const title = pageTitleFor(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--glass-border)] bg-[var(--surface-solid)] shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="flex h-12 items-center gap-3 px-3 sm:px-4">
        <button
          type="button"
          onClick={() => {
            setNavigationOpen((open) => !open);
            setAccountOpen(false);
          }}
          aria-label={navigationOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navigationOpen}
          className="-ml-1 rounded-[9px] p-1.5 text-[var(--muted-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)] lg:hidden"
        >
          {navigationOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5" aria-label="Open Summary">
          <BrandMark className="h-8 w-8" />
          <span className="hidden sm:block">
            <span className="block max-w-[10rem] truncate text-[0.875rem] font-bold leading-tight tracking-[-0.01em]">
              {PRODUCT_NAME}
            </span>
            <span className="block max-w-[10rem] truncate text-[0.625rem] leading-tight text-[var(--faint-fg)]">
              {session.branchName ?? 'Head Office'}
            </span>
          </span>
        </Link>

        <span className="hidden h-6 w-px bg-[var(--glass-border-quiet)] sm:block" aria-hidden />

        <div className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-bold uppercase leading-tight tracking-[0.07em]">{title}</span>
          {session.branchName && (
            <span className="block truncate text-[0.625rem] leading-tight text-[var(--faint-fg)]">
              {session.branchCode} · {session.branchName}
            </span>
          )}
        </div>

        <span className="hidden whitespace-nowrap text-[0.72rem] tabular-nums text-[var(--muted-fg)] md:block">{todayLabel}</span>

        <GlobalSearch permissions={session.permissions} />

        <ThemeToggle className="h-8 w-8 rounded-[10px]" />

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAccountOpen((open) => !open);
              setNavigationOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            className={cn(
              'flex items-center gap-2 rounded-[11px] border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)] py-0.5 pl-0.5 pr-2',
              'transition-colors hover:bg-[var(--glass-bg-strong)]',
            )}
          >
            <UserAvatar userId={session.id} name={session.name} hasAvatar={session.hasAvatar} version={session.avatarAt} size="sm" />
            <span className="hidden text-left sm:block">
              <span className="block max-w-[8rem] truncate text-[0.75rem] font-semibold leading-tight">{session.name}</span>
              <span className="block text-[0.625rem] leading-tight text-[var(--faint-fg)]">{ROLE_SHORT[activeRole(session.role)]}</span>
            </span>
          </button>

          {accountOpen && (
            <>
              <button type="button" tabIndex={-1} aria-hidden className="fixed inset-0 z-40 cursor-default" onClick={() => setAccountOpen(false)} />
              <div className="absolute right-0 top-full z-50 pt-2">
                <div role="menu" className="glass mf-rise w-64 overflow-hidden p-1.5">
                  <div className="border-b px-3 py-2.5">
                    <p className="truncate text-[0.875rem] font-semibold">{session.name}</p>
                    <p className="truncate text-[0.75rem] text-[var(--muted-fg)]">@{session.username} · {session.email}</p>
                    <p className="mt-1 text-[0.6875rem] text-[var(--faint-fg)]">
                      {ROLE_LABEL[activeRole(session.role)]}{session.branchName ? ` · ${session.branchName}` : ''}
                    </p>
                  </div>
                  <Link href="/account" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[0.8125rem] text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]">
                    <UserCircle2 className="h-4 w-4" />My profile
                  </Link>
                  <Link href="/account/password" onClick={() => setAccountOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[0.8125rem] text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]">
                    <KeyRound className="h-4 w-4" />Change password
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit" className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-[0.8125rem] text-[var(--color-danger-500)] hover:bg-[color-mix(in_oklab,var(--color-danger-500)_10%,transparent)]">
                      <LogOut className="h-4 w-4" />Sign out
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="hidden h-10 items-center border-t border-[var(--glass-border-quiet)] px-4 lg:flex">
        <TopNavigation session={session} badges={badges} />
      </div>

      {navigationOpen && (
        <>
          <button type="button" tabIndex={-1} aria-hidden className="fixed inset-x-0 bottom-0 top-12 z-40 bg-black/35 backdrop-blur-[2px] lg:hidden" onClick={() => setNavigationOpen(false)} />
          <div className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-3rem)] overflow-y-auto border-b border-[var(--glass-border)] bg-[var(--surface-solid)] shadow-[0_16px_35px_-20px_rgba(15,23,42,0.55)] lg:hidden">
            <TopNavigation session={session} badges={badges} mobile onNavigate={() => setNavigationOpen(false)} />
          </div>
        </>
      )}
    </header>
  );
}
