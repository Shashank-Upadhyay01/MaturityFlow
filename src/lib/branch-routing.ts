export const ALL_BRANCHES = '__ALL_BRANCHES__';

/** Query value for the compiled HQ view. Not a branch id. */
export const COMPILED_BRANCH = 'all';

function branchNameOf(branch: { code: string; name?: string }): string {
  return typeof branch.name === 'string' ? branch.name : branch.code;
}

/** Head-office / non-paying codes stay off the working picker. Azamgarh stays first. */
export function workingBranches<T extends { id: string; code: string; name?: string }>(
  branches: readonly T[],
): T[] {
  const paying = branches.filter((branch) => branch.code !== 'HO');
  const list = paying.length > 0 ? [...paying] : [...branches];
  list.sort((a, b) => {
    const aHead = isAzamgarhHeadBranch({ code: a.code, name: branchNameOf(a) });
    const bHead = isAzamgarhHeadBranch({ code: b.code, name: branchNameOf(b) });
    if (aHead !== bHead) return aHead ? -1 : 1;
    return a.code.localeCompare(b.code, 'en');
  });
  return list;
}

/**
 * Which branch's book HQ is working in.
 *
 * Admin/CMD/CEO can open any created branch as its own register. With no `?branch=`, HQ lands
 * on the compiled bank so existing rows stay visible. Typing still requires picking one branch
 * — the mixed view is read-only, so new rows cannot silently land on Azamgarh.
 */
export function pickWorkingBranch(
  branches: readonly { id: string; code: string; name?: string }[],
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
  if (opts.requested === COMPILED_BRANCH || !opts.requested) {
    return { branchId: null, compiled: true };
  }
  if (list.some((branch) => branch.id === opts.requested)) {
    return { branchId: opts.requested, compiled: false };
  }
  return { branchId: null, compiled: true };
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
