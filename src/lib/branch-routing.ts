export const ALL_BRANCHES = '__ALL_BRANCHES__';

/** Query value for the compiled HQ view. Not a branch id. */
export const COMPILED_BRANCH = 'all';

/** Head-office / non-paying codes stay off the working picker. */
export function workingBranches<T extends { id: string; code: string }>(branches: readonly T[]): T[] {
  const paying = branches.filter((branch) => branch.code !== 'HO');
  return paying.length > 0 ? paying : [...branches];
}

/**
 * Which branch's book HQ is working in.
 *
 * Admin/CMD/CEO can open any created branch as its own register. `branch=all` is the compiled
 * view (read). With no query, we land on a real branch so typing never silently hits Azamgarh.
 */
export function pickWorkingBranch(
  branches: readonly { id: string; code: string }[],
  opts: { requested?: string | null; sessionBranchId: string | null; hq: boolean },
): { branchId: string | null; compiled: boolean } {
  const list = workingBranches(branches);
  if (!opts.hq) {
    const id =
      opts.sessionBranchId && list.some((branch) => branch.id === opts.sessionBranchId)
        ? opts.sessionBranchId
        : list[0]?.id ?? null;
    return { branchId: id, compiled: false };
  }
  if (opts.requested === COMPILED_BRANCH) return { branchId: null, compiled: true };
  if (opts.requested && list.some((branch) => branch.id === opts.requested)) {
    return { branchId: opts.requested, compiled: false };
  }
  if (opts.sessionBranchId && list.some((branch) => branch.id === opts.sessionBranchId)) {
    return { branchId: opts.sessionBranchId, compiled: false };
  }
  return { branchId: list[0]?.id ?? null, compiled: list.length === 0 };
}

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
