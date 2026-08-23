import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The 100k-case fuzz can run longer than Vitest's default worker RPC window.
process.env.VITEST_POOL_TIMEOUT ??= '180000';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests need a live database — see vitest.integration.config.ts
    exclude: ['tests/integration/**', 'node_modules/**'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
});
