ALTER TABLE "maturity_cases" ADD COLUMN "ops_reviewed_on" date;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN "ops_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD COLUMN "ops_reviewed_by_id" text;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_ops_reviewed_by_id_users_id_fk" FOREIGN KEY ("ops_reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_ops_reviewed_on_idx" ON "maturity_cases" USING btree ("ops_reviewed_on");