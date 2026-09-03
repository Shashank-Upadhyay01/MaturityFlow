import { describe, expect, it } from 'vitest';

import {
  isAzamgarhHeadBranch,
  pickWorkingBranch,
  resolveImportBranch,
  workingBranches,
} from '../src/lib/branch-routing';

const branches = [
  { id: 'ahi', code: 'AHI', name: 'Ahiraula' },
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
    expect(isAzamgarhHeadBranch({ code: 'AZM', name: 'Azamgarh' })).toBe(true);
    expect(isAzamgarhHeadBranch({ code: 'AHI', name: 'Ahiraula' })).toBe(false);
  });
});

describe('HQ working branch', () => {
  it('lists Azamgarh first so an empty new branch is not the default pick', () => {
    expect(workingBranches(branches).map((branch) => branch.code)).toEqual(['AZM', 'AHI', 'MAU']);
  });

  it('lands Admin on Azamgarh so the sheet is writable and the live book is visible', () => {
    expect(pickWorkingBranch(branches, { hq: true, sessionBranchId: null })).toEqual({
      branchId: 'azm',
      compiled: false,
    });
  });

  it('keeps a home branch if HQ is assigned to one, without hiding Azamgarh as a pick', () => {
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: 'ahi' }),
    ).toEqual({ branchId: 'ahi', compiled: false });
  });

  it('opens the branch Admin asked for, including a new empty one', () => {
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: null, requested: 'mau' }).branchId,
    ).toBe('mau');
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: null, requested: 'ahi' }),
    ).toEqual({ branchId: 'ahi', compiled: false });
  });

  it('keeps an All-branches compiled view when asked', () => {
    expect(
      pickWorkingBranch(branches, { hq: true, sessionBranchId: null, requested: 'all' }),
    ).toEqual({ branchId: null, compiled: true });
  });

  it('pins a branch clerk to their assigned branch', () => {
    expect(
      pickWorkingBranch(branches, { hq: false, sessionBranchId: 'mau' }),
    ).toEqual({ branchId: 'mau', compiled: false });
  });
});
