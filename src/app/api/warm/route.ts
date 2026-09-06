import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

/*
  Keeps the office's first click of the morning off a cold start.

  Everything here runs on demand: there is no server sitting idle waiting, so when nobody has
  opened the site for a while the next person to do so pays for the whole thing waking up. Warm,
  a page answers in about two hundred milliseconds. Cold, the same page took nearly eleven
  seconds - and a branch that opens the register a few times an hour is cold nearly every time,
  which is exactly what "it takes too long to open" means.

  A schedule hits this every few minutes during working hours, which keeps an instance alive and
  its database connection already authenticated. It deliberately does the same two things a real
  page does - reach the database and come back - because an instance warmed without touching
  Postgres would still pay for the handshake on the first real request.

  Cheap on purpose: one trivial query, no session, no tables read. It is a heartbeat, not a
  health report - /api/health is the one that answers questions.
*/
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json(
      { warm: true, dbMs: Date.now() - started },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // A failed warm-up is not an incident: the next real request will try again and the
    // monitoring that matters lives on /api/health. Never page anyone over a heartbeat.
    return NextResponse.json(
      { warm: false, dbMs: Date.now() - started },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
