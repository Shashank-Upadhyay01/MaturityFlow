/**
 * Password rules only — deliberately free of any bcrypt import so this module can be
 * pulled into a Client Component without dragging a crypto library into the browser bundle.
 */

export interface PasswordCheck {
  ok: boolean;
  problems: string[];
}

export const PASSWORD_RULES: { label: string; test: (pw: string) => boolean }[] = [
  { label: 'At least 10 characters', test: (pw) => pw.length >= 10 },
  { label: 'A lowercase letter', test: (pw) => /[a-z]/.test(pw) },
  { label: 'An uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'A number', test: (pw) => /\d/.test(pw) },
  {
    label: 'Not a predictable word',
    test: (pw) => !/^(?:password|admin|welcome|maturity|123456)/i.test(pw),
  },
];

export function checkPasswordStrength(pw: string): PasswordCheck {
  const problems = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.label);
  return { ok: problems.length === 0, problems };
}
