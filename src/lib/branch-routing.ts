export const ALL_BRANCHES = '__ALL_BRANCHES__';

export interface ImportBranch {
  id: string;
  code: string;
  name: string;
}

function normalise(value: string): string {
  return value.trim().toLocaleLowerCase('en-IN').replace(/[^a-z0-9]+/g, '');
}

/** Exact code/name routing only. Importing money into a guessed branch is never acceptable. */
export function resolveImportBranch(
  reference: string,
  branches: readonly ImportBranch[],
): ImportBranch | null {
  const key = normalise(reference);
  if (!key) return null;
  const matches = branches.filter(
    (branch) => normalise(branch.code) === key || normalise(branch.name) === key,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function isAzamgarhHeadBranch(branch: Pick<ImportBranch, 'code' | 'name'>): boolean {
  return normalise(branch.code) === 'azm' || normalise(branch.name) === 'azamgarh';
}
