/**
 * rbac.ts — the single source of truth for who may do what.
 *
 * Enforced on the SERVER for every mutation. Hiding a button in the UI is a courtesy;
 * this file is the actual control. See docs/04-RBAC.md.
 */

import type { Role } from '@/db/schema';

export type Permission =
  | 'case.view'
  | 'case.create'
  | 'case.submit'
  | 'case.edit'
  | 'case.editApproved'
  | 'case.approve'
  | 'case.reject'
  | 'case.return'
  | 'case.hold'
  | 'case.cancel'
  | 'schedule.preview'
  | 'schedule.override'
  | 'schedule.reschedule'
  | 'payout.record'
  | 'payout.reverse'
  | 'cash.plan'
  | 'cash.setOpening'
  | 'agent.view'
  | 'agent.manage'
  | 'customer.manage'
  | 'branch.view'
  | 'branch.manage'
  | 'user.manage'
  | 'holiday.manage'
  | 'settings.manage'
  | 'report.view'
  | 'report.export'
  | 'data.import'
  | 'audit.view';

export type Scope = 'ALL' | 'BRANCH' | 'OWN';

export const ROLE_SCOPE: Record<Role, Scope> = {
  CMD: 'ALL',
  CEO: 'ALL',
  ADMIN: 'ALL',
  OPS_HEAD: 'ALL',
  AUDITOR: 'ALL',
  BRANCH_MANAGER: 'BRANCH',
  CASHIER: 'BRANCH',
  AGENT: 'OWN',
};

export const ROLE_LABEL: Record<Role, string> = {
  CMD: 'Chairman & Managing Director',
  CEO: 'Chief Executive Officer',
  ADMIN: 'System Administrator',
  OPS_HEAD: 'Operations Head',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  AGENT: 'Agent',
  AUDITOR: 'Auditor',
};

export const ROLE_SHORT: Record<Role, string> = {
  CMD: 'CMD',
  CEO: 'CEO',
  ADMIN: 'Admin',
  OPS_HEAD: 'Ops Head',
  BRANCH_MANAGER: 'Branch Mgr',
  CASHIER: 'Cashier',
  AGENT: 'Agent',
  AUDITOR: 'Auditor',
};

const ALL: Permission[] = [
  'case.view', 'case.create', 'case.submit', 'case.edit', 'case.editApproved', 'case.approve',
  'case.reject', 'case.return', 'case.hold', 'case.cancel', 'schedule.preview', 'schedule.override',
  'schedule.reschedule', 'payout.record', 'payout.reverse', 'cash.plan', 'cash.setOpening',
  'agent.view', 'agent.manage', 'customer.manage', 'branch.view', 'branch.manage', 'user.manage',
  'holiday.manage', 'settings.manage', 'report.view', 'report.export', 'data.import', 'audit.view',
];

/** Branches, users, holidays, org settings — Admin only. CMD/CEO still run the money. */
const STRUCTURE: ReadonlySet<Permission> = new Set<Permission>([
  'branch.manage', 'user.manage', 'holiday.manage', 'settings.manage',
]);

const HQ_OPERATIONS: Permission[] = ALL.filter((p) => !STRUCTURE.has(p));

/**
 * `case.cancel` is how a register row is removed: the row leaves the Register but the case,
 * its events and its audit trail stay. Admin and Branch Manager hold it because both can
 * *add* register rows, and a role that can create a hundred blank rows with one click must be
 * able to take them back. It is not a licence to erase money — `cancelCase()` refuses outright
 * once a rupee has been paid against the case, whoever is asking.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  CMD: new Set(HQ_OPERATIONS),
  CEO: new Set(HQ_OPERATIONS),
  ADMIN: new Set<Permission>([
    'case.view', 'case.create', 'case.edit', 'case.cancel', 'schedule.preview', 'schedule.override',
    'schedule.reschedule', 'cash.plan', 'cash.setOpening', 'agent.view', 'agent.manage',
    'customer.manage', 'branch.view', 'branch.manage', 'user.manage', 'holiday.manage',
    'settings.manage', 'report.view', 'report.export', 'data.import', 'audit.view',
  ]),
  OPS_HEAD: new Set<Permission>([
    'case.view', 'case.create', 'case.submit', 'case.edit', 'case.approve', 'case.reject',
    'case.return', 'case.hold', 'case.cancel', 'schedule.preview', 'schedule.override',
    'schedule.reschedule', 'payout.record', 'payout.reverse', 'cash.plan', 'cash.setOpening',
    'agent.view', 'agent.manage', 'customer.manage', 'branch.view',
    'report.view', 'report.export', 'data.import', 'audit.view',
  ]),
  BRANCH_MANAGER: new Set<Permission>([
    'case.view', 'case.create', 'case.submit', 'case.edit', 'case.hold', 'case.cancel', 'schedule.preview',
    'schedule.reschedule', 'schedule.override', 'payout.record', 'cash.plan', 'cash.setOpening',
    'agent.view', 'agent.manage', 'customer.manage', 'branch.view', 'report.view', 'report.export',
    'data.import',
  ]),
  CASHIER: new Set<Permission>([
    'case.view', 'schedule.preview', 'schedule.override', 'schedule.reschedule',
    'payout.record', 'cash.plan', 'cash.setOpening', 'branch.view', 'report.view',
  ]),
  AGENT: new Set<Permission>([
    'case.view', 'case.create', 'case.submit', 'case.edit', 'schedule.preview', 'agent.view',
    'customer.manage', 'report.view',
  ]),
  AUDITOR: new Set<Permission>([
    'case.view', 'schedule.preview', 'cash.plan', 'agent.view', 'branch.view', 'report.view',
    'report.export', 'audit.view',
  ]),
};

/**
 * Belt and braces: even if a permission is added to AUDITOR by mistake, these can never
 * be granted to a read-only role.
 */
const WRITE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'case.create', 'case.submit', 'case.edit', 'case.editApproved', 'case.approve', 'case.reject',
  'case.return', 'case.hold', 'case.cancel', 'schedule.override', 'schedule.reschedule',
  'payout.record', 'payout.reverse', 'cash.setOpening', 'agent.manage', 'customer.manage',
  'branch.manage', 'user.manage', 'holiday.manage', 'settings.manage', 'data.import',
]);

const READ_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>(['AUDITOR']);

export interface Actor {
  id: string;
  role: Role;
  branchId: string | null;
  agentId: string | null;
  name: string;
}

export interface ResourceRef {
  branchId?: string | null;
  agentId?: string | null;
}

export class ForbiddenError extends Error {
  constructor(
    readonly permission: Permission,
    readonly reason: 'NO_PERMISSION' | 'OUT_OF_SCOPE' | 'READ_ONLY_ROLE',
    message?: string,
  ) {
    super(message ?? `Not permitted: ${permission} (${reason})`);
    this.name = 'ForbiddenError';
  }
}

/** Does this role hold the permission at all, ignoring the specific row? */
export function roleCan(role: Role, permission: Permission): boolean {
  if (READ_ONLY_ROLES.has(role) && WRITE_PERMISSIONS.has(permission)) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Who may type register cells from A/c through Online. Auditor stays read-only. */
export function canTypeRegister(role: Role): boolean {
  return (
    roleCan(role, 'case.edit') ||
    roleCan(role, 'payout.record') ||
    roleCan(role, 'case.create') ||
    roleCan(role, 'schedule.override') ||
    roleCan(role, 'data.import')
  );
}

/** Is this resource inside the actor's data scope? */
export function inScope(actor: Actor, resource: ResourceRef = {}): boolean {
  switch (ROLE_SCOPE[actor.role]) {
    case 'ALL':
      return true;
    case 'BRANCH':
      if (resource.branchId == null) return true; // list query — narrowed at the query layer
      return actor.branchId != null && actor.branchId === resource.branchId;
    case 'OWN':
      if (resource.agentId == null && resource.branchId == null) return true;
      if (resource.agentId != null) return actor.agentId != null && actor.agentId === resource.agentId;
      return actor.branchId != null && actor.branchId === resource.branchId;
  }
}

export function can(actor: Actor, permission: Permission, resource: ResourceRef = {}): boolean {
  return roleCan(actor.role, permission) && inScope(actor, resource);
}

/** The guard every server action starts with. Throws — never returns false. */
export function assertCan(actor: Actor, permission: Permission, resource: ResourceRef = {}): void {
  if (READ_ONLY_ROLES.has(actor.role) && WRITE_PERMISSIONS.has(permission)) {
    throw new ForbiddenError(permission, 'READ_ONLY_ROLE', 'Auditor accounts are read-only.');
  }
  if (!roleCan(actor.role, permission)) {
    throw new ForbiddenError(
      permission,
      'NO_PERMISSION',
      `${ROLE_LABEL[actor.role]} is not allowed to perform this action.`,
    );
  }
  if (!inScope(actor, resource)) {
    throw new ForbiddenError(
      permission,
      'OUT_OF_SCOPE',
      'This record belongs to a branch or agent outside your access.',
    );
  }
}

/** Every permission an actor holds — used to shape the UI in one server round-trip. */
export function permissionsOf(role: Role): Permission[] {
  return ALL.filter((p) => roleCan(role, p));
}

export const ALL_PERMISSIONS = ALL;
