/**
 * audit.ts — the append-only trail.
 *
 * INV-6: every money-affecting mutation writes an audit row IN THE SAME TRANSACTION as the
 * mutation itself. If the write rolls back, so does its audit entry; if the audit insert fails,
 * the business write fails with it. There is no update or delete path to this table anywhere.
 */
import 'server-only';

import type { Queryable } from '@/db';
import { auditLog } from '@/db/schema';
import { newId } from '@/lib/id';
import type { SessionUser } from '@/lib/auth/session';

export type AuditAction =
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_changed'
  | 'case.created'
  | 'case.updated'
  | 'case.submitted'
  | 'case.ops_reviewed'
  | 'case.returned'
  | 'case.approved'
  | 'case.rejected'
  | 'case.held'
  | 'case.resumed'
  | 'case.cancelled'
  | 'case.completed'
  | 'schedule.generated'
  | 'schedule.overridden'
  | 'schedule.rescheduled'
  | 'payout.recorded'
  | 'payout.reversed'
  | 'payout.missed'
  | 'payout.missed_cleared'
  | 'cash.opening_set'
  | 'cashbook.day_saved'
  | 'cashbook.entry_added'
  | 'cashbook.entry_updated'
  | 'cashbook.entry_voided'
  | 'cashbook.commitment_added'
  | 'cashbook.commitment_updated'
  | 'cashbook.commitment_settled'
  | 'cashbook.commitment_reopened'
  | 'cashbook.commitment_voided'
  | 'cashbook.close_requested'
  | 'cashbook.closed'
  | 'cashbook.close_rejected'
  | 'cashbook.reopened'
  | 'branch.created'
  | 'branch.updated'
  | 'agent.created'
  | 'agent.updated'
  | 'customer.created'
  | 'customer.updated'
  | 'user.created'
  | 'user.updated'
  | 'user.deactivated'
  | 'user.deleted'
  | 'user.restored'
  | 'user.unlocked'
  | 'user.sessions_revoked'
  | 'user.password_reset'
  | 'user.avatar_updated'
  | 'holiday.created'
  | 'holiday.deleted'
  | 'settings.updated'
  | 'document.uploaded'
  | 'document.verified'
  | 'report.exported'
  | 'data.imported'
  | 'schedule.adjusted'
  | 'register.day_close_requested'
  | 'register.day_closed'
  | 'register.day_reopened';

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId: string;
  summary: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/** BigInt is not JSON-serialisable — render money as a decimal string in the trail. */
function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

export async function writeAudit(
  tx: Queryable,
  actor: Pick<SessionUser, 'id' | 'name' | 'role'> | null,
  input: AuditInput,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: newId('aud', 16),
    actorId: actor?.id ?? null,
    actorName: actor?.name ?? 'system',
    actorRole: actor?.role ?? 'ADMIN',
    action: input.action,
    entity: input.entity,
    entityId: input.entityId,
    branchId: input.branchId ?? null,
    summary: input.summary,
    before: input.before === undefined ? null : (jsonSafe(input.before) as object),
    after: input.after === undefined ? null : (jsonSafe(input.after) as object),
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'case.created': 'Case created',
  'case.updated': 'Case edited',
  'case.submitted': 'Form submitted',
  'case.ops_reviewed': 'Operations reviewed',
  'case.returned': 'Returned for correction',
  'case.approved': 'Approved',
  'case.rejected': 'Rejected',
  'case.held': 'Put on hold',
  'case.resumed': 'Resumed',
  'case.cancelled': 'Cancelled',
  'case.completed': 'Completed',
  'schedule.generated': 'Schedule generated',
  'schedule.overridden': 'Schedule overridden',
  'schedule.rescheduled': 'Rescheduled',
  'payout.recorded': 'Payout recorded',
  'payout.reversed': 'Payout reversed',
  'payout.missed': 'Marked not paid',
  'payout.missed_cleared': 'Not-paid mark cleared',
  'cash.opening_set': 'Cash opening set',
  'cashbook.day_saved': 'Cashbook totals saved',
  'cashbook.entry_added': 'Cashbook entry added',
  'cashbook.entry_updated': 'Cashbook entry edited',
  'cashbook.entry_voided': 'Cashbook entry voided',
  'cashbook.commitment_added': 'Named item added',
  'cashbook.commitment_updated': 'Named item edited',
  'cashbook.commitment_settled': 'Named item settled',
  'cashbook.commitment_reopened': 'Named item reopened',
  'cashbook.commitment_voided': 'Named item voided',
  'cashbook.close_requested': 'Cashbook close requested',
  'cashbook.closed': 'Cashbook closed',
  'cashbook.close_rejected': 'Cashbook close rejected',
  'cashbook.reopened': 'Cashbook reopened',
  'branch.created': 'Branch created',
  'branch.updated': 'Branch updated',
  'agent.created': 'Agent added',
  'agent.updated': 'Agent updated',
  'customer.created': 'Customer added',
  'customer.updated': 'Customer updated',
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.deactivated': 'User deactivated',
  'user.deleted': 'User deleted',
  'user.restored': 'User restored',
  'user.unlocked': 'Account unlocked',
  'user.sessions_revoked': 'Sessions revoked',
  'user.password_reset': 'Password reset',
  'user.avatar_updated': 'Photo updated',
  'holiday.created': 'Holiday added',
  'holiday.deleted': 'Holiday removed',
  'settings.updated': 'Settings updated',
  'document.uploaded': 'Document uploaded',
  'document.verified': 'Document verified',
  'report.exported': 'Report exported',
  'data.imported': 'Register imported',
  'schedule.adjusted': 'Schedule amounts adjusted',
};
