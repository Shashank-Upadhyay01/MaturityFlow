import { describe, expect, it } from 'vitest';

import { isAzamgarhHeadBranch, resolveImportBranch } from '../src/lib/branch-routing';

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
