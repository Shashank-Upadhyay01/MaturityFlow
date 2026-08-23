/**
 * env.ts — fail fast, at boot, on a misconfigured deployment.
 * A bank system that starts with a missing secret is worse than one that refuses to start.
 */
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters — generate one with `openssl rand -base64 48`'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  /** Where uploaded maturity forms / KYC documents are written. */
  STORAGE_ROOT: z.string().default('./storage'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Public URL the app is reached on. Also decides whether session cookies are Secure. */
  APP_URL: z.string().default('http://localhost:3000'),
  /**
   * Force the session cookie's Secure flag on or off.
   *
   * Defaults to whether APP_URL is https. A branch server reached over plain HTTP on the
   * LAN MUST have this false, or nobody can sign in — a Secure cookie is silently dropped
   * over http. Set it to true the moment TLS is in front of the app.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Should the session cookie carry the Secure flag in this deployment? */
export function cookieSecure(): boolean {
  const e = env();
  return e.COOKIE_SECURE ?? e.APP_URL.startsWith('https://');
}

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}
