'use client';

import {
  Camera,
  KeyRound,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { setUserActiveAction } from '@/actions/admin';
import {
  deleteUserAction,
  forcePasswordChangeAction,
  removeUserAvatarAction,
  restoreUserAction,
  revokeUserSessionAction,
  revokeUserSessionsAction,
  setUserPasswordAction,
  unlockUserAction,
  updateUserAction,
  uploadUserAvatarAction,
} from '@/actions/users';
import { UserAvatar } from '@/components/domain/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Glass, GlassCard } from '@/components/ui/glass';
import { Callout } from '@/components/ui/misc';
import { Money } from '@/components/ui/money';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { Role } from '@/db/schema';
import { formatPhone } from '@/lib/profile';
import { ROLE_LABEL } from '@/lib/rbac';

const ROLES: Role[] = ['CMD', 'CEO', 'ADMIN', 'OPS_HEAD', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'];

function when(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function uaShort(ua: string | null) {
  if (!ua) return 'unknown device';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return ua.slice(0, 48);
}

interface Dossier {
  user: {
    id: string;
    name: string;
    username: string;
    email: string;
    phone: string | null;
    employeeCode: string | null;
    role: Role;
    branchId: string | null;
    branchName: string | null;
    branchCode: string | null;
    avatarKey: string | null;
    notes: string | null;
    isActive: boolean;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
    failedLoginCount: number;
    lockedUntil: string | null;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  sessions: {
    id: string;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    ip: string | null;
    userAgent: string | null;
    isCurrent: boolean;
  }[];
  activity: {
    id: string;
    at: string;
    action: string;
    summary: string;
    ip: string | null;
    actorName: string;
  }[];
  cases: {
    id: string;
    caseNumber: string;
    status: string;
    customerName: string;
    maturityAmountPaise: string;
    createdAt: string;
  }[];
  payouts: {
    id: string;
    caseId: string;
    totalPaise: string;
    cashPaise: string;
    onlinePaise: string;
    valueDate: string;
    paidAt: string;
    reversedAt: string | null;
  }[];
  stats: {
    casesCreated: number;
    payoutsRecorded: number;
    documentsUploaded: number;
    liveSessions: number;
  };
}

export function UserDossier({
  dossier,
  branches,
  currentUserId,
}: {
  dossier: Dossier;
  branches: { id: string; code: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const u = dossier.user;
  const isSelf = u.id === currentUserId;
  // One clock reading per mount — see the note in user-manager.tsx.
  const [renderedAt] = useState(() => Date.now());
  const locked = Boolean(u.lockedUntil && new Date(u.lockedUntil).getTime() > renderedAt);
  const [state, formAction, pending] = useActionState(updateUserAction, null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success('User saved');
      router.refresh();
    } else if (state && !state.ok) toast.error(state.error);
  }, [state, router]);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      toast.success(okMsg);
      router.refresh();
    } else toast.error(r.error ?? 'Failed');
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    setBusy(true);
    const r = await uploadUserAvatarAction(u.id, fd);
    setBusy(false);
    if (r.ok) {
      toast.success('Photo updated');
      router.refresh();
    } else toast.error(r.error);
  }

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <div className="space-y-6">
      {u.deletedAt && (
        <Callout tone="danger" title="This account is deleted" icon={<Trash2 className="h-4 w-4" />}>
          They cannot sign in. Their name stays on any payouts or cases they recorded. Restore them
          below if this was a mistake.
        </Callout>
      )}
      {!u.deletedAt && !u.isActive && (
        <Callout tone="warn" title="Disabled" icon={<ShieldOff className="h-4 w-4" />}>
          Signed out of every device. They cannot log in until you reactivate them.
        </Callout>
      )}
      {locked && (
        <Callout tone="warn" title="Locked after failed sign-ins" icon={<ShieldAlert className="h-4 w-4" />}>
          Locked until {when(u.lockedUntil)}. Unlock immediately from Access.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Last signed in" value={when(u.lastLoginAt)} />
        <Stat label="Live sessions" value={String(dossier.stats.liveSessions)} />
        <Stat label="Cases created" value={String(dossier.stats.casesCreated)} />
        <Stat label="Payouts recorded" value={String(dossier.stats.payoutsRecorded)} />
      </div>

      <Glass className="p-6">
        <div className="mb-6 flex flex-wrap items-start gap-4">
          <button type="button" onClick={() => fileRef.current?.click()} className="relative shrink-0" aria-label="Change photo">
            <UserAvatar
              userId={u.id}
              name={u.name}
              hasAvatar={Boolean(u.avatarKey)}
              version={new Date(u.updatedAt).getTime()}
              size="xl"
            />
            <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--glass-border-quiet)] bg-[var(--page-bg)] text-[var(--muted-fg)]">
              <Camera className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[1.125rem] font-semibold">{u.name}</h2>
              <Badge tone={u.role === 'AUDITOR' ? 'neutral' : 'brand'}>{ROLE_LABEL[u.role]}</Badge>
              {u.deletedAt ? (
                <Badge tone="danger">deleted</Badge>
              ) : u.isActive ? (
                <Badge tone="money">active</Badge>
              ) : (
                <Badge tone="danger">disabled</Badge>
              )}
              {u.mustChangePassword && <Badge tone="warn">must change password</Badge>}
            </div>
            <p className="mt-1 text-[0.8125rem] text-[var(--muted-fg)]">
              @{u.username}
              {u.branchCode ? ` · ${u.branchCode}` : ' · Head office'}
              {u.employeeCode ? ` · ${u.employeeCode}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="glass" disabled={busy} onClick={() => fileRef.current?.click()}>
                {u.avatarKey ? 'Change photo' : 'Add photo'}
              </Button>
              {u.avatarKey && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => run(() => removeUserAvatarAction(u.id), 'Photo removed')}
                >
                  Remove photo
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              void onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <form action={formAction} autoComplete="off" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="userId" value={u.id} />
          <Field label="Full name" required error={fe.name}>
            <Input name="name" defaultValue={u.name} required />
          </Field>
          <Field label="Username" required error={fe.username}>
            <Input name="username" defaultValue={u.username} required />
          </Field>
          <Field label="Email" required error={fe.email}>
            <Input name="email" type="email" defaultValue={u.email} required />
          </Field>
          <Field label="Phone" error={fe.phone}>
            <Input name="phone" defaultValue={formatPhone(u.phone)} placeholder="98765 43210" />
          </Field>
          <Field label="Employee code" error={fe.employeeCode}>
            <Input name="employeeCode" defaultValue={u.employeeCode ?? ''} />
          </Field>
          <Field label="Role" required error={fe.role}>
            <Select name="role" defaultValue={u.role} disabled={isSelf}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch" hint="Blank for head-office roles">
            <Select name="branchId" defaultValue={u.branchId ?? ''}>
              <option value="">— none —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Force password change">
            <label className="flex h-10 items-center gap-2 text-[0.875rem]">
              <input
                type="checkbox"
                name="mustChangePassword"
                defaultChecked={u.mustChangePassword}
                className="h-4 w-4"
              />
              Must change at next sign-in
            </label>
          </Field>
          <Field label="Admin notes" className="sm:col-span-2 lg:col-span-3" hint="Only administrators see this">
            <Textarea name="notes" defaultValue={u.notes ?? ''} rows={3} />
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" variant="primary" loading={pending}>
              Save all fields
            </Button>
          </div>
        </form>
      </Glass>

      <GlassCard title="Access" subtitle="Disable, unlock, reset the password, or kick every device off.">
        <div className="flex flex-wrap gap-2">
          {locked && (
            <Button
              size="sm"
              variant="glass"
              disabled={busy}
              onClick={() => run(() => unlockUserAction(u.id), 'Account unlocked')}
            >
              <Unlock className="h-3.5 w-3.5" />
              Unlock now
            </Button>
          )}
          <Button
            size="sm"
            variant="glass"
            disabled={busy}
            onClick={() => run(() => forcePasswordChangeAction(u.id), 'They must change password next sign-in')}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            Force password change
          </Button>
          <Button
            size="sm"
            variant="glass"
            disabled={busy}
            onClick={async () => {
              const pw = window.prompt(`New temporary password for ${u.name} (10+ characters):`);
              if (!pw) return;
              await run(() => setUserPasswordAction(u.id, pw), 'Password reset — they must change it at next sign-in');
            }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Set new password
          </Button>
          <Button
            size="sm"
            variant="glass"
            disabled={busy}
            onClick={() => run(() => revokeUserSessionsAction(u.id), 'Signed out everywhere')}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out everywhere
          </Button>
          <Button
            size="sm"
            variant={u.isActive ? 'ghost' : 'primary'}
            disabled={busy || isSelf}
            onClick={() =>
              run(
                () => setUserActiveAction(u.id, !u.isActive),
                u.isActive ? 'Disabled and signed out' : 'Reactivated',
              )
            }
          >
            {u.isActive ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {u.isActive ? 'Disable account' : 'Reactivate'}
          </Button>
        </div>
        <p className="mt-3 text-[0.75rem] text-[var(--faint-fg)]">
          Failed sign-ins: {u.failedLoginCount}. Created {when(u.createdAt)}.
          {isSelf ? ' You cannot disable or delete yourself.' : ''}
        </p>
      </GlassCard>

      <GlassCard title="Sessions" subtitle="Each row is a device that has signed in as this person.">
        {dossier.sessions.length === 0 ? (
          <p className="text-[0.875rem] text-[var(--muted-fg)]">No sessions recorded.</p>
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Device</TH>
              <TH>From</TH>
              <TH>Status</TH>
              <TH />
            </THead>
            <TBody>
              {dossier.sessions.map((s) => (
                <TR key={s.id}>
                  <TD className="whitespace-nowrap text-[0.8125rem]">{when(s.createdAt)}</TD>
                  <TD className="text-[0.8125rem] text-[var(--muted-fg)]">{uaShort(s.userAgent)}</TD>
                  <TD className="font-mono text-[0.75rem] text-[var(--faint-fg)]">{s.ip ?? '—'}</TD>
                  <TD>
                    {s.isCurrent ? (
                      <Badge tone="money">this device</Badge>
                    ) : s.revokedAt ? (
                      <Badge tone="neutral">revoked</Badge>
                    ) : new Date(s.expiresAt).getTime() < renderedAt ? (
                      <Badge tone="neutral">expired</Badge>
                    ) : (
                      <Badge tone="brand">live</Badge>
                    )}
                  </TD>
                  <TD align="right">
                    {!s.revokedAt && !s.isCurrent && new Date(s.expiresAt).getTime() > renderedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => run(() => revokeUserSessionAction(s.id), 'Session revoked')}
                      >
                        Revoke
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </GlassCard>

      <GlassCard title="Activity" subtitle="Everything this person did, and everything an admin did to them.">
        {dossier.activity.length === 0 ? (
          <p className="text-[0.875rem] text-[var(--muted-fg)]">No audit entries yet.</p>
        ) : (
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>What</TH>
              <TH>From</TH>
            </THead>
            <TBody>
              {dossier.activity.map((a) => (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap text-[0.8125rem] text-[var(--muted-fg)]">{when(a.at)}</TD>
                  <TD className="text-[0.8125rem]">{a.actorName}</TD>
                  <TD className="max-w-[28rem] text-[0.8125rem] text-[var(--muted-fg)]">{a.summary}</TD>
                  <TD className="font-mono text-[0.75rem] text-[var(--faint-fg)]">{a.ip ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </GlassCard>

      {dossier.cases.length > 0 && (
        <GlassCard title="Cases they created">
          <Table>
            <THead>
              <TH>Case</TH>
              <TH>Customer</TH>
              <TH>Amount</TH>
              <TH>Status</TH>
              <TH>When</TH>
            </THead>
            <TBody>
              {dossier.cases.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-[0.8125rem]">
                    <a href={`/maturities/${c.id}`} className="hover:underline">
                      {c.caseNumber}
                    </a>
                  </TD>
                  <TD>{c.customerName}</TD>
                  <TD>
                    <Money paise={c.maturityAmountPaise} compact />
                  </TD>
                  <TD>
                    <Badge>{c.status}</Badge>
                  </TD>
                  <TD className="text-[0.8125rem] text-[var(--muted-fg)]">{when(c.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </GlassCard>
      )}

      {dossier.payouts.length > 0 && (
        <GlassCard title="Payouts they recorded">
          <Table>
            <THead>
              <TH>When</TH>
              <TH>Value date</TH>
              <TH>Amount</TH>
              <TH>Cash</TH>
              <TH>Online</TH>
            </THead>
            <TBody>
              {dossier.payouts.map((p) => (
                <TR key={p.id}>
                  <TD className="text-[0.8125rem]">{when(p.paidAt)}</TD>
                  <TD className="font-mono text-[0.8125rem]">{p.valueDate}</TD>
                  <TD>
                    <Money paise={p.totalPaise} compact />
                    {p.reversedAt && (
                      <span className="ml-2">
                        <Badge tone="danger">reversed</Badge>
                      </span>
                    )}
                  </TD>
                  <TD>
                    <Money paise={p.cashPaise} compact />
                  </TD>
                  <TD>
                    <Money paise={p.onlinePaise} compact />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </GlassCard>
      )}

      <GlassCard
        title="Delete"
        subtitle="They disappear from the live roster. Money they signed stays in the ledger under their name."
      >
        {u.deletedAt ? (
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => run(() => restoreUserAction(u.id), 'Account restored')}
          >
            Restore this account
          </Button>
        ) : (
          <div className="max-w-md space-y-3">
            <p className="text-[0.8125rem] text-[var(--muted-fg)]">
              Type <span className="font-semibold text-[var(--page-fg)]">{u.name}</span> to confirm.
              {dossier.stats.payoutsRecorded + dossier.stats.casesCreated + dossier.stats.documentsUploaded > 0
                ? ' They have financial records, so the row is kept as deleted rather than erased.'
                : ''}
            </p>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={u.name}
              disabled={isSelf}
              autoComplete="off"
            />
            <Button
              variant="danger"
              disabled={busy || isSelf || confirm !== u.name}
              onClick={() => run(() => deleteUserAction(u.id, confirm), 'Account deleted')}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {u.name}
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Glass className="p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">{label}</p>
      <p className="mt-1 truncate text-[1.0625rem] font-semibold">{value}</p>
    </Glass>
  );
}
