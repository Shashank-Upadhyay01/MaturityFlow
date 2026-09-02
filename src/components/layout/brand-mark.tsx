import { cn } from '@/lib/utils';

export function BrandMark({
  animated = false,
  className,
}: {
  animated?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('brand-mark', animated && 'brand-mark--animated', className)}
    >
      <span className="brand-mark__orbit" />
      <span className="brand-mark__tile">
        <svg viewBox="0 0 48 48" fill="none" className="h-full w-full" aria-hidden="true">
          <path
            className="brand-mark__stroke"
            d="M15 12v24M16 24h6.5M31.5 12.5 21 24l11 11.5"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            className="brand-mark__ledger"
            d="M34.5 17.5h3M34.5 24h3M34.5 30.5h3"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
    </span>
  );
}
