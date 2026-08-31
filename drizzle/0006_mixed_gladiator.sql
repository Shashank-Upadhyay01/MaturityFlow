CREATE TYPE "public"."cashbook_commitment_kind" AS ENUM('GIVEN_CASH', 'DUE_AMOUNT', 'PENDING_WITHDRAWAL');--> statement-breakpoint
CREATE TYPE "public"."cashbook_day_status" AS ENUM('OPEN', 'CLOSE_REQUESTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."cashbook_entry_category" AS ENUM('OTHER_RECEIPT', 'NEW_LOAN', 'SAVINGS_DEPOSIT', 'WITHDRAWAL', 'EXPENSE', 'RENEWAL', 'OPENING_BALANCE');--> statement-breakpoint
CREATE TYPE "public"."cashbook_entry_channel" AS ENUM('CASH', 'ACCOUNT');--> statement-breakpoint
CREATE TABLE "cashbook_commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"cashbook_day_id" text NOT NULL,
	"kind" "cashbook_commitment_kind" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"party_name" text NOT NULL,
	"reference" text,
	"note" text,
	"due_on" date,
	"settled_at" timestamp with time zone,
	"settled_by_id" text,
	"settlement_note" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" text,
	"void_reason" text,
	"created_by_id" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbook_commitment_amount_positive" CHECK ("cashbook_commitments"."amount_paise" > 0),
	CONSTRAINT "cashbook_commitment_needs_name" CHECK (NULLIF(BTRIM("cashbook_commitments"."party_name"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "cashbook_days" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"date" date NOT NULL,
	"status" "cashbook_day_status" DEFAULT 'OPEN' NOT NULL,
	"old_portal_total_paise" bigint DEFAULT 0 NOT NULL,
	"fixed_deposit_paise" bigint DEFAULT 0 NOT NULL,
	"new_business_paise" bigint DEFAULT 0 NOT NULL,
	"membership_collection_paise" bigint DEFAULT 0 NOT NULL,
	"old_loan_paise" bigint DEFAULT 0 NOT NULL,
	"note_500_count" integer DEFAULT 0 NOT NULL,
	"note_200_count" integer DEFAULT 0 NOT NULL,
	"note_100_count" integer DEFAULT 0 NOT NULL,
	"note_50_count" integer DEFAULT 0 NOT NULL,
	"note_20_count" integer DEFAULT 0 NOT NULL,
	"note_10_count" integer DEFAULT 0 NOT NULL,
	"coins_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"version" integer DEFAULT 0 NOT NULL,
	"close_revision" integer DEFAULT 0 NOT NULL,
	"close_requested_by_id" text,
	"close_requested_at" timestamp with time zone,
	"close_reason" text,
	"closed_by_id" text,
	"closed_at" timestamp with time zone,
	"close_snapshot" jsonb,
	"created_by_id" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbook_day_money_non_negative" CHECK ("cashbook_days"."old_portal_total_paise" >= 0 AND "cashbook_days"."fixed_deposit_paise" >= 0 AND "cashbook_days"."new_business_paise" >= 0 AND "cashbook_days"."membership_collection_paise" >= 0 AND "cashbook_days"."old_loan_paise" >= 0 AND "cashbook_days"."coins_paise" >= 0),
	CONSTRAINT "cashbook_day_counts_non_negative" CHECK ("cashbook_days"."note_500_count" >= 0 AND "cashbook_days"."note_200_count" >= 0 AND "cashbook_days"."note_100_count" >= 0 AND "cashbook_days"."note_50_count" >= 0 AND "cashbook_days"."note_20_count" >= 0 AND "cashbook_days"."note_10_count" >= 0),
	CONSTRAINT "cashbook_day_versions_non_negative" CHECK ("cashbook_days"."version" >= 0 AND "cashbook_days"."close_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cashbook_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"cashbook_day_id" text NOT NULL,
	"category" "cashbook_entry_category" NOT NULL,
	"channel" "cashbook_entry_channel" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"party_name" text,
	"reference" text,
	"note" text,
	"voided_at" timestamp with time zone,
	"voided_by_id" text,
	"void_reason" text,
	"created_by_id" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cashbook_entry_amount_positive" CHECK ("cashbook_entries"."amount_paise" > 0),
	CONSTRAINT "cashbook_entry_cash_only_outflows" CHECK ("cashbook_entries"."category" NOT IN ('WITHDRAWAL', 'EXPENSE', 'OPENING_BALANCE') OR "cashbook_entries"."channel" = 'CASH')
);
--> statement-breakpoint
ALTER TABLE "cashbook_commitments" ADD CONSTRAINT "cashbook_commitments_cashbook_day_id_cashbook_days_id_fk" FOREIGN KEY ("cashbook_day_id") REFERENCES "public"."cashbook_days"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_commitments" ADD CONSTRAINT "cashbook_commitments_settled_by_id_users_id_fk" FOREIGN KEY ("settled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_commitments" ADD CONSTRAINT "cashbook_commitments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_commitments" ADD CONSTRAINT "cashbook_commitments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_commitments" ADD CONSTRAINT "cashbook_commitments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_days" ADD CONSTRAINT "cashbook_days_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_days" ADD CONSTRAINT "cashbook_days_close_requested_by_id_users_id_fk" FOREIGN KEY ("close_requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_days" ADD CONSTRAINT "cashbook_days_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_days" ADD CONSTRAINT "cashbook_days_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_days" ADD CONSTRAINT "cashbook_days_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_cashbook_day_id_cashbook_days_id_fk" FOREIGN KEY ("cashbook_day_id") REFERENCES "public"."cashbook_days"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashbook_entries" ADD CONSTRAINT "cashbook_entries_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cashbook_commitments_day_kind_idx" ON "cashbook_commitments" USING btree ("cashbook_day_id","kind");--> statement-breakpoint
CREATE INDEX "cashbook_commitments_open_idx" ON "cashbook_commitments" USING btree ("kind","settled_at","voided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cashbook_days_branch_date_uq" ON "cashbook_days" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "cashbook_days_date_status_idx" ON "cashbook_days" USING btree ("date","status");--> statement-breakpoint
CREATE INDEX "cashbook_days_branch_status_idx" ON "cashbook_days" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "cashbook_entries_day_category_idx" ON "cashbook_entries" USING btree ("cashbook_day_id","category");--> statement-breakpoint
CREATE INDEX "cashbook_entries_day_channel_idx" ON "cashbook_entries" USING btree ("cashbook_day_id","channel");