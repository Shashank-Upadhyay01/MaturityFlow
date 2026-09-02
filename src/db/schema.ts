/**
 * MaturityFlow — database schema (Drizzle ORM / PostgreSQL).
 *
 * INV-1: every money column is `bigint` PAISE. There is not a single float in this file.
 * INV-3 / INV-4 are additionally enforced by CHECK constraints so that even a hand-written
 * SQL statement cannot corrupt the ledger.
 *
 * See docs/02-DOMAIN-MODEL.md
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ───────────────────────────────────────────────────────────── enums ──

export const roleEnum = pgEnum('role', [
  'CMD',
  'CEO',
  'ADMIN',
  'OPS_HEAD',
  'BRANCH_MANAGER',
  'CASHIER',
  'AGENT',
  'AUDITOR',
]);

export const caseStatusEnum = pgEnum('case_status', [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'RETURNED',
  'APPROVED',
  'REJECTED',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
]);

export const instalmentStatusEnum = pgEnum('instalment_status', [
  'PENDING',
  'PARTIAL',
  'PAID',
  'MISSED',
  'SUPERSEDED',
  'CANCELLED',
]);

export const distributionEnum = pgEnum('distribution_mode', [
  'FRONT_LOADED',
  'BACK_LOADED',
  'EVEN',
]);

/** How often a case pays out. Persisted at approval — never re-derived from the amount. */
export const payoutCadenceEnum = pgEnum('payout_cadence', ['DAILY', 'ALTERNATE']);

export const cashPolicyEnum = pgEnum('cash_policy_kind', ['CASH_ONLY', 'ONLINE_ONLY', 'CASH_CAP']);

export const saturdayRuleEnum = pgEnum('saturday_rule', ['NONE', 'ALL', 'SECOND_FOURTH']);

export const documentKindEnum = pgEnum('document_kind', [
  'MATURITY_FORM',
  'ID_PROOF',
  'ADDRESS_PROOF',
  'PASSBOOK',
  'CANCELLED_CHEQUE',
  'PHOTO',
  'DISCHARGE_RECEIPT',
  'OTHER',
]);

export const caseEventTypeEnum = pgEnum('case_event_type', [
  'CREATED',
  'SUBMITTED',
  'PICKED_UP',
  'RETURNED',
  'APPROVED',
  'REJECTED',
  'SCHEDULE_GENERATED',
  'SCHEDULE_OVERRIDDEN',
  'RESCHEDULED',
  'PAYMENT_RECORDED',
  'PAYMENT_REVERSED',
  'PUT_ON_HOLD',
  'RESUMED',
  'COMPLETED',
  'CANCELLED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_VERIFIED',
  'NOTE_ADDED',
  'EDITED',
]);

export const notificationLevelEnum = pgEnum('notification_level', ['INFO', 'WARNING', 'CRITICAL']);

export const appUpdateKindEnum = pgEnum('app_update_kind', ['NEW', 'IMPROVED', 'FIXED']);

export const bugReportSeverityEnum = pgEnum('bug_report_severity', [
  'ANNOYING',
  'STOPPED_WORK',
  'MONEY',
]);

export const bugReportStatusEnum = pgEnum('bug_report_status', [
  'OPEN',
  'LOOKING',
  'FIXED',
  'CLOSED',
]);

export const cashbookDayStatusEnum = pgEnum('cashbook_day_status', [
  'OPEN',
  'CLOSE_REQUESTED',
  'CLOSED',
]);

export const cashbookEntryCategoryEnum = pgEnum('cashbook_entry_category', [
  'OTHER_RECEIPT',
  'NEW_LOAN',
  'SAVINGS_DEPOSIT',
  'WITHDRAWAL',
  'EXPENSE',
  'RENEWAL',
  'OPENING_BALANCE',
]);

export const cashbookEntryChannelEnum = pgEnum('cashbook_entry_channel', ['CASH', 'ACCOUNT']);

export const cashbookCommitmentKindEnum = pgEnum('cashbook_commitment_kind', [
  'GIVEN_CASH',
  'DUE_AMOUNT',
  'PENDING_WITHDRAWAL',
]);

// ──────────────────────────────────────────────────────────── tables ──

export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    city: text('city'),
    state: text('state'),
    address: text('address'),
    phone: text('phone'),
    ifsc: text('ifsc'),
    isActive: boolean('is_active').notNull().default(true),

    // Branch policy defaults — overridable per case by ADMIN / CEO / CMD.
    defaultRoundingPaise: bigint('default_rounding_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`100000`), // ₹1,000
    defaultWindowDays: integer('default_window_days').notNull().default(15),
    dailyCashComfortPaise: bigint('daily_cash_comfort_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`50000000`), // ₹5,00,000
    sundaysOff: boolean('sundays_off').notNull().default(true),
    saturdayRule: saturdayRuleEnum('saturday_rule').notNull().default('SECOND_FOURTH'),

    /** Admin-set register column order / hidden columns. JSON { order, hidden }. */
    registerColumnOrder: jsonb('register_column_order'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('branches_code_uq').on(t.code),
    index('branches_active_idx').on(t.isActive),
    check('branches_rounding_positive', sql`${t.defaultRoundingPaise} > 0`),
    check('branches_window_positive', sql`${t.defaultWindowDays} > 0`),
  ],
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    username: text('username').notNull(),
    employeeCode: text('employee_code'),
    name: text('name').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    role: roleEnum('role').notNull(),
    branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** Storage key under STORAGE_ROOT. Served only via /api/avatars/:id. */
    avatarKey: text('avatar_key'),
    /** Admin-only internal note. Never shown to the account holder. */
    notes: text('notes'),

    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Soft-delete. Login is refused. Financial rows that name this person stay intact. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_username_uq').on(t.username),
    uniqueIndex('users_employee_code_uq').on(t.employeeCode),
    index('users_role_idx').on(t.role),
    index('users_branch_idx').on(t.branchId),
    index('users_active_idx').on(t.isActive),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    /** jti carried inside the JWT — lets us revoke a live token instantly. */
    tokenId: text('token_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenId),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expiry_idx').on(t.expiresAt),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    joinedOn: date('joined_on', { mode: 'string' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agents_code_uq').on(t.code),
    uniqueIndex('agents_user_uq').on(t.userId),
    index('agents_branch_idx').on(t.branchId),
    index('agents_active_idx').on(t.isActive),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    customerCode: text('customer_code'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    accountNumber: text('account_number'),
    payoutBank: text('payout_bank'),
    payoutAccount: text('payout_account'),
    payoutIfsc: text('payout_ifsc'),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('customers_code_uq').on(t.customerCode),
    index('customers_branch_idx').on(t.branchId),
    index('customers_agent_idx').on(t.agentId),
    index('customers_name_idx').on(t.name),
  ],
);

/** Upcoming maturities supplied by the core/legacy forecast, before any payout form is submitted. */
export const maturityForecasts = pgTable(
  'maturity_forecasts',
  {
    id: text('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    accountNumber: text('account_number'),
    customerName: text('customer_name').notNull(),
    agentName: text('agent_name'),
    planAmountPaise: bigint('plan_amount_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    totalDepositPaise: bigint('total_deposit_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    joinedOn: date('joined_on', { mode: 'string' }),
    maturityOn: date('maturity_on', { mode: 'string' }).notNull(),
    productName: text('product_name'),
    planName: text('plan_name'),
    actualMaturityPaise: bigint('actual_maturity_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    currentMaturityPaise: bigint('current_maturity_paise', { mode: 'bigint' }).notNull(),
    tenureMonths: integer('tenure_months'),
    interestRateBps: integer('interest_rate_bps'),
    sourceWorkbook: text('source_workbook').notNull(),
    sourceSheet: text('source_sheet').notNull(),
    sourceRow: integer('source_row').notNull(),
    importedById: text('imported_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('maturity_forecasts_source_uq').on(t.sourceKey),
    index('maturity_forecasts_branch_date_idx').on(t.branchId, t.maturityOn),
    index('maturity_forecasts_date_idx').on(t.maturityOn),
    index('maturity_forecasts_customer_idx').on(t.customerName),
    check(
      'maturity_forecasts_money_non_negative',
      sql`${t.planAmountPaise} >= 0 AND ${t.totalDepositPaise} >= 0 AND ${t.actualMaturityPaise} >= 0 AND ${t.currentMaturityPaise} > 0`,
    ),
  ],
);

export const maturityCases = pgTable(
  'maturity_cases',
  {
    id: text('id').primaryKey(),
    caseNumber: text('case_number').notNull(),

    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'restrict' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),

    /** THE amount. Integer paise. */
    maturityAmountPaise: bigint('maturity_amount_paise', { mode: 'bigint' }).notNull(),
    schemeName: text('scheme_name'),
    policyNumber: text('policy_number'),
    instrumentMaturityOn: date('instrument_maturity_on', { mode: 'string' }),

    /** When the agent handed in the form. Never used as the schedule anchor. */
    formSubmittedOn: date('form_submitted_on', { mode: 'string' }).notNull(),
    /** Excel “Payment Date” — not the same as ops approval. */
    paymentOn: date('payment_on', { mode: 'string' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    /**
     * Human acknowledgement by Operations. This never gates or anchors the payout schedule:
     * an empty value means the automatic day-three progression was not acknowledged by staff.
     */
    opsReviewedOn: date('ops_reviewed_on', { mode: 'string' }),
    opsReviewedAt: timestamp('ops_reviewed_at', { withTimezone: true }),
    opsReviewedById: text('ops_reviewed_by_id').references(() => users.id, { onDelete: 'set null' }),

    /** THE anchor. Schedule and SLA clock both start here. */
    approvedOn: date('approved_on', { mode: 'string' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedById: text('approved_by_id').references(() => users.id, { onDelete: 'set null' }),

    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    returnReason: text('return_reason'),
    holdReason: text('hold_reason'),

    status: caseStatusEnum('status').notNull().default('DRAFT'),

    // Schedule parameters — the only schedule inputs a client may supply.
    windowDays: integer('window_days').notNull().default(15),
    roundingPaise: bigint('rounding_paise', { mode: 'bigint' }).notNull().default(sql`100000`),
    distribution: distributionEnum('distribution').notNull().default('FRONT_LOADED'),
    /**
     * Set once, at approval, from the maturity amount. Stored rather than re-derived because the
     * amount is editable: correcting a figure months later must not silently move a case from
     * alternate-day to daily payouts.
     */
    cadence: payoutCadenceEnum('cadence').notNull().default('DAILY'),
    cashPolicy: cashPolicyEnum('cash_policy').notNull().default('CASH_ONLY'),
    cashCapPerDayPaise: bigint('cash_cap_per_day_paise', { mode: 'bigint' }),
    startOnNextWorkingDay: boolean('start_on_next_working_day').notNull().default(false),

    // Derived server-side at approval.
    scheduleVersion: integer('schedule_version').notNull().default(0),
    scheduleGeneratedAt: timestamp('schedule_generated_at', { withTimezone: true }),
    firstPayoutOn: date('first_payout_on', { mode: 'string' }),
    /** The promised completion date — what "within N days" means for this case. */
    deadlineOn: date('deadline_on', { mode: 'string' }),

    // Running totals, maintained transactionally with every payment.
    paidCashPaise: bigint('paid_cash_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    paidOnlinePaise: bigint('paid_online_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    /** Today's approved withdrawable — the Excel column the counter actually pays. */
    todayApprovedPaise: bigint('today_approved_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    todayCashPaise: bigint('today_cash_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    todayOnlinePaise: bigint('today_online_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    notes: text('notes'),

    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cases_number_uq').on(t.caseNumber),
    index('cases_branch_status_idx').on(t.branchId, t.status),
    index('cases_agent_status_idx').on(t.agentId, t.status),
    index('cases_status_idx').on(t.status),
    index('cases_approved_on_idx').on(t.approvedOn),
    index('cases_submitted_on_idx').on(t.formSubmittedOn),
    index('cases_ops_reviewed_on_idx').on(t.opsReviewedOn),
    index('cases_deadline_idx').on(t.deadlineOn),
    index('cases_customer_idx').on(t.customerId),
    // INV-1 / sanity
    check('cases_amount_positive', sql`${t.maturityAmountPaise} > 0`),
    check('cases_window_positive', sql`${t.windowDays} > 0 AND ${t.windowDays} <= 366`),
    check('cases_rounding_positive', sql`${t.roundingPaise} > 0`),
    check('cases_paid_non_negative', sql`${t.paidCashPaise} >= 0 AND ${t.paidOnlinePaise} >= 0`),
    check('cases_today_approved_non_negative', sql`${t.todayApprovedPaise} >= 0`),
    check('cases_today_split_non_negative', sql`${t.todayCashPaise} >= 0 AND ${t.todayOnlinePaise} >= 0`),
    // INV-4 — the ledger can never exceed the maturity amount, even via raw SQL.
    check(
      'cases_no_overpayment',
      sql`${t.paidCashPaise} + ${t.paidOnlinePaise} <= ${t.maturityAmountPaise}`,
    ),
    // INV-5 — a case cannot be approved before it was submitted.
    check(
      'cases_approval_after_submission',
      sql`${t.approvedOn} IS NULL OR ${t.approvedOn} >= ${t.formSubmittedOn}`,
    ),
  ],
);

export const payoutInstalments = pgTable(
  'payout_instalments',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => maturityCases.id, { onDelete: 'cascade' }),
    /** Bumped on reschedule. Old rows are kept as SUPERSEDED, never deleted. */
    scheduleVersion: integer('schedule_version').notNull(),
    seq: integer('seq').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),

    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    cashLegPaise: bigint('cash_leg_paise', { mode: 'bigint' }).notNull(),
    onlineLegPaise: bigint('online_leg_paise', { mode: 'bigint' }).notNull(),

    paidCashPaise: bigint('paid_cash_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    paidOnlinePaise: bigint('paid_online_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    status: instalmentStatusEnum('status').notNull().default('PENDING'),
    isFinal: boolean('is_final').notNull().default(false),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('inst_case_version_seq_uq').on(t.caseId, t.scheduleVersion, t.seq),
    index('inst_due_status_idx').on(t.dueOn, t.status),
    index('inst_case_status_idx').on(t.caseId, t.status),
    check('inst_amount_positive', sql`${t.amountPaise} > 0`),
    // INV-3 — the legs always reconcile to the instalment amount.
    check('inst_legs_reconcile', sql`${t.cashLegPaise} + ${t.onlineLegPaise} = ${t.amountPaise}`),
    check('inst_legs_non_negative', sql`${t.cashLegPaise} >= 0 AND ${t.onlineLegPaise} >= 0`),
    check('inst_paid_non_negative', sql`${t.paidCashPaise} >= 0 AND ${t.paidOnlinePaise} >= 0`),
  ],
);

export const payoutTransactions = pgTable(
  'payout_transactions',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => maturityCases.id, { onDelete: 'restrict' }),
    instalmentId: text('instalment_id').references(() => payoutInstalments.id, {
      onDelete: 'set null',
    }),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),

    cashPaise: bigint('cash_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    onlinePaise: bigint('online_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    totalPaise: bigint('total_paise', { mode: 'bigint' }).notNull(),

    /** UTR / NEFT / IMPS reference. Required whenever onlinePaise > 0. */
    reference: text('reference'),
    remarks: text('remarks'),

    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    valueDate: date('value_date', { mode: 'string' }).notNull(),

    recordedById: text('recorded_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Reversals are additive — the row stays, flagged. Totals exclude reversed rows. */
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedById: text('reversed_by_id').references(() => users.id, { onDelete: 'set null' }),
    reversalReason: text('reversal_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('txn_case_idx').on(t.caseId),
    index('txn_branch_value_date_idx').on(t.branchId, t.valueDate),
    index('txn_value_date_idx').on(t.valueDate),
    index('txn_instalment_idx').on(t.instalmentId),
    check('txn_total_positive', sql`${t.totalPaise} > 0`),
    check('txn_legs_reconcile', sql`${t.cashPaise} + ${t.onlinePaise} = ${t.totalPaise}`),
    check('txn_legs_non_negative', sql`${t.cashPaise} >= 0 AND ${t.onlinePaise} >= 0`),
    // An online leg without a reference is not auditable — refuse it at the database.
    check('txn_online_needs_reference', sql`${t.onlinePaise} = 0 OR ${t.reference} IS NOT NULL`),
  ],
);

export const caseDocuments = pgTable(
  'case_documents',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => maturityCases.id, { onDelete: 'cascade' }),
    kind: documentKindEnum('kind').notNull().default('OTHER'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadedById: text('uploaded_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    verifiedById: text('verified_by_id').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (t) => [index('doc_case_idx').on(t.caseId)],
);

export const caseEvents = pgTable(
  'case_events',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => maturityCases.id, { onDelete: 'cascade' }),
    type: caseEventTypeEnum('type').notNull(),
    fromStatus: caseStatusEnum('from_status'),
    toStatus: caseStatusEnum('to_status'),
    note: text('note'),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('event_case_at_idx').on(t.caseId, t.at)],
);

/** Append-only. No code path in this repository updates or deletes from this table. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorName: text('actor_name').notNull(),
    actorRole: roleEnum('actor_role').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    branchId: text('branch_id'),
    summary: text('summary').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('audit_at_idx').on(t.at),
    index('audit_entity_idx').on(t.entity, t.entityId),
    index('audit_actor_idx').on(t.actorId),
    index('audit_branch_at_idx').on(t.branchId, t.at),
    index('audit_action_idx').on(t.action),
  ],
);

export const holidays = pgTable(
  'holidays',
  {
    id: text('id').primaryKey(),
    /** `${date}|${branchId ?? 'ALL'}` — one holiday per date per scope. */
    key: text('key').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    /** null = every branch. */
    branchId: text('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('holidays_key_uq').on(t.key),
    index('holidays_date_idx').on(t.date),
    index('holidays_branch_idx').on(t.branchId),
  ],
);

export const branchCashPositions = pgTable(
  'branch_cash_positions',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    openingCashPaise: bigint('opening_cash_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    plannedOnlinePaise: bigint('planned_online_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    note: text('note'),
    notedById: text('noted_by_id').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cash_pos_branch_date_uq').on(t.branchId, t.date),
    index('cash_pos_date_idx').on(t.date),
    check('cash_pos_non_negative', sql`${t.openingCashPaise} >= 0`),
    check('cash_pos_online_non_negative', sql`${t.plannedOnlinePaise} >= 0`),
  ],
);

export const registerDays = pgTable(
  'register_days',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    status: text('status').notNull().default('OPEN'),
    requestedById: text('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    approvedById: text('approved_by_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('register_days_branch_date_uq').on(t.branchId, t.date)],
);

/**
 * One branch cashbook per business date.
 *
 * Entry streams live in `cashbook_entries`; the five manual report figures and the physical
 * drawer count live here. Derived totals are never stored while the day is open. On close the
 * server records a string-only JSON snapshot so an exported final report can name exactly what
 * was approved without trusting browser arithmetic.
 */
export const cashbookDays = pgTable(
  'cashbook_days',
  {
    id: text('id').primaryKey(),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    status: cashbookDayStatusEnum('status').notNull().default('OPEN'),

    oldPortalTotalPaise: bigint('old_portal_total_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    fixedDepositPaise: bigint('fixed_deposit_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    newBusinessPaise: bigint('new_business_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    membershipCollectionPaise: bigint('membership_collection_paise', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    oldLoanPaise: bigint('old_loan_paise', { mode: 'bigint' }).notNull().default(sql`0`),

    note500Count: integer('note_500_count').notNull().default(0),
    note200Count: integer('note_200_count').notNull().default(0),
    note100Count: integer('note_100_count').notNull().default(0),
    note50Count: integer('note_50_count').notNull().default(0),
    note20Count: integer('note_20_count').notNull().default(0),
    note10Count: integer('note_10_count').notNull().default(0),
    /** Aggregate value of every metal coin, in paise — deliberately not a coin count. */
    coinsPaise: bigint('coins_paise', { mode: 'bigint' }).notNull().default(sql`0`),
    notes: text('notes'),

    /** Optimistic-concurrency token. Every cashbook write increments it. */
    version: integer('version').notNull().default(0),
    /** Increments on every confirmed close, including after an authorised reopen. */
    closeRevision: integer('close_revision').notNull().default(0),
    closeRequestedById: text('close_requested_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    closeRequestedAt: timestamp('close_requested_at', { withTimezone: true }),
    closeReason: text('close_reason'),
    closedById: text('closed_by_id').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeSnapshot: jsonb('close_snapshot'),

    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedById: text('updated_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cashbook_days_branch_date_uq').on(t.branchId, t.date),
    index('cashbook_days_date_status_idx').on(t.date, t.status),
    index('cashbook_days_branch_status_idx').on(t.branchId, t.status),
    check(
      'cashbook_day_money_non_negative',
      sql`${t.oldPortalTotalPaise} >= 0 AND ${t.fixedDepositPaise} >= 0 AND ${t.newBusinessPaise} >= 0 AND ${t.membershipCollectionPaise} >= 0 AND ${t.oldLoanPaise} >= 0 AND ${t.coinsPaise} >= 0`,
    ),
    check(
      'cashbook_day_counts_non_negative',
      sql`${t.note500Count} >= 0 AND ${t.note200Count} >= 0 AND ${t.note100Count} >= 0 AND ${t.note50Count} >= 0 AND ${t.note20Count} >= 0 AND ${t.note10Count} >= 0`,
    ),
    check('cashbook_day_versions_non_negative', sql`${t.version} >= 0 AND ${t.closeRevision} >= 0`),
  ],
);

/**
 * Normalised independent amount streams from the old spreadsheet columns.
 *
 * There is intentionally no positional “row” relationship between entries in different
 * categories: row 12 in Receiving and row 12 in Withdrawal never meant they were one event.
 * Rows are voided rather than deleted so the audit record and original amount survive.
 */
export const cashbookEntries = pgTable(
  'cashbook_entries',
  {
    id: text('id').primaryKey(),
    cashbookDayId: text('cashbook_day_id')
      .notNull()
      .references(() => cashbookDays.id, { onDelete: 'restrict' }),
    category: cashbookEntryCategoryEnum('category').notNull(),
    channel: cashbookEntryChannelEnum('channel').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    partyName: text('party_name'),
    reference: text('reference'),
    note: text('note'),

    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: text('voided_by_id').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),

    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedById: text('updated_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cashbook_entries_day_category_idx').on(t.cashbookDayId, t.category),
    index('cashbook_entries_day_channel_idx').on(t.cashbookDayId, t.channel),
    check('cashbook_entry_amount_positive', sql`${t.amountPaise} > 0`),
    check(
      'cashbook_entry_cash_only_outflows',
      sql`${t.category} NOT IN ('WITHDRAWAL', 'EXPENSE', 'OPENING_BALANCE') OR ${t.channel} = 'CASH'`,
    ),
  ],
);

/** Named, reporting-only obligations from the right side of the working sheet. */
export const cashbookCommitments = pgTable(
  'cashbook_commitments',
  {
    id: text('id').primaryKey(),
    cashbookDayId: text('cashbook_day_id')
      .notNull()
      .references(() => cashbookDays.id, { onDelete: 'restrict' }),
    kind: cashbookCommitmentKindEnum('kind').notNull(),
    amountPaise: bigint('amount_paise', { mode: 'bigint' }).notNull(),
    partyName: text('party_name').notNull(),
    reference: text('reference'),
    note: text('note'),
    dueOn: date('due_on', { mode: 'string' }),

    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledById: text('settled_by_id').references(() => users.id, { onDelete: 'set null' }),
    settlementNote: text('settlement_note'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedById: text('voided_by_id').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),

    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    updatedById: text('updated_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cashbook_commitments_day_kind_idx').on(t.cashbookDayId, t.kind),
    index('cashbook_commitments_open_idx').on(t.kind, t.settledAt, t.voidedAt),
    check('cashbook_commitment_amount_positive', sql`${t.amountPaise} > 0`),
    check('cashbook_commitment_needs_name', sql`NULLIF(BTRIM(${t.partyName}), '') IS NOT NULL`),
  ],
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    level: notificationLevelEnum('level').notNull().default('INFO'),
    entity: text('entity'),
    entityId: text('entity_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notif_user_read_idx').on(t.userId, t.readAt)],
);

/** Plain-language product notes. Everyone may read; only Admin may write. */
export const appUpdates = pgTable(
  'app_updates',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    kind: appUpdateKindEnum('kind').notNull().default('NEW'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('app_updates_published_idx').on(t.publishedAt)],
);

/** Problems reported in everyday language. The reporter and Admin may read a row. */
export const bugReports = pgTable(
  'bug_reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    screen: text('screen').notNull(),
    tryingTo: text('trying_to').notNull(),
    whatHappened: text('what_happened').notNull(),
    extra: text('extra'),
    severity: bugReportSeverityEnum('severity').notNull(),
    pagePath: text('page_path'),
    reporterRole: roleEnum('reporter_role').notNull(),
    branchId: text('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    userAgent: text('user_agent'),
    status: bugReportStatusEnum('status').notNull().default('OPEN'),
    adminNote: text('admin_note'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: text('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bug_reports_status_idx').on(t.status, t.createdAt),
    index('bug_reports_reporter_idx').on(t.reporterId, t.createdAt),
  ],
);

/** Monotonic per-branch, per-year counter behind the human-facing case number. */
export const caseCounters = pgTable('case_counters', {
  key: text('key').primaryKey(), // `${branchCode}|${year}`
  value: integer('value').notNull().default(0),
});

// ───────────────────────────────────────────────────────── relations ──

export const branchRelations = relations(branches, ({ many }) => ({
  users: many(users),
  agents: many(agents),
  customers: many(customers),
  cases: many(maturityCases),
  cashPositions: many(branchCashPositions),
  cashbookDays: many(cashbookDays),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  branch: one(branches, { fields: [users.branchId], references: [branches.id] }),
  sessions: many(sessions),
}));

export const agentRelations = relations(agents, ({ one, many }) => ({
  branch: one(branches, { fields: [agents.branchId], references: [branches.id] }),
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  customers: many(customers),
  cases: many(maturityCases),
}));

export const customerRelations = relations(customers, ({ one, many }) => ({
  branch: one(branches, { fields: [customers.branchId], references: [branches.id] }),
  agent: one(agents, { fields: [customers.agentId], references: [agents.id] }),
  cases: many(maturityCases),
}));

export const caseRelations = relations(maturityCases, ({ one, many }) => ({
  branch: one(branches, { fields: [maturityCases.branchId], references: [branches.id] }),
  agent: one(agents, { fields: [maturityCases.agentId], references: [agents.id] }),
  customer: one(customers, { fields: [maturityCases.customerId], references: [customers.id] }),
  approvedBy: one(users, { fields: [maturityCases.approvedById], references: [users.id] }),
  createdBy: one(users, { fields: [maturityCases.createdById], references: [users.id] }),
  instalments: many(payoutInstalments),
  transactions: many(payoutTransactions),
  documents: many(caseDocuments),
  events: many(caseEvents),
}));

export const instalmentRelations = relations(payoutInstalments, ({ one, many }) => ({
  case: one(maturityCases, { fields: [payoutInstalments.caseId], references: [maturityCases.id] }),
  transactions: many(payoutTransactions),
}));

export const transactionRelations = relations(payoutTransactions, ({ one }) => ({
  case: one(maturityCases, { fields: [payoutTransactions.caseId], references: [maturityCases.id] }),
  instalment: one(payoutInstalments, {
    fields: [payoutTransactions.instalmentId],
    references: [payoutInstalments.id],
  }),
  branch: one(branches, { fields: [payoutTransactions.branchId], references: [branches.id] }),
  recordedBy: one(users, { fields: [payoutTransactions.recordedById], references: [users.id] }),
}));

export const documentRelations = relations(caseDocuments, ({ one }) => ({
  case: one(maturityCases, { fields: [caseDocuments.caseId], references: [maturityCases.id] }),
  uploadedBy: one(users, { fields: [caseDocuments.uploadedById], references: [users.id] }),
}));

export const eventRelations = relations(caseEvents, ({ one }) => ({
  case: one(maturityCases, { fields: [caseEvents.caseId], references: [maturityCases.id] }),
  actor: one(users, { fields: [caseEvents.actorId], references: [users.id] }),
}));

export const cashbookDayRelations = relations(cashbookDays, ({ one, many }) => ({
  branch: one(branches, { fields: [cashbookDays.branchId], references: [branches.id] }),
  entries: many(cashbookEntries),
  commitments: many(cashbookCommitments),
  createdBy: one(users, { fields: [cashbookDays.createdById], references: [users.id] }),
}));

export const cashbookEntryRelations = relations(cashbookEntries, ({ one }) => ({
  day: one(cashbookDays, {
    fields: [cashbookEntries.cashbookDayId],
    references: [cashbookDays.id],
  }),
  createdBy: one(users, { fields: [cashbookEntries.createdById], references: [users.id] }),
}));

export const cashbookCommitmentRelations = relations(cashbookCommitments, ({ one }) => ({
  day: one(cashbookDays, {
    fields: [cashbookCommitments.cashbookDayId],
    references: [cashbookDays.id],
  }),
  createdBy: one(users, {
    fields: [cashbookCommitments.createdById],
    references: [users.id],
  }),
}));

// ───────────────────────────────────────────────────── inferred types ──

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type MaturityForecast = typeof maturityForecasts.$inferSelect;
export type MaturityCase = typeof maturityCases.$inferSelect;
export type NewMaturityCase = typeof maturityCases.$inferInsert;
export type PayoutInstalment = typeof payoutInstalments.$inferSelect;
export type PayoutTransaction = typeof payoutTransactions.$inferSelect;
export type CaseDocument = typeof caseDocuments.$inferSelect;
export type CaseEvent = typeof caseEvents.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type BranchCashPosition = typeof branchCashPositions.$inferSelect;
export type CashbookDay = typeof cashbookDays.$inferSelect;
export type CashbookEntry = typeof cashbookEntries.$inferSelect;
export type CashbookCommitment = typeof cashbookCommitments.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AppUpdate = typeof appUpdates.$inferSelect;
export type BugReport = typeof bugReports.$inferSelect;
export type AppUpdateKind = (typeof appUpdateKindEnum.enumValues)[number];
export type BugReportSeverity = (typeof bugReportSeverityEnum.enumValues)[number];
export type BugReportStatus = (typeof bugReportStatusEnum.enumValues)[number];

export type Role = (typeof roleEnum.enumValues)[number];

/**
 * The roles a user may actually hold.
 *
 * `OPS_HEAD` stays in `roleEnum` because Postgres has no `ALTER TYPE ... DROP VALUE` and audit
 * rows still name it. It is retired in the application instead: not assignable, not in the
 * permission matrix, no login path. See docs/adr/0005.
 */
export type ActiveRole = Exclude<Role, 'OPS_HEAD'>;
export type CaseStatus = (typeof caseStatusEnum.enumValues)[number];
export type InstalmentStatus = (typeof instalmentStatusEnum.enumValues)[number];
export type DistributionMode = (typeof distributionEnum.enumValues)[number];
export type CashPolicyKind = (typeof cashPolicyEnum.enumValues)[number];
export type SaturdayRule = (typeof saturdayRuleEnum.enumValues)[number];
export type CashbookDayStatus = (typeof cashbookDayStatusEnum.enumValues)[number];
export type CashbookEntryCategory = (typeof cashbookEntryCategoryEnum.enumValues)[number];
export type CashbookEntryChannel = (typeof cashbookEntryChannelEnum.enumValues)[number];
export type CashbookCommitmentKind = (typeof cashbookCommitmentKindEnum.enumValues)[number];
export type DocumentKind = (typeof documentKindEnum.enumValues)[number];
export type CaseEventType = (typeof caseEventTypeEnum.enumValues)[number];
