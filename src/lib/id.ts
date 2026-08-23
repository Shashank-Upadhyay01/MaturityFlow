import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijkmnpqrstuvwxyz'; // no l/o — unambiguous when read aloud

/** Short, sortable-ish, prefixed identifier. `newId('case') -> "case_m4k2f9x7q1z0"` */
export function newId(prefix: string, length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Human-facing case number: `BR01/2026/000123` */
export function formatCaseNumber(branchCode: string, year: number, seq: number): string {
  return `${branchCode}/${year}/${String(seq).padStart(6, '0')}`;
}
