CREATE TYPE "public"."payout_cadence" AS ENUM('DAILY', 'ALTERNATE');--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN "cadence" "payout_cadence" DEFAULT 'DAILY' NOT NULL;