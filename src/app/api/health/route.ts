import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

/** Liveness + readiness in one. Used by the Docker HEALTHCHECK and any uptime monitor. */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        database: 'unreachable',
        error: e instanceof Error ? e.message : 'unknown',
      },
      { status: 503 },
    );
  }
}
