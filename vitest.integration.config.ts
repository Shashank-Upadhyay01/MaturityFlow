import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests. These need a REAL PostgreSQL (DATABASE_URL) and they write to it,
 * so they are kept out of `npm test` — that suite must stay pure, fast and runnable
 * with no infrastructure.
 *
 *   npm run test:db
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false, // they share one database
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
