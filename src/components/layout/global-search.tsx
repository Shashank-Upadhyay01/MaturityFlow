'use client';

import { LoaderCircle, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { NAV, TOP_LEVEL_NAV } from './nav-config';

interface CaseResult {
  id: string;
  caseNumber: string;
  customerName: string;
  accountNumber: string | null;
  agentName: string;
  branchName: string;
  branchCode: string;
  status: string;
}

export function GlobalSearch({ permissions }: { permissions: string[] }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CaseResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const pages = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return [...TOP_LEVEL_NAV, ...NAV.flatMap((section) => section.items)]
      .filter((item) => permissions.includes(item.permission))
      .filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(needle))
      .slice(0, 4);
  }, [permissions, q]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, { signal: controller.signal });
        const body = await response.json() as { results?: CaseResult[] };
        if (response.ok) setResults(body.results ?? []);
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === 'AbortError')) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const choices = [
    ...pages.map((page) => ({ key: `page:${page.href}`, href: page.href })),
    ...results.map((result) => ({ key: `case:${result.id}`, href: `/maturities/${result.id}` })),
  ];
  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };

  return (
    <div ref={root} className="relative hidden md:block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-[var(--faint-fg)]" />
      <input
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const value = event.target.value;
          setQ(value);
          setOpen(true);
          setActive(0);
          if (value.trim().length < 2) {
            setResults([]);
            setLoading(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((v) => Math.min(v + 1, Math.max(choices.length - 1, 0))); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((v) => Math.max(v - 1, 0)); }
          if (event.key === 'Enter' && choices[active]) { event.preventDefault(); go(choices[active].href); }
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder="Search customers, accounts, pages"
        aria-label="Global search"
        aria-expanded={open}
        className="mf-input !h-8 w-44 !rounded-[10px] !pl-8 !pr-8 !text-[0.72rem] xl:w-64"
      />
      {loading ? (
        <LoaderCircle className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[var(--faint-fg)]" />
      ) : q ? (
        <button type="button" onClick={() => { setQ(''); setResults([]); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--faint-fg)] hover:text-[var(--page-fg)]">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {open && q.trim() && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-[12px] border border-[var(--glass-border)] bg-[var(--surface-solid)] shadow-xl">
          {pages.length > 0 && (
            <div className="border-b border-[var(--hairline)] p-1.5">
              <p className="px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[var(--faint-fg)]">Pages</p>
              {pages.map((page, index) => (
                <button key={page.href} type="button" onMouseEnter={() => setActive(index)} onClick={() => go(page.href)} className={`block w-full rounded-[8px] px-2 py-1.5 text-left ${active === index ? 'bg-[var(--glass-bg-strong)]' : 'hover:bg-[var(--glass-bg-subtle)]'}`}>
                  <span className="block text-[0.78rem] font-semibold">{page.label}</span>
                  <span className="block text-[0.65rem] text-[var(--faint-fg)]">{page.description}</span>
                </button>
              ))}
            </div>
          )}
          <div className="max-h-72 overflow-y-auto p-1.5">
            <p className="px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-[var(--faint-fg)]">Register</p>
            {results.map((result, index) => {
              const choiceIndex = pages.length + index;
              return (
                <button key={result.id} type="button" onMouseEnter={() => setActive(choiceIndex)} onClick={() => go(`/maturities/${result.id}`)} className={`block w-full rounded-[8px] px-2 py-2 text-left ${active === choiceIndex ? 'bg-[var(--glass-bg-strong)]' : 'hover:bg-[var(--glass-bg-subtle)]'}`}>
                  <span className="flex items-baseline justify-between gap-3"><strong className="truncate text-[0.78rem]">{result.customerName}</strong><span className="shrink-0 text-[0.62rem] text-[var(--faint-fg)]">{result.branchCode}</span></span>
                  <span className="block truncate text-[0.65rem] text-[var(--muted-fg)]">A/c {result.accountNumber ?? '—'} · {result.agentName}</span>
                </button>
              );
            })}
            {!loading && q.trim().length >= 2 && results.length === 0 && pages.length === 0 && <p className="px-2 py-4 text-center text-[0.72rem] text-[var(--faint-fg)]">No matching page or register entry.</p>}
            {q.trim().length < 2 && <p className="px-2 py-4 text-center text-[0.72rem] text-[var(--faint-fg)]">Type at least two characters.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
