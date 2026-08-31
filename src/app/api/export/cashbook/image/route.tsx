import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';

import { requireActor } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { formatISODate, parseISODate, todayISO } from '@/lib/working-days';
import { getCashbookDay } from '@/services/queries';

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

function stateStyle(state: string): { label: string; color: string; background: string } {
  if (state === 'BALANCED') return { label: 'CASH MATCHES', color: '#14532d', background: '#dcfce7' };
  if (state === 'SHORT') return { label: 'CASH SHORT', color: '#7f1d1d', background: '#fee2e2' };
  if (state === 'EXCESS') return { label: 'CASH EXTRA', color: '#78350f', background: '#fef3c7' };
  return { label: 'NOT COUNTED', color: '#475569', background: '#f1f5f9' };
}

function imageMoney(value: bigint): string {
  // Satori tries to fetch a fallback font dynamically for the rupee glyph. That is unreliable on
  // an offline office LAN, so the share image deliberately uses ASCII "Rs".
  return `Rs ${formatPaise(value, { decimals: false, symbol: false })}`;
}

export async function GET(request: Request) {
  let view: Awaited<ReturnType<typeof getCashbookDay>>;
  try {
    const { actor } = await requireActor();
    const url = new URL(request.url);
    const branchId = url.searchParams.get('branchId')?.trim();
    if (!branchId) return NextResponse.json({ error: 'Choose a branch.' }, { status: 400 });
    const date = url.searchParams.get('date') ?? todayISO();
    parseISODate(date);
    assertCan(actor, 'cashbook.view', { branchId });
    view = await getCashbookDay(actor, branchId, date);
    if (!view) return NextResponse.json({ error: 'Cashbook not found.' }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not build cashbook image.';
    return NextResponse.json({ error: message }, { status: 403, headers: NO_STORE });
  }
  if (!view) return NextResponse.json({ error: 'Cashbook not found.' }, { status: 404 });

  const verdict = stateStyle(view.totals.state);
  const branchLine = `${view.branch.code} · ${formatISODate(view.date)}`;
  const deductionLine = `By account ${imageMoney(view.totals.byAccountPaise)} · Withdrawals ${imageMoney(view.totals.byCategory.WITHDRAWAL)} · Expenses ${imageMoney(view.totals.byCategory.EXPENSE)}`;
  const closeLine = view.day?.status === 'CLOSED'
    ? `Approved close · revision ${view.day.closeRevision}`
    : 'Live figures · not a final close certificate';
  const card = (label: string, value: bigint, color = '#0f172a') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
      <div style={{ color: '#64748b', fontSize: 22, fontWeight: 700, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ color, fontSize: 38, fontWeight: 800 }}>{imageMoney(value)}</div>
    </div>
  );

  return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '58px 64px',
          color: '#0f172a',
          background: 'linear-gradient(135deg, #eef2ff 0%, #ffffff 45%, #ecfdf5 100%)',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#4f46e5', fontSize: 22, fontWeight: 800, letterSpacing: '0.12em' }}>MATURITYFLOW · DAILY CASHBOOK</div>
            <div style={{ marginTop: 12, fontSize: 42, fontWeight: 850 }}>{view.branch.name}</div>
            <div style={{ marginTop: 7, color: '#64748b', fontSize: 25 }}>{branchLine}</div>
          </div>
          <div style={{ display: 'flex', borderRadius: 999, padding: '14px 24px', color: verdict.color, background: verdict.background, fontSize: 21, fontWeight: 850, letterSpacing: '0.05em' }}>{verdict.label}</div>
        </div>

        <div style={{ display: 'flex', marginTop: 50, border: '2px solid #e2e8f0', borderRadius: 24, background: 'rgba(255,255,255,0.86)', padding: '30px 34px' }}>
          {card('TOTAL AMOUNT', view.totals.totalAmountPaise)}
          {card('EXPECTED PHYSICAL', view.totals.expectedPhysicalCashPaise)}
          {card('CASH IN HAND', view.totals.countedCashPaise)}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, borderRadius: 24, padding: '24px 34px', color: verdict.color, background: verdict.background }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>CASH DIFFERENCE</div>
            <div style={{ fontSize: 18, opacity: 0.8 }}>Counted cash minus expected physical cash</div>
          </div>
          <div style={{ fontSize: 48, fontWeight: 900 }}>{imageMoney(view.totals.cashDifferencePaise)}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'auto', color: '#64748b', fontSize: 18 }}>
          <div>{deductionLine}</div>
          <div>{closeLine}</div>
        </div>
      </div>,
      { width: 1200, height: 675, headers: NO_STORE },
  );
}
