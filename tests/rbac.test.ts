import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  activeRole,
  ASSIGNABLE_ROLES,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ForbiddenError,
  ROLE_SCOPE,
  ROLE_WRITE_SCOPE,
  type Actor,
  type Permission,
  assertCan,
  assertCanTypeRegister,
  can,
  canTypeRegister,
  permissionsOf,
  roleCan,
} from '../src/lib/rbac';

/** Read off the table itself, so a role added later is covered here without anyone remembering. */
const EVERY_ROLE = Object.keys(ROLE_SCOPE) as (keyof typeof ROLE_SCOPE)[];

const cmd: Actor = { id: 'u1', role: 'CMD', branchId: null, agentId: null, name: 'CMD' };
const mgr: Actor = { id: 'u3', role: 'BRANCH_MANAGER', branchId: 'b1', agentId: null, name: 'Mgr' };
const cashier: Actor = { id: 'u4', role: 'CASHIER', branchId: 'b1', agentId: null, name: 'Cash' };
const agent: Actor = { id: 'u5', role: 'AGENT', branchId: 'b1', agentId: 'a1', name: 'Agent' };
const auditor: Actor = { id: 'u6', role: 'AUDITOR', branchId: null, agentId: null, name: 'Audit' };

describe('permission grants', () => {
  it('CMD and CEO hold every operational permission, but not structure edits', () => {
    for (const p of ALL_PERMISSIONS) {
      if (p === 'branch.manage' || p === 'user.manage' || p === 'holiday.manage' || p === 'settings.manage') {
        expect(roleCan('CMD', p)).toBe(false);
        expect(roleCan('CEO', p)).toBe(false);
        continue;
      }
      expect(roleCan('CMD', p)).toBe(true);
      expect(roleCan('CEO', p)).toBe(true);
    }
  });

  it('only Admin may add branches, users, holidays or org settings', () => {
    for (const p of ['branch.manage', 'user.manage', 'holiday.manage', 'settings.manage'] as const) {
      expect(roleCan('ADMIN', p)).toBe(true);
      for (const r of ['CMD', 'CEO', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
        expect(roleCan(r, p)).toBe(false);
      }
    }
  });

  it('only CMD, CEO and Admin may edit an already-approved case', () => {
    const allowed = (['CMD', 'CEO', 'ADMIN'] as const);
    for (const r of ['BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
      expect(roleCan(r, 'case.editApproved')).toBe(false);
    }
    for (const r of allowed) expect(roleCan(r, 'case.editApproved')).toBe(true);
  });

  it('only CMD, CEO, Ops Head and Admin may approve', () => {
    for (const r of ['CMD', 'CEO', 'ADMIN'] as const) {
      expect(roleCan(r, 'case.approve')).toBe(true);
    }
    for (const r of ['BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
      expect(roleCan(r, 'case.approve')).toBe(false);
    }
  });

  it('the roles that can add register rows can also remove them', () => {
    // Removing a register row is a cancellation. Anyone who can create a hundred blank rows in
    // one click must be able to take them back, or the sheet fills with junk nobody can clear.
    for (const r of ['ADMIN', 'BRANCH_MANAGER', 'CMD', 'CEO', 'CASHIER'] as const) {
      expect(roleCan(r, 'case.create')).toBe(true);
      expect(roleCan(r, 'case.cancel')).toBe(true);
    }
    // The read-only roles hold neither half of the pair.
    expect(roleCan('AUDITOR', 'case.cancel')).toBe(false);
    expect(roleCan('AGENT', 'case.cancel')).toBe(false);
  });

  it('a cashier runs the whole register except approving', () => {
    // The counter is one desk: the person adding rows, importing the day's sheet and paying it
    // out is the same person. Approval is the one thing held back, so that approving a case and
    // handing over its cash are never the same pair of hands.
    for (const p of ['case.create', 'data.import', 'case.cancel', 'payout.record', 'report.export'] as const) {
      expect(roleCan('CASHIER', p)).toBe(true);
    }
    expect(roleCan('CASHIER', 'case.approve')).toBe(false);
    expect(roleCan('CASHIER', 'payout.reverse')).toBe(false);
  });

  it('a branch manager cannot remove a row from another branch', () => {
    expect(can(mgr, 'case.cancel', { branchId: 'b1' })).toBe(true);
    expect(can(mgr, 'case.cancel', { branchId: 'b2' })).toBe(false);
    expect(() => assertCan(mgr, 'case.cancel', { branchId: 'b2' })).toThrow(ForbiddenError);
  });

  it('an agent cannot approve their own submission', () => {
    expect(() => assertCan(agent, 'case.approve', { branchId: 'b1', agentId: 'a1' })).toThrow(
      ForbiddenError,
    );
  });

  it('staff may type the register; auditor and agent may not', () => {
    expect(canTypeRegister('CASHIER')).toBe(true);
    expect(canTypeRegister('ADMIN')).toBe(true);
    expect(canTypeRegister('BRANCH_MANAGER')).toBe(true);
    expect(canTypeRegister('CMD')).toBe(true);
    expect(canTypeRegister('CEO')).toBe(true);
    expect(canTypeRegister('AGENT')).toBe(false);
    expect(canTypeRegister('AUDITOR')).toBe(false);
  });

  it('an agent still originates and submits their own maturity forms', () => {
    // Read-only means read-only *in the register*. The form workflow is the agent's whole job.
    expect(roleCan('AGENT', 'case.create')).toBe(true);
    expect(roleCan('AGENT', 'case.submit')).toBe(true);
    expect(roleCan('AGENT', 'case.edit')).toBe(true);
    expect(roleCan('AGENT', 'customer.manage')).toBe(true);
  });

  it('assertCanTypeRegister blocks the register-only read roles by name', () => {
    for (const r of ['AGENT', 'AUDITOR'] as const) {
      const a: Actor = { id: 'x', role: r, branchId: 'b1', agentId: 'a1', name: r };
      expect(() => assertCanTypeRegister(a)).toThrow(ForbiddenError);
    }
    expect(() => assertCanTypeRegister(cashier)).not.toThrow();
    expect(() => assertCanTypeRegister(mgr)).not.toThrow();
  });

  it('a cashier may record payouts and tweak the daily plan, but not approve or manage users', () => {
    expect(roleCan('CASHIER', 'payout.record')).toBe(true);
    expect(roleCan('CASHIER', 'schedule.override')).toBe(true);
    expect(roleCan('CASHIER', 'schedule.reschedule')).toBe(true);
    expect(roleCan('CASHIER', 'case.approve')).toBe(false);
    expect(roleCan('CASHIER', 'user.manage')).toBe(false);
    expect(roleCan('CASHIER', 'payout.reverse')).toBe(false);
  });

  it('a cashier can open the agent and report screens, but not the audit log', () => {
    expect(roleCan('CASHIER', 'agent.view')).toBe(true);
    expect(roleCan('CASHIER', 'report.export')).toBe(true);
    expect(roleCan('CASHIER', 'report.view')).toBe(true);
    expect(roleCan('CASHIER', 'branch.view')).toBe(true);
    expect(roleCan('CASHIER', 'audit.view')).toBe(false);
  });

  it('the admin holds every permission there is', () => {
    // The account that has to be able to do anything any other role can. Asserted against the
    // full list rather than a sample, so a permission added later is covered without anyone
    // remembering to come back here.
    for (const p of ALL_PERMISSIONS) {
      expect(roleCan('ADMIN', p)).toBe(true);
    }
    expect(permissionsOf('ADMIN')).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('no other role can do something the admin cannot', () => {
    const admin = new Set(permissionsOf('ADMIN'));
    for (const r of EVERY_ROLE) {
      for (const p of permissionsOf(r)) {
        expect(admin.has(p)).toBe(true);
      }
    }
  });
});

describe('the auditor is structurally read-only', () => {
  const writes: Permission[] = [
    'case.create', 'case.submit', 'case.edit', 'case.approve', 'case.reject', 'case.cancel',
    'schedule.override', 'schedule.reschedule', 'payout.record', 'payout.reverse',
    'cash.setOpening', 'agent.manage', 'customer.manage', 'branch.manage', 'user.manage',
    'holiday.manage', 'settings.manage', 'case.editApproved', 'data.import',
  ];

  it('holds no write permission at all', () => {
    for (const p of writes) {
      expect(roleCan('AUDITOR', p)).toBe(false);
      expect(() => assertCan(auditor, p)).toThrow(ForbiddenError);
    }
  });

  it('can still read everything it needs for an inspection', () => {
    for (const p of ['case.view', 'audit.view', 'report.view', 'report.export'] as const) {
      expect(can(auditor, p)).toBe(true);
    }
  });

  it('reports READ_ONLY_ROLE as the reason, not NO_PERMISSION', () => {
    try {
      assertCan(auditor, 'payout.record');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ForbiddenError).reason).toBe('READ_ONLY_ROLE');
    }
  });
});

describe('data scoping', () => {
  it('every role reads the whole bank', () => {
    for (const r of EVERY_ROLE) expect(ROLE_SCOPE[r]).toBe('ALL');
  });

  it('reading is unrestricted; writing is not', () => {
    // The whole point of the split: the same actor, the same foreign branch, two answers.
    expect(can(mgr, 'case.view', { branchId: 'b2' })).toBe(true);
    expect(can(mgr, 'case.cancel', { branchId: 'b2' })).toBe(false);

    expect(can(cashier, 'case.view', { branchId: 'b2' })).toBe(true);
    expect(can(cashier, 'payout.record', { branchId: 'b2' })).toBe(false);

    expect(can(agent, 'case.view', { agentId: 'a2' })).toBe(true);
    expect(can(agent, 'case.submit', { agentId: 'a2' })).toBe(false);
  });

  it('write scope stays where it was before the register was opened up', () => {
    expect(ROLE_WRITE_SCOPE.BRANCH_MANAGER).toBe('BRANCH');
    expect(ROLE_WRITE_SCOPE.CASHIER).toBe('BRANCH');
    expect(ROLE_WRITE_SCOPE.AGENT).toBe('OWN');
    for (const r of ['CMD', 'CEO', 'ADMIN'] as const) {
      expect(ROLE_WRITE_SCOPE[r]).toBe('ALL');
    }
  });

  it('no role may write further than it may read', () => {
    const rank: Record<string, number> = { OWN: 0, BRANCH: 1, ALL: 2 };
    for (const r of EVERY_ROLE) {
      expect(rank[ROLE_WRITE_SCOPE[r]]).toBeLessThanOrEqual(rank[ROLE_SCOPE[r]]);
    }
  });

  it('an agent cannot write to another agent’s case, however it is reached', () => {
    // Seeing every case must not become touching every case: these are the two non-register
    // write paths an agent holds a permission for (documents.ts and cases.ts submit).
    for (const p of ['case.edit', 'case.submit', 'customer.manage'] as const) {
      expect(() => assertCan(agent, p, { branchId: 'b2', agentId: 'a2' })).toThrow(ForbiddenError);
    }
    expect(() => assertCan(agent, 'case.submit', { branchId: 'b1', agentId: 'a1' })).not.toThrow();
  });

  it('head-office roles reach every branch', () => {
    for (const a of [cmd, auditor]) {
      expect(can(a, 'case.view', { branchId: 'anything' })).toBe(true);
    }
  });

  it('throws OUT_OF_SCOPE with a useful reason', () => {
    try {
      assertCan(cashier, 'payout.record', { branchId: 'b2' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as ForbiddenError).reason).toBe('OUT_OF_SCOPE');
    }
  });
});

describe('permissionsOf', () => {
  it('never returns a write permission for an auditor', () => {
    const list = permissionsOf('AUDITOR');
    expect(list).not.toContain('payout.record');
    expect(list).toContain('audit.view');
  });
  it('returns operational permissions for CMD, not structure edits', () => {
    const list = permissionsOf('CMD');
    expect(list).not.toContain('branch.manage');
    expect(list).not.toContain('user.manage');
    expect(list).toContain('case.approve');
    expect(list).toContain('payout.record');
    expect(list.length).toBe(ALL_PERMISSIONS.length - 4);
  });
});

describe('OPS_HEAD is retired', () => {
  it('is not assignable', () => {
    expect(ASSIGNABLE_ROLES).not.toContain('OPS_HEAD');
  });

  it('appears in none of the role tables', () => {
    for (const table of [ROLE_SCOPE, ROLE_WRITE_SCOPE, ROLE_LABEL, ROLE_PERMISSIONS]) {
      expect(Object.keys(table)).not.toContain('OPS_HEAD');
    }
  });

  it('leaves every other role exactly as it was', () => {
    expect([...ASSIGNABLE_ROLES].sort()).toEqual(
      ['ADMIN', 'AGENT', 'AUDITOR', 'BRANCH_MANAGER', 'CASHIER', 'CEO', 'CMD'],
    );
  });

  it('still holds nobody above Admin', () => {
    // The existing invariant, restated against the narrowed table: Admin has everything,
    // and no other role holds a permission Admin lacks.
    for (const role of ASSIGNABLE_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(ROLE_PERMISSIONS.ADMIN.has(p)).toBe(true);
      }
    }
  });

  it('a legacy row still resolves, as the Admin it was migrated to', () => {
    // Old audit and user rows can still say OPS_HEAD; nothing may crash on reading one.
    expect(activeRole('OPS_HEAD')).toBe('ADMIN');
    expect(activeRole('CASHIER')).toBe('CASHIER');
    expect(roleCan('OPS_HEAD', 'payout.record')).toBe(true);
  });
});
