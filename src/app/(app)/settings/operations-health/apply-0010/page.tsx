import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function Apply0010Page() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'ADMIN') redirect('/dashboard');

  await db.execute(sql.raw(`
    ALTER TABLE maturity_cases ADD COLUMN IF NOT EXISTS settlement_adjustment_paise bigint DEFAULT 0 NOT NULL;
    ALTER TABLE maturity_cases ADD COLUMN IF NOT EXISTS settlement_adjusted_at timestamp with time zone;
    ALTER TABLE maturity_cases ADD COLUMN IF NOT EXISTS settlement_adjusted_by_id text;
    DO $$ BEGIN
      ALTER TABLE maturity_cases ADD CONSTRAINT maturity_cases_settlement_adjusted_by_id_users_id_fk
        FOREIGN KEY (settlement_adjusted_by_id) REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE maturity_cases ADD CONSTRAINT cases_settlement_adjustment_range
        CHECK (settlement_adjustment_paise >= 0 AND settlement_adjustment_paise <= 10000);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      ALTER TABLE maturity_cases ADD CONSTRAINT cases_settlement_reconciles
        CHECK (paid_cash_paise + paid_online_paise + settlement_adjustment_paise <= maturity_amount_paise);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `));

  return <main className="p-8"><h1 className="text-xl font-semibold">Migration 0010 applied</h1></main>;
}
