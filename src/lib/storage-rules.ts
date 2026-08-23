/**
 * storage-rules.ts — the pure, testable half of document storage.
 *
 * Kept free of `server-only` and of any filesystem import so the path-traversal defence
 * and the upload rules can be unit-tested directly. `storage.ts` does the I/O and imports
 * these; nothing here touches disk.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

/** Only formats a branch actually scans or photographs. No executables, no archives, no SVG. */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/tiff': 'tif',
};

/** Profile photos — images a browser can display. No SVG (can carry script). */
export const AVATAR_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type UploadRejection =
  | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'BAD_TYPE'; message: string }
  | { ok: true; extension: string };

export function checkUpload(size: number, mimeType: string): UploadRejection {
  if (size <= 0) return { ok: false, code: 'EMPTY', message: 'That file is empty.' };
  if (size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `That file is ${(size / 1_048_576).toFixed(1)} MB. The limit is 10 MB — scan at a lower resolution.`,
    };
  }
  const extension = ALLOWED_MIME_TYPES[mimeType];
  if (!extension) {
    return {
      ok: false,
      code: 'BAD_TYPE',
      message: 'Only PDF and image files (JPG, PNG, WEBP, HEIC, TIFF) can be attached.',
    };
  }
  return { ok: true, extension };
}

export function checkAvatarUpload(size: number, mimeType: string): UploadRejection {
  if (size <= 0) return { ok: false, code: 'EMPTY', message: 'That file is empty.' };
  if (size > MAX_AVATAR_BYTES) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `That photo is ${(size / 1_048_576).toFixed(1)} MB. Keep it under 2 MB.`,
    };
  }
  const extension = AVATAR_MIME_TYPES[mimeType];
  if (!extension) {
    return {
      ok: false,
      code: 'BAD_TYPE',
      message: 'Use a JPG, PNG or WEBP photo.',
    };
  }
  return { ok: true, extension };
}

/**
 * Is `resolved` genuinely inside `base`?
 *
 * The naive `resolved.startsWith(base)` is wrong: `/data/storage-evil` starts with
 * `/data/storage`. The separator check is what makes this correct.
 */
export function isInsideRoot(base: string, resolved: string, sep = '/'): boolean {
  if (resolved === base) return true;
  return resolved.startsWith(base.endsWith(sep) ? base : base + sep);
}

/**
 * A browser-supplied filename, made safe to echo back in a Content-Disposition header.
 *
 * The filename is never used to build a path (storage keys are generated server-side), so
 * this is about header integrity and legibility rather than traversal. Even so it strips
 * `..` outright: a name that still reads `.._.._etc_passwd` looks alarming in a download
 * dialog and invites someone to reuse it as a path later.
 */
export function safeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[\r\n"\\]/g, '') // header injection
    .replace(/\.{2,}/g, '.') // collapse .. so no traversal-looking run survives
    .replace(/[^\w.\- ]+/g, '_') // anything else exotic becomes _
    .replace(/_{2,}/g, '_') // tidy runs of underscores
    .replace(/^[._\-\s]+/, '') // no leading dot / underscore / dash
    .replace(/[._\-\s]+$/, '') // nor trailing
    .slice(0, 120)
    .trim();

  // If nothing meaningful survived — "///", "...", "____" — fall back rather than
  // hand back a one-character name.
  return /[A-Za-z0-9]/.test(cleaned) ? cleaned : 'document';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
