CREATE TYPE "public"."app_update_kind" AS ENUM('NEW', 'IMPROVED', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."bug_report_severity" AS ENUM('ANNOYING', 'STOPPED_WORK', 'MONEY');--> statement-breakpoint
CREATE TYPE "public"."bug_report_status" AS ENUM('OPEN', 'LOOKING', 'FIXED', 'CLOSED');--> statement-breakpoint
CREATE TABLE "app_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kind" "app_update_kind" DEFAULT 'NEW' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"screen" text NOT NULL,
	"trying_to" text NOT NULL,
	"what_happened" text NOT NULL,
	"extra" text,
	"severity" "bug_report_severity" NOT NULL,
	"page_path" text,
	"reporter_role" "role" NOT NULL,
	"branch_id" text,
	"user_agent" text,
	"status" "bug_report_status" DEFAULT 'OPEN' NOT NULL,
	"admin_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_updates" ADD CONSTRAINT "app_updates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_updates_published_idx" ON "app_updates" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "bug_reports_status_idx" ON "bug_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bug_reports_reporter_idx" ON "bug_reports" USING btree ("reporter_id","created_at");