'use client';

import { Camera, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { removeOwnAvatarAction, updateOwnProfileAction, uploadOwnAvatarAction } from '@/actions/profile';
import { UserAvatar } from '@/components/domain/user-avatar';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import { formatPhone } from '@/lib/profile';
import { ROLE_LABEL } from '@/lib/rbac';
import type { Role } from '@/db/schema';

export function ProfileForm({
  userId,
  name,
  username,
  email,
  phone,
  employeeCode,
  hasAvatar,
  avatarAt,
  roleLabel,
  branchName,
}: {
  userId: string;
  name: string;
  username: string;
  email: string;
  phone: string | null;
  employeeCode: string | null;
  hasAvatar: boolean;
  avatarAt: number;
  roleLabel: Role;
  branchName: string | null;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateOwnProfileAction, null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      toast.success('Profile saved');
      router.refresh();
    } else if (state && !state.ok) {
      toast.error(state.error);
    }
  }, [state, router]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set('file', file);
    setPhotoBusy(true);
    const r = await uploadOwnAvatarAction(fd);
    setPhotoBusy(false);
    if (r.ok) {
      toast.success('Photo updated');
      router.refresh();
    } else toast.error(r.error);
  }

  async function onRemovePhoto() {
    setPhotoBusy(true);
    const r = await removeOwnAvatarAction();
    setPhotoBusy(false);
    if (r.ok) {
      toast.success('Photo removed');
      router.refresh();
    } else toast.error(r.error);
  }

  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Glass className="p-6">
      <div className="mb-6 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={photoBusy}
          className="relative shrink-0"
          aria-label="Change photo"
        >
          <UserAvatar userId={userId} name={name} hasAvatar={hasAvatar} version={avatarAt} size="xl" />
          <span className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--glass-border-quiet)] bg-[var(--page-bg)] text-[var(--muted-fg)] shadow-sm">
            <Camera className="h-3.5 w-3.5" />
          </span>
        </button>
        <div className="min-w-0">
          <p className="truncate text-[1.0625rem] font-semibold">{name}</p>
          <p className="text-[0.8125rem] text-[var(--muted-fg)]">
            {ROLE_LABEL[roleLabel]}
            {branchName ? ` · ${branchName}` : ''}
          </p>
          {employeeCode && (
            <p className="mt-0.5 text-[0.75rem] text-[var(--faint-fg)]">{employeeCode}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="glass" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {hasAvatar ? 'Change photo' : 'Add photo'}
            </Button>
            {hasAvatar && (
              <Button size="sm" variant="ghost" disabled={photoBusy} onClick={onRemovePhoto}>
                <Trash2 className="h-3.5 w-3.5" />
                Remove
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

      <form action={formAction} className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" required error={fe.name}>
          <Input name="name" defaultValue={name} required maxLength={80} />
        </Field>
        <Field label="Username" required error={fe.username} hint="Used to sign in, alongside email">
          <Input name="username" defaultValue={username} required autoComplete="username" maxLength={32} />
        </Field>
        <Field label="Email" required error={fe.email}>
          <Input name="email" type="email" defaultValue={email} required autoComplete="email" />
        </Field>
        <Field label="Phone" error={fe.phone}>
          <Input name="phone" type="tel" defaultValue={formatPhone(phone)} inputMode="tel" placeholder="98765 43210" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="primary" loading={pending}>
            Save profile
          </Button>
        </div>
      </form>
    </Glass>
  );
}
