'use client';

import { Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { CASE_STATUS_LABEL } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Glass } from '@/components/ui/glass';
import type { CaseStatus } from '@/db/schema';

export function RegisterFilters({
  q,
  status,
  overdue,
  statuses,
}: {
  q: string;
  status: string;
  overdue: boolean;
  statuses: CaseStatus[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(q);
  const [pending, start] = useTransition();

  function apply(next: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') p.delete(k);
      else p.set(k, v);
    }
    p.delete('page');
    start(() => router.push(`/maturities?${p.toString()}`));
  }

  const hasFilters = Boolean(q || status || overdue);

  return (
    <Glass className="mf-rise flex flex-wrap items-center gap-3 p-3">
      <form
        className="relative min-w-[14rem] flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: term });
        }}
      >
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint-fg)]" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Case number, customer, phone, agent, policy…"
          className="pl-10"
        />
      </form>

      <Select
        value={status}
        onChange={(e) => apply({ status: e.target.value })}
        className="w-auto min-w-[11rem]"
      >
        <option value="">All statuses</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {CASE_STATUS_LABEL[s]}
          </option>
        ))}
      </Select>

      <Button
        variant={overdue ? 'danger' : 'glass'}
        size="md"
        onClick={() => apply({ overdue: overdue ? null : '1' })}
        loading={pending}
      >
        Overdue only
      </Button>

      {hasFilters && (
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            setTerm('');
            start(() => router.push('/maturities'));
          }}
        >
          <X className="h-4 w-4" />
          Clear
        </Button>
      )}
    </Glass>
  );
}
