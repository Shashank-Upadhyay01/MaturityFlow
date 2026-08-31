CREATE TABLE "maturity_forecasts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"branch_id" text NOT NULL,
	"account_number" text,
	"customer_name" text NOT NULL,
	"agent_name" text,
	"plan_amount_paise" bigint DEFAULT 0 NOT NULL,
	"total_deposit_paise" bigint DEFAULT 0 NOT NULL,
	"joined_on" date,
	"maturity_on" date NOT NULL,
	"product_name" text,
	"plan_name" text,
	"actual_maturity_paise" bigint DEFAULT 0 NOT NULL,
	"current_maturity_paise" bigint NOT NULL,
	"tenure_months" integer,
	"interest_rate_bps" integer,
	"source_workbook" text NOT NULL,
	"source_sheet" text NOT NULL,
	"source_row" integer NOT NULL,
	"imported_by_id" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maturity_forecasts_money_non_negative" CHECK ("maturity_forecasts"."plan_amount_paise" >= 0 AND "maturity_forecasts"."total_deposit_paise" >= 0 AND "maturity_forecasts"."actual_maturity_paise" >= 0 AND "maturity_forecasts"."current_maturity_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "maturity_forecasts" ADD CONSTRAINT "maturity_forecasts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_forecasts" ADD CONSTRAINT "maturity_forecasts_imported_by_id_users_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maturity_forecasts_source_uq" ON "maturity_forecasts" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "maturity_forecasts_branch_date_idx" ON "maturity_forecasts" USING btree ("branch_id","maturity_on");--> statement-breakpoint
CREATE INDEX "maturity_forecasts_date_idx" ON "maturity_forecasts" USING btree ("maturity_on");--> statement-breakpoint
CREATE INDEX "maturity_forecasts_customer_idx" ON "maturity_forecasts" USING btree ("customer_name");