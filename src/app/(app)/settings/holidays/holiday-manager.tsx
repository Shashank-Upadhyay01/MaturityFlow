'use client';

import { CalendarPlus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { addHolidayAction, deleteHolidayAction } from '@/actions/admin';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { formatISODate, weekdayShort } from '@/lib/working-days';

export function HolidayManager({
  holidays,
  today,
}: {
  holidays: { id: string; date: string; name: string; branchId: string | null }[];
  today: string;
}) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!date || !name.trim()) return toast.error('Enter both a date and a name');
    setBusy(true);
    const r = await addHolidayAction(date, name, null);
    setBusy(false);
    if (r.ok) {
      toast.success('Holiday added');
      setDate('');
      setName('');
      router.refresh();
    } else toast.error(r.error);
  }

  async function remove(id: string) {
    setBusy(true);
    const r = await deleteHolidayAction(id);
    setBusy(false);
    if (r.ok) {
      toast.success('Holiday removed');
      router.refresh();
    } else toast.error(r.error);
  }

  return (
    <div>
      <div className="grid gap-3 border-b px-5 py-4 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end sm:px-6">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Diwali / Holi / Eid-ul-Fitr…"
          />
        </Field>
        <Button variant="primary" loading={busy} onClick={add}>
          <CalendarPlus className="h-4 w-4" />
          Add holiday
        </Button>
      </div>

      {holidays.length === 0 ? (
        <p className="px-6 py-10 text-center text-[0.875rem] text-[var(--muted-fg)]">
          No holidays recorded.
        </p>
      ) : (
        <Table>
          <THead>
            <TH>Date</TH>
            <TH>Day</TH>
            <TH>Name</TH>
            <TH>Scope</TH>
            <TH />
          </THead>
          <TBody>
            {holidays.map((h) => (
              <TR key={h.id} className={h.date < today ? 'opacity-55' : ''}>
                <TD className="font-medium">{formatISODate(h.date)}</TD>
                <TD className="text-[var(--muted-fg)]">{weekdayShort(h.date)}</TD>
                <TD>{h.name}</TD>
                <TD>
                  <Badge tone={h.branchId ? 'brand' : 'neutral'}>
                    {h.branchId ? 'one branch' : 'all branches'}
                  </Badge>
                </TD>
                <TD align="right">
                  <Button size="sm" variant="ghost" onClick={() => remove(h.id)} disabled={busy}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
