'use client';

import { HelpCircle, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { searchTips } from '@/lib/workspace-guide';
import { cn } from '@/lib/utils';

export interface GuideUpdate {
  id: string;
  title: string;
  kind: string;
  publishedAt: string;
}

const SEEN_KEY = 'kggnl.guide.seenUpdateId';

export function WorkspaceGuide({ latestUpdate }: { latestUpdate: GuideUpdate | null }) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    if (!latestUpdate) return;
    try {
      setUnseen(localStorage.getItem(SEEN_KEY) !== latestUpdate.id);
    } catch {
      setUnseen(true);
    }
  }, [latestUpdate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function markSeen() {
    if (!latestUpdate) return;
    try {
      localStorage.setItem(SEEN_KEY, latestUpdate.id);
    } catch { /* ignore */ }
    setUnseen(false);
  }

  const tips = useMemo(() => searchTips(query, pathname), [query, pathname]);
  const here = tips.slice(0, 4);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) markSeen();
        }}
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--surface-solid)] px-3.5 text-[0.8125rem] font-semibold shadow-[0_8px_24px_-12px_rgb(0_0_0/0.45)] hover:bg-[var(--glass-bg-subtle)] print:hidden"
        aria-label="Open guide"
        title="Guide — press ?"
      >
        <HelpCircle className="h-4 w-4 text-[var(--color-brand-600)]" />
        Guide
        {unseen && (
          <span className="rounded-full bg-[var(--color-brand-500)] px-1.5 py-0.5 text-[0.62rem] font-bold text-white">
            New
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed bottom-20 right-4 z-40 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-[16px] border border-[var(--glass-border)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.45)] print:hidden"
          style={{ background: 'var(--surface-solid)' }}
          role="dialog"
          aria-label="Workspace guide"
        >
          <div className="flex items-start justify-between gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
            <div>
              <p className="text-[0.68rem] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-700)]">
                Guide
              </p>
              <p className="text-[0.78rem] text-[var(--muted-fg)]">How this screen works, in plain words.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close guide" className="rounded-[8px] p-1 hover:bg-[var(--glass-bg-subtle)]">
              <X className="h-4 w-4" />
            </button>
          </div>

          {unseen && latestUpdate && (
            <button
              type="button"
              onClick={markSeen}
              className="flex w-full items-start gap-2 border-b border-[var(--hairline)] bg-[var(--color-brand-50)] px-3 py-2.5 text-left text-[0.78rem] text-[var(--color-brand-700)]"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="font-semibold">New: {latestUpdate.title}</span>
                <span className="mt-0.5 block text-[0.72rem] opacity-80">
                  Open What’s new for the full note, then come back here if you want the how-to.
                </span>
              </span>
            </button>
          )}

          <div className="px-3 py-2">
            <input
              className="mf-input h-8 w-full text-[0.78rem]"
              placeholder="Ask: paste, Taken, cash, print…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search the guide"
            />
          </div>

          <div className="max-h-[18rem] space-y-2 overflow-auto px-3 pb-3">
            {here.length === 0 && (
              <p className="text-[0.78rem] text-[var(--muted-fg)]">
                Nothing matches. Try “paste”, “Taken”, or “cash”.
              </p>
            )}
            {here.map((tip) => (
              <article key={tip.id} className="rounded-[10px] border border-[var(--hairline)] px-2.5 py-2">
                <h3 className="text-[0.8rem] font-semibold">{tip.title}</h3>
                <p className="mt-0.5 text-[0.75rem] leading-5 text-[var(--muted-fg)]">{tip.body}</p>
              </article>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-[var(--hairline)] px-3 py-2 text-[0.72rem]">
            <Link href="/whats-new" className="font-medium text-[var(--color-brand-700)] hover:underline" onClick={() => { markSeen(); setOpen(false); }}>
              What’s new
            </Link>
            <span className={cn('text-[var(--faint-fg)]')}>Press ? to open</span>
          </div>
        </div>
      )}
    </>
  );
}
