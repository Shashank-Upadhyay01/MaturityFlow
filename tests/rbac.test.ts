import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ForbiddenError,
  ROLE_SCOPE,
  type Actor,
  type Permission,
  assertCan,
  can,
  canTypeRegister,
  permissionsOf,
  roleCan,
} from '../src/lib/rbac';

const cmd: Actor = { id: 'u1', role: 'CMD', branchId: null, agentId: null, name: 'CMD' };
const ops: Actor = { id: 'u2', role: 'OPS_HEAD', branchId: null, agentId: null, name: 'Ops' };
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
      for (const r of ['CMD', 'CEO', 'OPS_HEAD', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
        expect(roleCan(r, p)).toBe(false);
      }
    }
  });

  it('only CMD and CEO may edit an already-approved case', () => {
    const allowed = (['CMD', 'CEO'] as const);
    for (const r of ['ADMIN', 'OPS_HEAD', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
      expect(roleCan(r, 'case.editApproved')).toBe(false);
    }
    for (const r of allowed) expect(roleCan(r, 'case.editApproved')).toBe(true);
  });

  it('only CMD, CEO and Ops Head may approve', () => {
    expect(roleCan('OPS_HEAD', 'case.approve')).toBe(true);
    expect(roleCan('CMD', 'case.approve')).toBe(true);
    expect(roleCan('CEO', 'case.approve')).toBe(true);
    for (const r of ['ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'AGENT', 'AUDITOR'] as const) {
      expect(roleCan(r, 'case.approve')).toBe(false);
    }
  });

  it('the roles that can add register rows can also remove them', () => {
    // Removing a register row is a cancellation. Anyone who can create a hundred blank rows in
    // one click must be able to take them back, or the sheet fills with junk nobody can clear.
    for (const r of ['ADMIN', 'BRANCH_MANAGER', 'OPS_HEAD', 'CMD', 'CEO'] as const) {
      expect(roleCan(r, 'case.create')).toBe(true);
      expect(roleCan(r, 'case.cancel')).toBe(true);
    }
    // A cashier records payouts; they do not get to make a row disappear.
    expect(roleCan('CASHIER', 'case.cancel')).toBe(false);
    expect(roleCan('AUDITOR', 'case.cancel')).toBe(false);
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

  it('staff may type the register; auditor may not', () => {
    expect(canTypeRegister('CASHIER')).toBe(true);
    expect(canTypeRegister('ADMIN')).toBe(true);
    expect(canTypeRegister('OPS_HEAD')).toBe(true);
    expect(canTypeRegister('AGENT')).toBe(true);
    expect(canTypeRegister('AUDITOR')).toBe(false);
  });

  it('a cashier may record payouts and tweak the daily plan, but not approve or manage users', () => {
    expect(roleCan('CASHIER', 'payout.record')).toBe(true);
    expect(roleCan('CASHIER', 'schedule.override')).toBe(true);
    expect(roleCan('CASHIER', 'schedule.reschedule')).toBe(true);
    expect(roleCan('CASHIER', 'case.approve')).toBe(false);
    expect(roleCan('CASHIER', 'user.manage')).toBe(false);
    expect(roleCan('CASHIER', 'payout.reverse')).toBe(false);
  });

  it('an admin administers and may re-plan days, but never approves or records money', () => {
    expect(roleCan('ADMIN', 'user.manage')).toBe(true);
    expect(roleCan('ADMIN', 'branch.manage')).toBe(true);
    expect(roleCan('ADMIN', 'schedule.override')).toBe(true);
    expect(roleCan('ADMIN', 'schedule.reschedule')).toBe(true);
    expect(roleCan('ADMIN', 'case.approve')).toBe(false);
    expect(roleCan('ADMIN', 'payout.record')).toBe(false);
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
  it('branch roles are confined to their own branch', () => {
    expect(ROLE_SCOPE.BRANCH_MANAGER).toBe('BRANCH');
    expect(can(mgr, 'case.view', { branchId: 'b1' })).toBe(true);
    expect(can(mgr, 'case.view', { branchId: 'b2' })).toBe(false);
    expect(can(cashier, 'payout.record', { branchId: 'b2' })).toBe(false);
  });

  it('agents are confined to their own cases', () => {
    expect(can(agent, 'case.view', { agentId: 'a1' })).toBe(true);
    expect(can(agent, 'case.view', { agentId: 'a2' })).toBe(false);
  });

  it('head-office roles reach every branch', () => {
    for (const a of [cmd, ops, auditor]) {
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
