CREATE TYPE "public"."case_event_type" AS ENUM('CREATED', 'SUBMITTED', 'PICKED_UP', 'RETURNED', 'APPROVED', 'REJECTED', 'SCHEDULE_GENERATED', 'SCHEDULE_OVERRIDDEN', 'RESCHEDULED', 'PAYMENT_RECORDED', 'PAYMENT_REVERSED', 'PUT_ON_HOLD', 'RESUMED', 'COMPLETED', 'CANCELLED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED', 'NOTE_ADDED', 'EDITED');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."cash_policy_kind" AS ENUM('CASH_ONLY', 'ONLINE_ONLY', 'CASH_CAP');--> statement-breakpoint
CREATE TYPE "public"."distribution_mode" AS ENUM('FRONT_LOADED', 'BACK_LOADED', 'EVEN');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('MATURITY_FORM', 'ID_PROOF', 'ADDRESS_PROOF', 'PASSBOOK', 'CANCELLED_CHEQUE', 'PHOTO', 'DISCHARGE_RECEIPT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."instalment_status" AS ENUM('PENDING', 'PARTIAL', 'PAID', 'MISSED', 'SUPERSEDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."notification_level" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('CMD', 'CEO', 'ADMIN', 'OPS_HEAD', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."saturday_rule" AS ENUM('NONE', 'ALL', 'SECOND_FOURTH');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"branch_id" text NOT NULL,
	"user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"actor_role" "role" NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"branch_id" text,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "branch_cash_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"date" date NOT NULL,
	"opening_cash_paise" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"noted_by_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_pos_non_negative" CHECK ("branch_cash_positions"."opening_cash_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"state" text,
	"address" text,
	"phone" text,
	"ifsc" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"default_rounding_paise" bigint DEFAULT 100000 NOT NULL,
	"default_window_days" integer DEFAULT 15 NOT NULL,
	"daily_cash_comfort_paise" bigint DEFAULT 50000000 NOT NULL,
	"sundays_off" boolean DEFAULT true NOT NULL,
	"saturday_rule" "saturday_rule" DEFAULT 'SECOND_FOURTH' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_rounding_positive" CHECK ("branches"."default_rounding_paise" > 0),
	CONSTRAINT "branches_window_positive" CHECK ("branches"."default_window_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "case_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"kind" "document_kind" DEFAULT 'OTHER' NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by_id" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by_id" text,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"type" "case_event_type" NOT NULL,
	"from_status" "case_status",
	"to_status" "case_status",
	"note" text,
	"actor_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"customer_code" text,
	"phone" text,
	"email" text,
	"address" text,
	"account_number" text,
	"payout_bank" text,
	"payout_account" text,
	"payout_ifsc" text,
	"branch_id" text NOT NULL,
	"agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"branch_id" text,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maturity_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"case_number" text NOT NULL,
	"branch_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"maturity_amount_paise" bigint NOT NULL,
	"scheme_name" text,
	"policy_number" text,
	"instrument_maturity_on" date,
	"form_submitted_on" date NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_on" date,
	"approved_at" timestamp with time zone,
	"approved_by_id" text,
	"rejected_at" timestamp with time zone,
	"rejection_reason" text,
	"return_reason" text,
	"hold_reason" text,
	"status" "case_status" DEFAULT 'DRAFT' NOT NULL,
	"window_days" integer DEFAULT 15 NOT NULL,
	"rounding_paise" bigint DEFAULT 100000 NOT NULL,
	"distribution" "distribution_mode" DEFAULT 'FRONT_LOADED' NOT NULL,
	"cash_policy" "cash_policy_kind" DEFAULT 'CASH_ONLY' NOT NULL,
	"cash_cap_per_day_paise" bigint,
	"start_on_next_working_day" boolean DEFAULT false NOT NULL,
	"schedule_version" integer DEFAULT 0 NOT NULL,
	"schedule_generated_at" timestamp with time zone,
	"first_payout_on" date,
	"deadline_on" date,
	"paid_cash_paise" bigint DEFAULT 0 NOT NULL,
	"paid_online_paise" bigint DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_amount_positive" CHECK ("maturity_cases"."maturity_amount_paise" > 0),
	CONSTRAINT "cases_window_positive" CHECK ("maturity_cases"."window_days" > 0 AND "maturity_cases"."window_days" <= 366),
	CONSTRAINT "cases_rounding_positive" CHECK ("maturity_cases"."rounding_paise" > 0),
	CONSTRAINT "cases_paid_non_negative" CHECK ("maturity_cases"."paid_cash_paise" >= 0 AND "maturity_cases"."paid_online_paise" >= 0),
	CONSTRAINT "cases_no_overpayment" CHECK ("maturity_cases"."paid_cash_paise" + "maturity_cases"."paid_online_paise" <= "maturity_cases"."maturity_amount_paise"),
	CONSTRAINT "cases_approval_after_submission" CHECK ("maturity_cases"."approved_on" IS NULL OR "maturity_cases"."approved_on" >= "maturity_cases"."form_submitted_on")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"level" "notification_level" DEFAULT 'INFO' NOT NULL,
	"entity" text,
	"entity_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_instalments" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"schedule_version" integer NOT NULL,
	"seq" integer NOT NULL,
	"due_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"cash_leg_paise" bigint NOT NULL,
	"online_leg_paise" bigint NOT NULL,
	"paid_cash_paise" bigint DEFAULT 0 NOT NULL,
	"paid_online_paise" bigint DEFAULT 0 NOT NULL,
	"status" "instalment_status" DEFAULT 'PENDING' NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inst_amount_positive" CHECK ("payout_instalments"."amount_paise" > 0),
	CONSTRAINT "inst_legs_reconcile" CHECK ("payout_instalments"."cash_leg_paise" + "payout_instalments"."online_leg_paise" = "payout_instalments"."amount_paise"),
	CONSTRAINT "inst_legs_non_negative" CHECK ("payout_instalments"."cash_leg_paise" >= 0 AND "payout_instalments"."online_leg_paise" >= 0),
	CONSTRAINT "inst_paid_non_negative" CHECK ("payout_instalments"."paid_cash_paise" >= 0 AND "payout_instalments"."paid_online_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payout_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"instalment_id" text,
	"branch_id" text NOT NULL,
	"cash_paise" bigint DEFAULT 0 NOT NULL,
	"online_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"reference" text,
	"remarks" text,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value_date" date NOT NULL,
	"recorded_by_id" text NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversed_by_id" text,
	"reversal_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "txn_total_positive" CHECK ("payout_transactions"."total_paise" > 0),
	CONSTRAINT "txn_legs_reconcile" CHECK ("payout_transactions"."cash_paise" + "payout_transactions"."online_paise" = "payout_transactions"."total_paise"),
	CONSTRAINT "txn_legs_non_negative" CHECK ("payout_transactions"."cash_paise" >= 0 AND "payout_transactions"."online_paise" >= 0),
	CONSTRAINT "txn_online_needs_reference" CHECK ("payout_transactions"."online_paise" = 0 OR "payout_transactions"."reference" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"employee_code" text,
	"name" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"branch_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_cash_positions" ADD CONSTRAINT "branch_cash_positions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_cash_positions" ADD CONSTRAINT "branch_cash_positions_noted_by_id_users_id_fk" FOREIGN KEY ("noted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_case_id_maturity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."maturity_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_maturity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."maturity_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maturity_cases" ADD CONSTRAINT "maturity_cases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_instalments" ADD CONSTRAINT "payout_instalments_case_id_maturity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."maturity_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_case_id_maturity_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."maturity_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_instalment_id_payout_instalments_id_fk" FOREIGN KEY ("instalment_id") REFERENCES "public"."payout_instalments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_transactions" ADD CONSTRAINT "payout_transactions_reversed_by_id_users_id_fk" FOREIGN KEY ("reversed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_code_uq" ON "agents" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_user_uq" ON "agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agents_branch_idx" ON "agents" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "agents_active_idx" ON "agents" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_branch_at_idx" ON "audit_log" USING btree ("branch_id","at");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_pos_branch_date_uq" ON "branch_cash_positions" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "cash_pos_date_idx" ON "branch_cash_positions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_code_uq" ON "branches" USING btree ("code");--> statement-breakpoint
CREATE INDEX "branches_active_idx" ON "branches" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "doc_case_idx" ON "case_documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "event_case_at_idx" ON "case_events" USING btree ("case_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_code_uq" ON "customers" USING btree ("customer_code");--> statement-breakpoint
CREATE INDEX "customers_branch_idx" ON "customers" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "customers_agent_idx" ON "customers" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "customers_name_idx" ON "customers" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_key_uq" ON "holidays" USING btree ("key");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "holidays_branch_idx" ON "holidays" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_number_uq" ON "maturity_cases" USING btree ("case_number");--> statement-breakpoint
CREATE INDEX "cases_branch_status_idx" ON "maturity_cases" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "cases_agent_status_idx" ON "maturity_cases" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "maturity_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cases_approved_on_idx" ON "maturity_cases" USING btree ("approved_on");--> statement-breakpoint
CREATE INDEX "cases_submitted_on_idx" ON "maturity_cases" USING btree ("form_submitted_on");--> statement-breakpoint
CREATE INDEX "cases_deadline_idx" ON "maturity_cases" USING btree ("deadline_on");--> statement-breakpoint
CREATE INDEX "cases_customer_idx" ON "maturity_cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "notif_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inst_case_version_seq_uq" ON "payout_instalments" USING btree ("case_id","schedule_version","seq");--> statement-breakpoint
CREATE INDEX "inst_due_status_idx" ON "payout_instalments" USING btree ("due_on","status");--> statement-breakpoint
CREATE INDEX "inst_case_status_idx" ON "payout_instalments" USING btree ("case_id","status");--> statement-breakpoint
CREATE INDEX "txn_case_idx" ON "payout_transactions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "txn_branch_value_date_idx" ON "payout_transactions" USING btree ("branch_id","value_date");--> statement-breakpoint
CREATE INDEX "txn_value_date_idx" ON "payout_transactions" USING btree ("value_date");--> statement-breakpoint
CREATE INDEX "txn_instalment_idx" ON "payout_transactions" USING btree ("instalment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_code_uq" ON "users" USING btree ("employee_code");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_branch_idx" ON "users" USING btree ("branch_id");