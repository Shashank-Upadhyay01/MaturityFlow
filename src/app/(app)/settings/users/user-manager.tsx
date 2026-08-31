'use client';

import { KeyRound, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createUserAction, resetUserPasswordAction, setUserActiveAction } from '@/actions/admin';
import { UserAvatar } from '@/components/domain/user-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { Role } from '@/db/schema';
import { ROLE_LABEL, ASSIGNABLE_ROLES, activeRole } from '@/lib/rbac';

/** Retired roles are not offered. ASSIGNABLE_ROLES is the single list. */
const ROLES = ASSIGNABLE_ROLES;

interface Row {
  id: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  deletedAt: string | null;
  avatarKey: string | null;
  updatedAt: string;
  branchName: string | null;
  branchCode: string | null;
}

export function UserManager({
  users,
  branches,
  currentUserId,
}: {
  users: Row[];
  branches: { id: string; code: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  // One clock reading per mount. Calling Date.now() inside the row map made the render
  // impure — two renders of the same data could disagree about whether an account is locked.
  const [renderedAt] = useState(() => Date.now());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'disabled' | 'deleted'>('active');
  const [state, formAction, pending] = useActionState(createUserAction, null);

  const showForm = adding && !state?.ok;

  useEffect(() => {
    if (state?.ok) {
      toast.success('User created — they must change their password at first sign-in');
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  async function toggle(id: string, active: boolean) {
    setBusy(true);
    const r = await setUserActiveAction(id, active);
    setBusy(false);
    if (r.ok) {
      toast.success(active ? 'User reactivated' : 'User deactivated and signed out everywhere');
      router.refresh();
    } else toast.error(r.error);
  }

  async function reset(id: string, name: string) {
    const pw = window.prompt(`New temporary password for ${name} (10+ characters):`);
    if (!pw) return;
    setBusy(true);
    const r = await resetUserPasswordAction(id, pw);
    setBusy(false);
    if (r.ok) {
      toast.success('Password reset — they must change it at next sign-in');
      router.refresh();
    } else toast.error(r.error);
  }

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const visible = users.filter((u) => {
    if (filter === 'deleted') return Boolean(u.deletedAt);
    if (filter === 'disabled') return !u.isActive && !u.deletedAt;
    if (filter === 'active') return u.isActive && !u.deletedAt;
    return true;
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['active', 'Active'],
              ['disabled', 'Disabled'],
              ['deleted', 'Deleted'],
              ['all', 'All'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={
                filter === k
                  ? 'rounded-full bg-[var(--color-brand-600)] px-2.5 py-1 text-[0.75rem] font-medium text-white'
                  : 'rounded-full px-2.5 py-1 text-[0.75rem] text-[var(--muted-fg)] hover:bg-[var(--glass-bg-subtle)]'
              }
            >
              {label}
            </button>
          ))}
          <p className="ml-2 text-[0.8125rem] text-[var(--muted-fg)]">
            {users.filter((u) => u.isActive && !u.deletedAt).length} active of {users.length}
          </p>
        </div>
        <Button variant={showForm ? 'ghost' : 'primary'} size="sm" onClick={() => setAdding((v) => !v)}>
          <UserPlus className="h-3.5 w-3.5" />
          {showForm ? 'Cancel' : 'Add user'}
        </Button>
      </div>

      {showForm && (
        <form action={formAction} className="mf-fade grid gap-4 border-b px-5 py-5 sm:grid-cols-3 sm:px-6">
          <Field label="Full name" required error={fe.name}>
            <Input name="name" required placeholder="Aarti Deshmukh" />
          </Field>
          <Field label="Username" required error={fe.username} hint="They can sign in with this or email">
            <Input name="username" required placeholder="aarti" autoComplete="off" />
          </Field>
          <Field label="Email" required error={fe.email}>
            <Input name="email" type="email" required placeholder="name@bank.test" />
          </Field>
          <Field label="Phone" error={fe.phone}>
            <Input name="phone" placeholder="98765 43210" />
          </Field>
          <Field label="Employee code" error={fe.employeeCode}>
            <Input name="employeeCode" placeholder="EMP0012" />
          </Field>
          <Field label="Role" required error={fe.role}>
            <Select name="role" defaultValue="CASHIER">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Branch" hint="Leave blank for head-office roles">
            <Select name="branchId" defaultValue="">
              <option value="">— none —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Temporary password" required error={fe.password} hint="They must change it at first sign-in">
            <Input name="password" type="text" required minLength={10} placeholder="At least 10 characters" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" variant="primary" loading={pending}>
              Create user
            </Button>
          </div>
        </form>
      )}

      <Table>
        <THead>
          <TH>Name</TH>
          <TH>Username</TH>
          <TH>Role</TH>
          <TH>Branch</TH>
          <TH>Last signed in</TH>
          <TH>Status</TH>
          <TH />
        </THead>
        <TBody>
          {visible.map((u) => {
            const locked = Boolean(u.lockedUntil && new Date(u.lockedUntil).getTime() > renderedAt);
            return (
              <TR key={u.id} className={u.isActive && !u.deletedAt ? '' : 'opacity-55'}>
                <TD>
                  <Link href={`/settings/users/${u.id}`} className="flex items-center gap-2.5 hover:underline">
                    <UserAvatar
                      userId={u.id}
                      name={u.name}
                      hasAvatar={Boolean(u.avatarKey)}
                      version={u.updatedAt}
                      size="sm"
                    />
                    <span>
                      <span className="block font-medium">{u.name}</span>
                      <span className="block text-[0.75rem] text-[var(--faint-fg)]">
                        {u.employeeCode ?? u.email}
                      </span>
                    </span>
                  </Link>
                </TD>
                <TD className="text-[var(--muted-fg)]">@{u.username}</TD>
                <TD>
                  <Badge tone={u.role === 'AUDITOR' ? 'neutral' : 'brand'}>{ROLE_LABEL[activeRole(u.role)]}</Badge>
                </TD>
                <TD className="text-[var(--muted-fg)]">{u.branchCode ?? '—'}</TD>
                <TD className="text-[0.8125rem] text-[var(--muted-fg)]">
                  {u.lastLoginAt
                    ? new Date(u.lastLoginAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata',
                      })
                    : 'never'}
                </TD>
                <TD>
                  {u.deletedAt ? (
                    <Badge tone="danger">deleted</Badge>
                  ) : !u.isActive ? (
                    <Badge tone="danger">disabled</Badge>
                  ) : locked ? (
                    <Badge tone="warn">locked</Badge>
                  ) : u.mustChangePassword ? (
                    <Badge tone="warn">must change password</Badge>
                  ) : (
                    <Badge tone="money">active</Badge>
                  )}
                </TD>
                <TD align="right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/settings/users/${u.id}`}>Open</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => reset(u.id, u.name)}
                      aria-label={`Reset password for ${u.name}`}
                      title={`Reset password for ${u.name}`}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || u.id === currentUserId || Boolean(u.deletedAt)}
                      onClick={() => toggle(u.id, !u.isActive)}
                      aria-label={`${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.name}`}
                      title={u.id === currentUserId ? 'You cannot deactivate yourself' : `${u.isActive ? 'Deactivate' : 'Reactivate'} ${u.name}`}
                    >
                      {u.isActive ? (
                        <ShieldOff className="h-3.5 w-3.5" />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
