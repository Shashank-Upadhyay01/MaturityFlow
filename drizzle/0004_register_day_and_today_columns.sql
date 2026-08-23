-- Brings the migration chain back in step with src/db/schema.ts.
--
-- Migrations 0001–0003 were written by hand, so drizzle-kit's snapshot never learned about
-- them. Everything below is therefore written to be idempotent: on a database that already
-- has these objects (one built with `db:push`) it is a no-op, and on a fresh database created
-- by `db:migrate` it fills in the register-day workflow and today's-amount columns that the
-- Register page cannot run without.

CREATE TABLE IF NOT EXISTS "register_days" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"requested_by_id" text,
	"requested_at" timestamp with time zone,
	"approved_by_id" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch_cash_positions" ADD COLUMN IF NOT EXISTS "planned_online_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "register_column_order" jsonb;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "payment_on" date;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "today_approved_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "today_cash_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN IF NOT EXISTS "today_online_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notes" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint

-- username is NOT NULL, so it has to arrive nullable, get backfilled from the email local part,
-- and only then be tightened. Adding it NOT NULL in one step fails on any table with rows.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;--> statement-breakpoint
UPDATE "users" SET "username" = split_part("email", '@', 1) WHERE "username" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "register_days" DROP CONSTRAINT IF EXISTS "register_days_branch_id_branches_id_fk";--> statement-breakpoint
ALTER TABLE "register_days" ADD CONSTRAINT "register_days_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_days" DROP CONSTRAINT IF EXISTS "register_days_requested_by_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "register_days" ADD CONSTRAINT "register_days_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_days" DROP CONSTRAINT IF EXISTS "register_days_approved_by_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "register_days" ADD CONSTRAINT "register_days_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "register_days_branch_date_uq" ON "register_days" USING btree ("branch_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_active_idx" ON "users" USING btree ("is_active");--> statement-breakpoint

-- The CHECK constraints are the last line of defence on money columns, so they are dropped and
-- re-added rather than skipped — that way this migration also repairs a database where one of
-- them was created by hand with a different definition.
ALTER TABLE "branch_cash_positions" DROP CONSTRAINT IF EXISTS "cash_pos_online_non_negative";--> statement-breakpoint
ALTER TABLE "branch_cash_positions" ADD CONSTRAINT "cash_pos_online_non_negative" CHECK ("branch_cash_positions"."planned_online_paise" >= 0);--> statement-breakpoint
ALTER TABLE "maturity_cases" DROP CONSTRAINT IF EXISTS "cases_today_approved_non_negative";--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "cases_today_approved_non_negative" CHECK ("maturity_cases"."today_approved_paise" >= 0);--> statement-breakpoint
ALTER TABLE "maturity_cases" DROP CONSTRAINT IF EXISTS "cases_today_split_non_negative";--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "cases_today_split_non_negative" CHECK ("maturity_cases"."today_cash_paise" >= 0 AND "maturity_cases"."today_online_paise" >= 0);
