/**
 * Profile field rules — pure, so the form and the server action share one definition.
 */

const USERNAME_RE = /^[a-z][a-z0-9._-]*$/;
const RESERVED_USERNAMES = new Set([
  'me',
  'new',
  'system',
  'null',
  'undefined',
  'root',
  'administrator',
  'support',
  'noreply',
]);

export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function parseUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; error: string } {
  const u = normaliseUsername(raw);
  if (u.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
  if (u.length > 32) return { ok: false, error: 'Username cannot be longer than 32 characters.' };
  if (!USERNAME_RE.test(u)) {
    return {
      ok: false,
      error: 'Start with a letter. Use only letters, numbers, dots, hyphens and underscores.',
    };
  }
  if (/[._-]{2,}/.test(u)) return { ok: false, error: 'Do not put two separators in a row.' };
  if (/[._-]$/.test(u)) return { ok: false, error: 'Username cannot end with a separator.' };
  if (RESERVED_USERNAMES.has(u)) return { ok: false, error: 'That username is reserved.' };
  return { ok: true, username: u };
}

/** 10-digit Indian mobile, stored as digits only. Empty is allowed. */
export function parsePhone(
  raw: string,
): { ok: true; phone: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, phone: null };
  const digits = s.replace(/\D/g, '');
  let ten = digits;
  if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
  if (ten.length !== 10 || !/^[6-9]/.test(ten)) {
    return { ok: false, error: 'Enter a 10-digit Indian mobile number.' };
  }
  return { ok: true, phone: ten };
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  if (phone.length === 10) return `${phone.slice(0, 5)} ${phone.slice(5)}`;
  return phone;
}

export function parseDisplayName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Enter a name.' };
  if (name.length > 80) return { ok: false, error: 'Name is too long.' };
  return { ok: true, name };
}

export function parseEmployeeCode(
  raw: string,
): { ok: true; employeeCode: string | null } | { ok: false; error: string } {
  const s = raw.trim().toUpperCase();
  if (!s) return { ok: true, employeeCode: null };
  if (s.length > 24) return { ok: false, error: 'Employee code is too long.' };
  if (!/^[A-Z0-9._-]+$/.test(s)) {
    return { ok: false, error: 'Employee code: letters, numbers, dots, hyphens, underscores.' };
  }
  return { ok: true, employeeCode: s };
}
