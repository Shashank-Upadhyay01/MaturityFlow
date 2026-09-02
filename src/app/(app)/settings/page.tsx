import {
  CalendarDays,
  FileSpreadsheet,
  Landmark,
  Shield,
  SlidersHorizontal,
  Sparkles,
  UserCircle2,
  Users2,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Glass, PageHeader } from '@/components/ui/glass';
import { getSession } from '@/lib/auth/session';
import { roleCan } from '@/lib/rbac';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const tiles = [
    {
      href: '/account',
      title: 'My profile',
      body: 'Name, username, email, phone, photo and password — yours, on this account.',
      icon: UserCircle2,
      allowed: true,
    },
    {
      href: '/settings/users',
      title: 'Users & roles',
      body: 'Create, edit, disable or delete anyone. Open a person to see every session, every action, and change anything on the fly.',
      icon: Users2,
      allowed: roleCan(session.role, 'user.manage'),
    },
    {
      href: '/settings/organisation',
      title: 'Organisation',
      body: 'Bank name, daily cash cap, default rounding and payout window. No code change needed.',
      icon: SlidersHorizontal,
      allowed: roleCan(session.role, 'settings.manage'),
    },
    {
      href: '/settings/holidays',
      title: 'Bank holidays',
      body: 'Days the counter is shut. No instalment is ever scheduled on one of these — add them before they arrive, not after.',
      icon: CalendarDays,
      allowed: roleCan(session.role, 'holiday.manage'),
    },
    {
      href: '/branches',
      title: 'Branches',
      body: 'Add or edit a branch: payout window, rounding step and daily cash the counter can hold.',
      icon: Landmark,
      allowed: roleCan(session.role, 'branch.manage') || roleCan(session.role, 'branch.view'),
    },
    {
      href: '/import',
      title: 'Import Excel register',
      body: 'Download a template or upload the sheet the branch already uses. Daily plans are calculated on import.',
      icon: FileSpreadsheet,
      allowed: roleCan(session.role, 'data.import'),
    },
    {
      href: '/audit',
      title: 'Audit log',
      body: 'Every action, immutable. Filter from here when you are tracing a person or a payout.',
      icon: Shield,
      allowed: roleCan(session.role, 'audit.view'),
    },
    {
      href: '/whats-new',
      title: "What's new",
      body: 'What changed in the app, in everyday words. Tell us if something went wrong.',
      icon: Sparkles,
      allowed: true,
    },
  ].filter((t) => t.allowed);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Your profile, and every dial an administrator can turn without a developer."
      />
      <div className="mf-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href}>
            <Glass interactive className="h-full p-5">
              <t.icon className="h-6 w-6 text-[var(--color-brand-500)]" />
              <p className="mt-3 text-[1.0625rem] font-semibold">{t.title}</p>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--muted-fg)]">{t.body}</p>
            </Glass>
          </Link>
        ))}
      </div>
    </div>
  );
}
