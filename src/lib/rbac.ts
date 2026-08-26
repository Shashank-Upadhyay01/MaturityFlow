/**
 * rbac.ts — the single source of truth for who may do what.
 *
 * Enforced on the SERVER for every mutation. Hiding a button in the UI is a courtesy;
 * this file is the actual control. See docs/04-RBAC.md.
 */

import type { ActiveRole, Role } from '@/db/schema';

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

/**
 * How much data a role can SEE.
 *
 * Every role reads the whole bank. The Register, the summary, the cash runway and the branch
 * rollup show the same picture to everyone, so a cashier can answer a question about another
 * branch without ringing head office.
 *
 * This is the *read* half only. It is consulted by `caseScope()` and by the screens that decide
 * whether to show a branch picker. For anything that changes a record, see ROLE_WRITE_SCOPE.
 */
export const ROLE_SCOPE: Record<ActiveRole, Scope> = {
  CMD: 'ALL',
  CEO: 'ALL',
  ADMIN: 'ALL',
  AUDITOR: 'ALL',
  BRANCH_MANAGER: 'ALL',
  CASHIER: 'ALL',
  AGENT: 'ALL',
};

/**
 * How much data a role can CHANGE — deliberately narrower than what it can see.
 *
 * Letting everyone *see* every branch is a reporting decision. Letting everyone *write* to every
 * branch is a different decision entirely, and nobody made it. A cashier hands cash across one
 * counter and a branch manager runs one branch, so both stay pinned to their own branch for
 * anything that moves money; an agent writes only to their own cases.
 *
 * Without this split, widening ROLE_SCOPE to 'ALL' would silently hand an agent — who holds
 * `case.submit`, `case.edit` and `customer.manage` — write access to every case in the bank,
 * because `inScope` would stop objecting. Never widen a role here to match ROLE_SCOPE unless you
 * have separately decided that role should be able to alter another branch's money.
 */
export const ROLE_WRITE_SCOPE: Record<ActiveRole, Scope> = {
  CMD: 'ALL',
  CEO: 'ALL',
  ADMIN: 'ALL',
  // Holds no write permission at all; READ_ONLY_ROLES rejects it before scope is ever consulted.
  AUDITOR: 'ALL',
  BRANCH_MANAGER: 'BRANCH',
  CASHIER: 'BRANCH',
  AGENT: 'OWN',
};

export const ROLE_LABEL: Record<ActiveRole, string> = {
  CMD: 'Chairman & Managing Director',
  CEO: 'Chief Executive Officer',
  ADMIN: 'System Administrator',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  AGENT: 'Agent',
  AUDITOR: 'Auditor',
};

export const ROLE_SHORT: Record<ActiveRole, string> = {
  CMD: 'CMD',
  CEO: 'CEO',
  ADMIN: 'Admin',
  BRANCH_MANAGER: 'Branch Mgr',
  CASHIER: 'Cashier',
  AGENT: 'Agent',
  AUDITOR: 'Auditor',
};

/**
 * The roles the user manager may assign. Order is the org chart, not the alphabet.
 */
export const ASSIGNABLE_ROLES = [
  'CMD', 'CEO', 'ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR',
] as const satisfies readonly ActiveRole[];

/**
 * Read a stored role as one the app still knows about.
 *
 * The database can hand back `OPS_HEAD` from any row written before the role was retired — a
 * user, an audit line, a case event. Those rows are history and are never rewritten, so every
 * lookup into a role table goes through here rather than casting. An Ops Head reads as the
 * Admin their account was migrated to, which is exactly the authority they had.
 */
export function activeRole(role: Role): ActiveRole {
  return role === 'OPS_HEAD' ? 'ADMIN' : role;
}

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
export const ROLE_PERMISSIONS: Record<ActiveRole, ReadonlySet<Permission>> = {
  CMD: new Set(HQ_OPERATIONS),
  CEO: new Set(HQ_OPERATIONS),
  /**
   * The system administrator holds every permission there is.
   *
   * Deliberate, and asked for: Admin is the account that has to be able to see and do anything
   * any other role can, including the operational half — submitting, approving, recording and
   * reversing payouts — on top of the structural permissions (branches, users, holidays, org
   * settings) that only this role has ever had.
   *
   * The consequence, stated plainly because it is a real one: an Admin can approve a case and
   * then pay it out, so for this role alone the maker-checker separation that `case.approve`
   * normally provides does not apply. Every one of those actions still writes an audit row in
   * the same transaction, which is what makes it reviewable after the fact.
   */
  ADMIN: new Set<Permission>(ALL),
  BRANCH_MANAGER: new Set<Permission>([
    'case.view', 'case.create', 'case.submit', 'case.edit', 'case.hold', 'case.cancel', 'schedule.preview',
    'schedule.reschedule', 'schedule.override', 'payout.record', 'cash.plan', 'cash.setOpening',
    'agent.view', 'agent.manage', 'customer.manage', 'branch.view', 'report.view', 'report.export',
    'data.import',
  ]),
  /**
   * The counter runs the whole register.
   *
   * Adding rows, importing the day's sheet, exporting it and removing junk rows are all the same
   * desk's work, so `case.create`, `data.import` and `case.cancel` sit here alongside
   * `payout.record`. `agent.view` and `report.export` put the Agents, Branches and Reports
   * screens on the sidebar — the nav gates Reports on `report.export`, not `report.view`.
   *
   * Two things are held back on purpose. `case.approve`, so that approving a case and handing
   * over its cash are never the same pair of hands — it is the only maker-checker control in the
   * money path. And `audit.view`, so the record of what a cashier did stays outside their reach.
   */
  CASHIER: new Set<Permission>([
    'case.view', 'case.create', 'case.cancel', 'schedule.preview', 'schedule.override',
    'schedule.reschedule', 'payout.record', 'cash.plan', 'cash.setOpening', 'agent.view',
    'branch.view', 'report.view', 'report.export', 'data.import',
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
  return ROLE_PERMISSIONS[activeRole(role)].has(permission);
}

/**
 * Roles that may read the Register but never type into it.
 *
 * AUDITOR is read-only everywhere. AGENT is not — an agent still originates and submits maturity
 * forms through `/maturities/new`, which is their whole job. What an agent may not do is edit the
 * branch's sheet: the Register is the branch's book, and an agent's reach into it stops at reading.
 *
 * This has to be an explicit list rather than a consequence of the permission set. AGENT holds
 * `case.create` and `case.edit` for the form workflow, so deriving the answer from permissions
 * alone put agents straight back into the sheet — which is exactly how they could add blank rows.
 */
const REGISTER_READ_ONLY_ROLES: ReadonlySet<Role> = new Set<Role>(['AUDITOR', 'AGENT']);

/** Who may type register cells from A/c through Online. Auditor and Agent stay read-only. */
export function canTypeRegister(role: Role): boolean {
  if (REGISTER_READ_ONLY_ROLES.has(role)) return false;
  return (
    roleCan(role, 'case.edit') ||
    roleCan(role, 'payout.record') ||
    roleCan(role, 'case.create') ||
    roleCan(role, 'schedule.override') ||
    roleCan(role, 'data.import')
  );
}

/**
 * The guard every *Register* mutation starts with, alongside its usual `assertCan`.
 *
 * `assertCan` alone is not enough here: an agent holds `case.create` and `case.submit`, and with
 * a write scope of OWN those still pass for rows in their own branch. Adding a blank row and
 * ticking "form submitted" are register edits whatever permission they happen to travel under.
 */
export function assertCanTypeRegister(actor: Actor): void {
  if (canTypeRegister(actor.role)) return;
  throw new ForbiddenError(
    'case.edit',
    REGISTER_READ_ONLY_ROLES.has(actor.role) ? 'READ_ONLY_ROLE' : 'NO_PERMISSION',
    `${ROLE_LABEL[activeRole(actor.role)]} accounts can read the register but not change it.`,
  );
}

/**
 * Is this resource inside the actor's data scope?
 *
 * Which scope applies depends on what is being attempted: a write permission is measured against
 * ROLE_WRITE_SCOPE, everything else against the wider ROLE_SCOPE. Callers that omit `permission`
 * get the read scope, which is the safe default for a question about visibility.
 */
export function inScope(actor: Actor, resource: ResourceRef = {}, permission?: Permission): boolean {
  const scope =
    permission !== undefined && WRITE_PERMISSIONS.has(permission)
      ? ROLE_WRITE_SCOPE[activeRole(actor.role)]
      : ROLE_SCOPE[activeRole(actor.role)];

  switch (scope) {
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
  return roleCan(actor.role, permission) && inScope(actor, resource, permission);
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
      `${ROLE_LABEL[activeRole(actor.role)]} is not allowed to perform this action.`,
    );
  }
  if (!inScope(actor, resource, permission)) {
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
