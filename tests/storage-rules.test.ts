import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_TYPES,
  MAX_AVATAR_BYTES,
  MAX_DOCUMENT_BYTES,
  checkAvatarUpload,
  checkUpload,
  formatBytes,
  isInsideRoot,
  safeDownloadName,
} from '../src/lib/storage-rules';

describe('upload rules', () => {
  it('accepts the formats a branch actually scans', () => {
    for (const mime of Object.keys(ALLOWED_MIME_TYPES)) {
      const r = checkUpload(1024, mime);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.extension).toBe(ALLOWED_MIME_TYPES[mime]);
    }
  });

  it('refuses anything executable or scriptable', () => {
    for (const mime of [
      'application/x-msdownload',
      'application/zip',
      'image/svg+xml', // SVG can carry script — deliberately excluded
      'text/html',
      'application/octet-stream',
      '',
    ]) {
      expect(checkUpload(1024, mime)).toMatchObject({ ok: false, code: 'BAD_TYPE' });
    }
  });

  it('refuses an empty file', () => {
    expect(checkUpload(0, 'application/pdf')).toMatchObject({ ok: false, code: 'EMPTY' });
  });

  it('enforces the 10 MB ceiling exactly', () => {
    expect(checkUpload(MAX_DOCUMENT_BYTES, 'application/pdf').ok).toBe(true);
    expect(checkUpload(MAX_DOCUMENT_BYTES + 1, 'application/pdf')).toMatchObject({
      ok: false,
      code: 'TOO_LARGE',
    });
  });
});

describe('avatar upload rules', () => {
  it('accepts a browser-displayable photo', () => {
    expect(checkAvatarUpload(80_000, 'image/jpeg')).toMatchObject({ ok: true, extension: 'jpg' });
    expect(checkAvatarUpload(80_000, 'image/png')).toMatchObject({ ok: true, extension: 'png' });
  });

  it('refuses SVG and PDF', () => {
    expect(checkAvatarUpload(100, 'image/svg+xml')).toMatchObject({ ok: false, code: 'BAD_TYPE' });
    expect(checkAvatarUpload(100, 'application/pdf')).toMatchObject({ ok: false, code: 'BAD_TYPE' });
  });

  it('enforces 2 MB', () => {
    expect(checkAvatarUpload(MAX_AVATAR_BYTES, 'image/jpeg').ok).toBe(true);
    expect(checkAvatarUpload(MAX_AVATAR_BYTES + 1, 'image/jpeg')).toMatchObject({
      ok: false,
      code: 'TOO_LARGE',
    });
  });
});

describe('isInsideRoot — path traversal defence', () => {
  const base = '/srv/maturityflow/storage';

  it('accepts paths genuinely inside the root', () => {
    expect(isInsideRoot(base, base)).toBe(true);
    expect(isInsideRoot(base, `${base}/cases/case_1/a.pdf`)).toBe(true);
  });

  it('rejects a sibling directory that merely shares the prefix', () => {
    // The bug a naive startsWith() check would let through.
    expect(isInsideRoot(base, '/srv/maturityflow/storage-evil/secrets.pdf')).toBe(false);
    expect(isInsideRoot(base, '/srv/maturityflow/storageX')).toBe(false);
  });

  it('rejects an escape above the root', () => {
    expect(isInsideRoot(base, '/srv/maturityflow/.env')).toBe(false);
    expect(isInsideRoot(base, '/etc/passwd')).toBe(false);
    expect(isInsideRoot(base, '/')).toBe(false);
  });

  it('handles a trailing separator on the root', () => {
    expect(isInsideRoot(`${base}/`, `${base}/cases/x.pdf`)).toBe(true);
    expect(isInsideRoot(`${base}/`, '/srv/maturityflow/storage-evil/x.pdf')).toBe(false);
  });

  it('works with Windows separators', () => {
    const win = 'C:\\app\\storage';
    expect(isInsideRoot(win, 'C:\\app\\storage\\cases\\a.pdf', '\\')).toBe(true);
    expect(isInsideRoot(win, 'C:\\app\\storage-evil\\a.pdf', '\\')).toBe(false);
  });
});

describe('safeDownloadName', () => {
  it('strips characters that would break or forge a header', () => {
    expect(safeDownloadName('form.pdf')).toBe('form.pdf');
    expect(safeDownloadName('my form (1).pdf')).toBe('my form _1_.pdf');
    expect(safeDownloadName('  spaced  .pdf ')).toBe('spaced  .pdf'); // inner spacing is the user's, kept as-is
    expect(safeDownloadName('a"b\\c.pdf')).toBe('abc.pdf');
    expect(safeDownloadName('evil\r\nContent-Type: text/html')).not.toMatch(/[\r\n]/);
  });

  it('neutralises traversal attempts in the filename', () => {
    for (const bad of ['../../etc/passwd', '....//x.pdf', '..\\..\\windows\\win.ini', '../.env']) {
      const out = safeDownloadName(bad);
      expect(out).not.toContain('..');
      expect(out.startsWith('.')).toBe(false);
      expect(out).not.toMatch(/[/\\]/);
    }
  });

  it('never returns an empty name', () => {
    expect(safeDownloadName('')).toBe('document');
    expect(safeDownloadName('///')).toBe('document');
    expect(safeDownloadName('...')).toBe('document');
  });

  it('caps absurdly long names', () => {
    expect(safeDownloadName('a'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
});

describe('formatBytes', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1_048_576)).toBe('5.0 MB');
  });
});
