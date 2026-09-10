'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requestMeta, requireActor } from '@/lib/auth/session';
import { purgeAzamgarhOperationalData } from '@/services/branch-operational-purge';

export async function purgeAzamgarhOperationalDataAction(formData: FormData): Promise<void> {
  const { session } = await requireActor();
  if (session.role !== 'ADMIN') throw new Error('Only an administrator can clear branch operational data.');
  if (formData.get('confirmation') !== 'WIPE AZM') {
    throw new Error('Type WIPE AZM exactly. Nothing was deleted.');
  }
  await purgeAzamgarhOperationalData(session, await requestMeta());
  revalidatePath('/', 'layout');
  redirect('/maturities?purged=AZM');
}
