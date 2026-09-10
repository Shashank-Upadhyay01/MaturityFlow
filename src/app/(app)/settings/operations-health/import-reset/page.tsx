import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db';
import { branches } from '@/db/schema';
import { requestMeta, requireActor } from '@/lib/auth/session';
import { parseRegisterGrid } from '@/lib/excel-register';
import { activeRole, assertCan } from '@/lib/rbac';
import { importRegisterRows } from '@/services/import-service';

export const dynamic = 'force-dynamic';

async function importReset(formData: FormData) {
  'use server';
  const { session, actor } = await requireActor();
  if (activeRole(actor.role) !== 'ADMIN') throw new Error('Admin only');
  const [branch] = await db.select().from(branches)
    .where(and(eq(branches.code, 'AZM'), eq(branches.isActive, true))).limit(1);
  if (!branch) throw new Error('Azamgarh branch is unavailable');
  assertCan(actor, 'data.import', { branchId: branch.id });
  const grid = JSON.parse(String(formData.get('grid') ?? '[]')) as unknown[][];
  const parsed = parseRegisterGrid(grid);
  if (parsed.rows.length === 0 || parsed.errors.length > 0) {
    throw new Error(parsed.errors.join(' ') || 'No valid rows');
  }
  const result = await importRegisterRows(session, branch.id, parsed.rows, await requestMeta());
  if (result.errors.length > 0) throw new Error(result.errors.join(' '));
  redirect(`/maturities?imported=${result.created}&skipped=${result.skipped}`);
}

export default async function ImportResetPage() {
  const { actor } = await requireActor();
  if (activeRole(actor.role) !== 'ADMIN') redirect('/dashboard');
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold">Azamgarh reset import</h1>
      <form action={importReset} className="mt-5 space-y-3">
        <textarea name="grid" aria-label="Validated import rows" className="h-64 w-full border p-2 font-mono text-xs" required />
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">Import validated rows</button>
      </form>
    </main>
  );
}
