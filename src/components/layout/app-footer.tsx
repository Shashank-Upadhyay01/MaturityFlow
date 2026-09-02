import { cn } from '@/lib/utils';

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        'no-print flex w-full flex-col items-center justify-between gap-1 border-t border-[var(--glass-border-quiet)] px-4 py-3 text-center text-[0.6875rem] leading-relaxed text-[var(--faint-fg)] sm:flex-row sm:px-6 sm:text-left',
        className,
      )}
    >
      <span>Created and developed by Shashank Upadhyay · Archeon Solutions</span>
      <span>© 2026 Shashank Upadhyay &amp; Archeon Solutions. All rights reserved.</span>
    </footer>
  );
}
