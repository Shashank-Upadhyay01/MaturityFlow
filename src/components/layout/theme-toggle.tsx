'use client';

import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The theme lives in one place: the `dark` class on <html>, applied before first paint by
 * the inline script in the root layout. This component reads it when clicked and lets CSS
 * express the icon state — no React state mirroring the DOM, so no hydration mismatch and
 * no cascading render.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('mf-theme', next ? 'dark' : 'light');
    } catch {
      /* private browsing — the theme just will not persist */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
      className={cn(
        'relative flex h-9 w-9 items-center justify-center rounded-[12px]',
        'border border-[var(--glass-border-quiet)] bg-[var(--glass-bg-subtle)]',
        'text-[var(--muted-fg)] transition-all duration-300 hover:text-[var(--page-fg)]',
        '[transition-timing-function:var(--ease-spring)] hover:scale-105 active:scale-95',
        className,
      )}
    >
      <Sun
        className={cn(
          'absolute h-4 w-4 transition-all duration-500 [transition-timing-function:var(--ease-spring)]',
          'rotate-0 scale-100 opacity-100 dark:rotate-90 dark:scale-0 dark:opacity-0',
        )}
      />
      <Moon
        className={cn(
          'absolute h-4 w-4 transition-all duration-500 [transition-timing-function:var(--ease-spring)]',
          '-rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100',
        )}
      />
    </button>
  );
}
