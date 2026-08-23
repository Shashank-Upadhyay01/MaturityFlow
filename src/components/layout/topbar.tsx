'use client';

import { KeyRound, LogOut, Menu, UserCircle2, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { logoutAction } from '@/actions/auth';
import { Sidebar, type NavBadges } from './sidebar';
import { ThemeToggle } from './theme-toggle';
import type { SessionUser } from '@/lib/auth/session';
import { ROLE_LABEL, ROLE_SHORT } from '@/lib/rbac';
import { UserAvatar } from '@/components/domain/user-avatar';
import { cn } from '@/lib/utils';

export function Topbar({
  session,
  badges,
  todayLabel,
}: {
  session: SessionUser;
  badges: NavBadges;
  todayLabel: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);

  return (
    <>
      <header className="glass glass-flat sticky top-0 z-30 flex h-14 items-center gap-3 rounded-none border-x-0 border-t-0 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
          className="rounded-[11px] p-2 text-[var(--muted-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)] xl:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] text-[var(--muted-fg)]">
            <span className="font-medium text-[var(--page-fg)]">{todayLabel}</span>
            {session.branchName && (
              <>
                <span className="mx-2 text-[var(--faint-fg)]">·</span>
                {session.branchCode} {session.branchName}
              </>
            )}
          </p>
        </div>

        <ThemeToggle />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={cn(
              'flex items-center gap-2 rounded-[13px] border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)] py-1 pl-1 pr-2.5',
              'transition-all duration-300 hover:bg-[var(--glass-bg-strong)]',
            )}
          >
            <UserAvatar
              userId={session.id}
              name={session.name}
              hasAvatar={session.hasAvatar}
              version={session.avatarAt}
              size="sm"
            />
            <span className="hidden text-left sm:block">
              <span className="block max-w-[9rem] truncate text-[0.8125rem] font-medium leading-tight">
                {session.name}
              </span>
              <span className="block text-[0.6875rem] leading-tight text-[var(--faint-fg)]">
                {ROLE_SHORT[session.role]}
              </span>
            </span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                role="menu"
                className="glass mf-rise absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden p-1.5"
              >
                <div className="border-b px-3 py-2.5">
                  <p className="truncate text-[0.875rem] font-medium">{session.name}</p>
                  <p className="truncate text-[0.75rem] text-[var(--muted-fg)]">
                    @{session.username} · {session.email}
                  </p>
                  <p className="mt-1 text-[0.6875rem] text-[var(--faint-fg)]">
                    {ROLE_LABEL[session.role]}
                    {session.branchName ? ` · ${session.branchName}` : ''}
                  </p>
                </div>
                <Link
                  href="/account"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-[11px] px-3 py-2 text-[0.875rem] text-[var(--muted-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]"
                >
                  <UserCircle2 className="h-4 w-4" />
                  My profile
                </Link>
                <Link
                  href="/account/password"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 rounded-[11px] px-3 py-2 text-[0.875rem] text-[var(--muted-fg)] transition-colors hover:bg-[var(--glass-bg-subtle)] hover:text-[var(--page-fg)]"
                >
                  <KeyRound className="h-4 w-4" />
                  Change password
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2.5 rounded-[11px] px-3 py-2 text-left text-[0.875rem] text-[var(--color-danger-500)] transition-colors hover:bg-[color-mix(in_oklab,var(--color-danger-500)_10%,transparent)]"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </header>

      {drawer && (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="mf-fade absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <div className="glass mf-rise absolute left-0 top-0 h-full w-[16.5rem] rounded-l-none p-3">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 rounded-[9px] p-1.5 text-[var(--faint-fg)] hover:bg-[var(--glass-bg-subtle)]"
            >
              <X className="h-4 w-4" />
            </button>
            <Sidebar session={session} badges={badges} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
}
