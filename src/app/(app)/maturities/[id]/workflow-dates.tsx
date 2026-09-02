'use client';

import { CalendarCheck2, CalendarClock, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { saveRegisterFieldsAction } from '@/actions/register';
import { Button } from '@/components/ui/button';

export function WorkflowDatesEditor({
  caseId,
  maturityOn,
  formOn,
  reviewOn,
  paymentOn,
}: {
  caseId: string;
  maturityOn: string;
  formOn: string;
  reviewOn: string;
  paymentOn: string;
}) {
  const router = useRouter();
  const [maturity, setMaturity] = useState(maturityOn);
  const [form, setForm] = useState(formOn);
  const [review, setReview] = useState(reviewOn);
  const [payment, setPayment] = useState(paymentOn);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const result = await saveRegisterFieldsAction(caseId, {
      instrumentMaturityOn: maturity || null,
      formSubmittedOn: form,
      opsReviewedOn: review || null,
      paymentOn: payment || null,
    });
    setBusy(false);
    if (!result.ok) toast.error(result.error);
    else {
      toast.success('Dates saved');
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DateField
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Maturity date"
          hint="Day 1"
          value={maturity}
          onChange={setMaturity}
        />
        <DateField
          icon={<FileText className="h-3.5 w-3.5" />}
          label="Form submitted"
          hint="Day 2"
          value={form}
          onChange={setForm}
        />
        <DateField
          icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
          label="Operations approval"
          hint="Day 3"
          value={review}
          onChange={setReview}
        />
        <DateField
          icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
          label="Payment begins"
          hint="Day 4 · first withdrawal"
          value={payment}
          onChange={setPayment}
        />
      </div>
      <Button type="button" size="sm" variant="primary" loading={busy} onClick={() => void save()}>
        Save dates
      </Button>
    </div>
  );
}

function DateField({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-[15px] border border-[var(--input-border)] p-4">
      <p className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-fg)]">
        {icon} {label}
      </p>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-10 w-full rounded-[10px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-[1rem] font-semibold outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]"
      />
      <p className="mt-1 text-[0.75rem] text-[var(--muted-fg)]">{hint}</p>
    </label>
  );
}
