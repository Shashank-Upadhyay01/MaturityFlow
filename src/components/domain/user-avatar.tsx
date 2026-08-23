import { cn, initials } from '@/lib/utils';

export function UserAvatar({
  userId,
  name,
  hasAvatar,
  version,
  size = 'md',
  className,
}: {
  userId: string;
  name: string;
  hasAvatar: boolean;
  version?: number | string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const box = {
    sm: 'h-7 w-7 rounded-[9px] text-[0.6875rem]',
    md: 'h-9 w-9 rounded-[11px] text-[0.75rem]',
    lg: 'h-14 w-14 rounded-[16px] text-[1rem]',
    xl: 'h-20 w-20 rounded-[22px] text-[1.25rem]',
  }[size];

  if (hasAvatar) {
    const v = version ? `?v=${version}` : '';
    return (
      // Plain <img>: avatars are served from our own /api/avatars route at a fixed
      // box size, so next/image's optimiser would add work without adding anything.
      <img
        src={`/api/avatars/${userId}${v}`}
        alt=""
        className={cn(box, 'object-cover', className)}
      />
    );
  }

  return (
    <span
      className={cn(
        box,
        'inline-flex items-center justify-center bg-gradient-to-br from-[var(--color-brand-400)] to-[var(--color-brand-600)] font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
