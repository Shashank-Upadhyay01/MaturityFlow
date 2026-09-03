import { describe, expect, it } from 'vitest';

import {
  isAzamgarhHeadBranch,
  pickWorkingBranch,
  resolveImportBranch,
} from '../src/lib/branch-routing';

const branches = [
  { id: 'azm', code: 'AZM', name: 'Azamgarh' },
  { id: 'mau', code: 'MAU', name: 'Mau Branch' },
];

describe('compiled register branch routing', () => {
  it('matches exact branch codes without case or punctuation sensitivity', () => {
    expect(resolveImportBranch(' azm ', branches)?.id).toBe('azm');
    expect(resolveImportBranch('M-A-U', branches)?.id).toBe('mau');
  });

  it('accepts an exact branch name but never guesses an unknown branch', () => {
    expect(resolveImportBranch('Mau Branch', branches)?.id).toBe('mau');
    expect(resolveImportBranch('Mau City', branches)).toBeNull();
    expect(resolveImportBranch('', branches)).toBeNull();
  });

  it('recognises Azamgarh as the head branch', () => {
    expect(isAzamgarhHeadBranch(branches[0])).toBe(true);
    expect(isAzamgarhHeadBranch(branches[1])).toBe(false);
  });
});

describe('HQ working branch', () => {
  it('lands Admin on a real branch so typing is never a mixed sheet', () => {
    expect(pickWorkingBranch(branches, { hq: true, sessionBranchId: null }).branchId).toBe('azm');
    expect(pickWorkingBranch(branches, { hq: true, sessionBranchId: null }).compiled).toBe(false);
  });

  it('opens the branch Admin asked for, including a new one', () => {
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: null, requested: 'mau' }).branchId,
    ).toBe('mau');
  });

  it('keeps an All-branches compiled view when asked', () => {
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: null, requested: 'all' }),
    ).toEqual({ branchId: null, compiled: true });
  });
});
