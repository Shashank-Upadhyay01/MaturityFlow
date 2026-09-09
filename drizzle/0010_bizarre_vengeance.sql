ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "settlement_adjustment_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "settlement_adjusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "settlement_adjusted_by_id" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_settlement_adjusted_by_id_users_id_fk" FOREIGN KEY ("settlement_adjusted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "maturity_cases" ADD CONSTRAINT "cases_settlement_adjustment_range" CHECK ("settlement_adjustment_paise" >= 0 AND "settlement_adjustment_paise" <= 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "maturity_cases" ADD CONSTRAINT "cases_settlement_reconciles" CHECK ("paid_cash_paise" + "paid_online_paise" + "settlement_adjustment_paise" <= "maturity_amount_paise");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
