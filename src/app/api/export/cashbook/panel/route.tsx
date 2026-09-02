import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';

import { requireActor } from '@/lib/auth/session';
import { formatPaise } from '@/lib/money';
import { assertCan } from '@/lib/rbac';
import { formatISODate, parseISODate } from '@/lib/working-days';
import { getCashbookDay } from '@/services/queries';

export const dynamic = 'force-dynamic';

const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

/**
 * Satori has no network on an office LAN, so it cannot fetch a fallback font for the rupee
 * glyph. The whole-cashbook image already settled on ASCII "Rs"; a single panel has to match
 * it, or two images shared into the same WhatsApp thread would disagree with each other.
 */
function imageMoney(paise: bigint): string {
  return `Rs ${formatPaise(paise, { decimals: false, symbol: false })}`;
}

interface PanelRow {
  label: string;
  /** Paise as a decimal string - bigint does not survive JSON. */
  valuePaise?: string;
  /** Used where the figure is a count rather than money. */
  text?: string;
  strong?: boolean;
  tone?: 'add' | 'subtract' | 'report';
}

const TONE_COLOR: Record<string, string> = {
  add: '#047857',
  subtract: '#b91c1c',
  report: '#1d4ed8',
};

function parseRows(input: unknown): PanelRow[] {
  if (!Array.isArray(input)) throw new Error('Nothing to draw.');
  if (input.length === 0 || input.length > 40) throw new Error('Nothing to draw.');
  return input.map((raw) => {
    const row = raw as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.slice(0, 60) : '';
    if (!label) throw new Error('Nothing to draw.');
    const valuePaise = typeof row.valuePaise === 'string' && /^-?\d{1,18}$/.test(row.valuePaise)
      ? row.valuePaise
      : undefined;
    const text = typeof row.text === 'string' ? row.text.slice(0, 40) : undefined;
    const tone = row.tone === 'add' || row.tone === 'subtract' || row.tone === 'report' ? row.tone : undefined;
    return { label, valuePaise, text, strong: row.strong === true, tone };
  });
}

/**
 * One panel of the daily cashbook as a shareable PNG.
 *
 * The figures come from the browser rather than being recomputed here, and deliberately so:
 * the cashier shares what is on the screen, including denomination counts they have typed but
 * not yet saved. Recomputing server-side would quietly hand them yesterday's saved numbers.
 * The branch and date are still checked against the caller's permissions, so this cannot be
 * used to render a branch they may not see.
 */
export async function POST(request: Request) {
  let branchCode: string;
  let branchName: string;
  let date: string;
  let title: string;
  let rows: PanelRow[];

  try {
    const { actor } = await requireActor();
    const body = (await request.json()) as Record<string, unknown>;
    const branchId = typeof body.branchId === 'string' ? body.branchId.trim() : '';
    if (!branchId) return NextResponse.json({ error: 'Choose a branch.' }, { status: 400 });
    date = typeof body.date === 'string' ? body.date : '';
    parseISODate(date);
    assertCan(actor, 'cashbook.view', { branchId });
    const view = await getCashbookDay(actor, branchId, date);
    if (!view) return NextResponse.json({ error: 'Cashbook not found.' }, { status: 404 });
    branchCode = view.branch.code;
    branchName = view.branch.name;
    title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 40) : 'Cashbook';
    rows = parseRows(body.rows);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not build the panel image.';
    return NextResponse.json({ error: message }, { status: 403, headers: NO_STORE });
  }

  // Grow the canvas with the content instead of scaling text down, so a fifteen-row cash
  // calculation stays as readable on a phone as a seven-row cash control.
  const height = 250 + rows.length * 52;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '52px 58px',
          color: '#0f172a',
          background: 'linear-gradient(135deg, #eef2ff 0%, #ffffff 45%, #ecfdf5 100%)',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ color: '#4f46e5', fontSize: 20, fontWeight: 800, letterSpacing: '0.12em' }}>
            {title.toUpperCase()}
          </div>
          <div style={{ marginTop: 10, fontSize: 38, fontWeight: 850 }}>{branchName}</div>
          <div style={{ marginTop: 6, color: '#64748b', fontSize: 23 }}>
            {branchCode} · {formatISODate(date)}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 34,
            border: '2px solid #e2e8f0',
            borderRadius: 22,
            background: 'rgba(255,255,255,0.9)',
            overflow: 'hidden',
          }}
        >
          {rows.map((row, index) => (
            <div
              key={`${row.label}-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: row.strong ? '16px 28px' : '11px 28px',
                borderBottom: index === rows.length - 1 ? 'none' : '1px solid #eef2f7',
                background: row.strong ? '#f1f5f9' : 'transparent',
              }}
            >
              <div
                style={{
                  fontSize: row.strong ? 26 : 23,
                  fontWeight: row.strong ? 850 : 600,
                  color: row.tone ? TONE_COLOR[row.tone] : '#0f172a',
                }}
              >
                {row.label}
              </div>
              <div style={{ fontSize: row.strong ? 30 : 25, fontWeight: row.strong ? 900 : 750 }}>
                {row.text ?? (row.valuePaise ? imageMoney(BigInt(row.valuePaise)) : '')}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 26, color: '#64748b', fontSize: 17 }}>
          Live figures · not a final close certificate
        </div>
      </div>
    ),
    { width: 900, height, headers: NO_STORE },
  );
}
