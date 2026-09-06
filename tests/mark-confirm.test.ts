import { describe, expect, it } from 'vitest';

import { markConfirmCopy, tickPlanFor } from '@/lib/mark-confirm';
import type { PayoutDayView } from '@/lib/register-view';

const day = (over: Partial<PayoutDayView> = {}): PayoutDayView => ({
  id: 'inst_1',
  dueOn: '2026-09-08',
  amountPaise: '1300000',
  cashPaise: '1300000',
  onlinePaise: '0',
  paidPaise: '0',
  status: 'PENDING',
  ...over,
});

const subject = {
  customerName: 'SHUBHAM SHARMA',
  dueOn: '2026-09-08',
  amountPaise: 1_300_000n,
};

describe('markConfirmCopy', () => {
  it('names the customer, the amount and the day when recording a payout', () => {
    const copy = markConfirmCopy('taken', subject);
    expect(copy.question).toBe('Record ₹13,000 as taken for SHUBHAM SHARMA for 08/09/2026?');
    expect(copy.tone).toBe('success');
  });

  it('says the money stays owed when marking a day not taken', () => {
    const copy = markConfirmCopy('notTaken', subject);
    expect(copy.question).toBe('Mark 08/09/2026 as not taken for SHUBHAM SHARMA?');
    expect(copy.detail).toContain('₹13,000 stays owed');
    expect(copy.detail).toContain('nothing is written off');
    expect(copy.tone).toBe('danger');
  });

  it('describes clearing an existing mark as returning the day to unanswered', () => {
    const copy = markConfirmCopy('clearNotTaken', subject);
    expect(copy.question).toBe('Clear the not-taken mark on 08/09/2026 for SHUBHAM SHARMA?');
    expect(copy.detail).toContain('unanswered');
    expect(copy.confirmLabel).toBe('Clear the mark');
  });

  it('gives the three actions three different questions and three different buttons', () => {
    const questions = (['taken', 'notTaken', 'clearNotTaken'] as const).map(
      (action) => markConfirmCopy(action, subject).question,
    );
    const labels = (['taken', 'notTaken', 'clearNotTaken'] as const).map(
      (action) => markConfirmCopy(action, subject).confirmLabel,
    );
    expect(new Set(questions).size).toBe(3);
    expect(new Set(labels).size).toBe(3);
  });

  it('still reads as a sentence on a row nobody has named yet', () => {
    const copy = markConfirmCopy('taken', { ...subject, customerName: '   ' });
    expect(copy.question).toBe('Record ₹13,000 as taken for this row for 08/09/2026?');
  });
});

describe('tickPlanFor', () => {
  it('records the whole leftover when nothing was typed', () => {
    const plan = tickPlanFor(day({ paidPaise: '300000' }), null);
    expect(plan.totalPaise).toBe(1_000_000n);
    expect(plan.needsReference).toBe(false);
  });

  it('asks for a reference when the engine planned any of the day online', () => {
    const plan = tickPlanFor(day({ cashPaise: '800000', onlinePaise: '500000' }), null);
    expect(plan.needsReference).toBe(true);
    expect(plan.onlinePaise).toBe(0n);
  });

  it('records a typed figure as cash while it fits inside the cash leg', () => {
    const plan = tickPlanFor(day({ cashPaise: '800000', onlinePaise: '500000' }), 8_000n);
    expect(plan.totalPaise).toBe(800_000n);
    expect(plan.onlinePaise).toBe(0n);
    expect(plan.needsReference).toBe(false);
  });

  it('spills a typed figure past the cash leg into the online leg', () => {
    const plan = tickPlanFor(day({ cashPaise: '800000', onlinePaise: '500000' }), 11_000n);
    expect(plan.totalPaise).toBe(1_100_000n);
    expect(plan.onlinePaise).toBe(300_000n);
    expect(plan.needsReference).toBe(true);
  });

  it('never calls a surplus over both legs online, so arrears in cash need no UTR', () => {
    const plan = tickPlanFor(day({ cashPaise: '800000', onlinePaise: '0' }), 30_000n);
    expect(plan.totalPaise).toBe(3_000_000n);
    expect(plan.onlinePaise).toBe(0n);
    expect(plan.needsReference).toBe(false);
  });

  it('records nothing on a day already paid in full', () => {
    const plan = tickPlanFor(day({ status: 'PAID', paidPaise: '1300000' }), null);
    expect(plan.totalPaise).toBe(0n);
  });
});
