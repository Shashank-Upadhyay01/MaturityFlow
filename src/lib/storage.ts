import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '@/lib/env';
import { checkAvatarUpload, checkUpload, isInsideRoot } from '@/lib/storage-rules';

/**
 * Document storage.
 *
 * Files live outside the web root, under STORAGE_ROOT, and are only ever served through an
 * authenticated route that re-checks the caller's access to the parent case. The storage key
 * is generated here — a filename supplied by a browser is never used to build a path.
 */

export {
  ALLOWED_MIME_TYPES,
  AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  MAX_DOCUMENT_BYTES,
  safeDownloadName,
  formatBytes,
} from '@/lib/storage-rules';

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: 'TOO_LARGE' | 'BAD_TYPE' | 'EMPTY' | 'NOT_FOUND' | 'IO',
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

function root(): string {
  return path.resolve(process.cwd(), env().STORAGE_ROOT);
}

/** Absolute path for a storage key, with traversal defended at the boundary. */
export function resolveKey(storageKey: string): string {
  const base = root();
  const full = path.resolve(base, storageKey);
  if (!isInsideRoot(base, full, path.sep)) {
    throw new StorageError('Refusing to read outside the storage root', 'IO');
  }
  return full;
}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
}

/**
 * Persist an uploaded file against a case. The key is `cases/<caseId>/<random>.<ext>` —
 * derived entirely from server-side values, never from the client's filename.
 */
export async function storeCaseDocument(caseId: string, file: File): Promise<StoredFile> {
  const check = checkUpload(file.size, file.type);
  if (!check.ok) throw new StorageError(check.message, check.code);
  const ext = check.extension;

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const dir = path.join('cases', caseId);
  const storageKey = path.join(dir, `${randomBytes(16).toString('hex')}.${ext}`);
  const full = resolveKey(storageKey);

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { mode: 0o600 });

  return { storageKey, sizeBytes: bytes.byteLength, mimeType: file.type, sha256 };
}

export async function readCaseDocument(storageKey: string): Promise<Buffer> {
  const full = resolveKey(storageKey);
  try {
    await stat(full);
  } catch {
    throw new StorageError('That document is no longer on disk.', 'NOT_FOUND');
  }
  return readFile(full);
}

export async function storeAvatar(userId: string, file: File): Promise<StoredFile> {
  const check = checkAvatarUpload(file.size, file.type);
  if (!check.ok) throw new StorageError(check.message, check.code);
  const ext = check.extension;

  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const dir = path.join('avatars', userId);
  const storageKey = path.join(dir, `${randomBytes(16).toString('hex')}.${ext}`);
  const full = resolveKey(storageKey);

  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, bytes, { mode: 0o600 });

  return { storageKey, sizeBytes: bytes.byteLength, mimeType: file.type, sha256 };
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readCaseDocument(storageKey);
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  const full = resolveKey(storageKey);
  try {
    await unlink(full);
  } catch {
    // already gone
  }
}

