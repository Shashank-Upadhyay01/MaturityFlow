import bcrypt from 'bcryptjs';

/** Cost 12 ≈ 250ms on commodity hardware — slow enough to matter, fast enough to log in. */
const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export { checkPasswordStrength, PASSWORD_RULES, type PasswordCheck } from './password-policy';
