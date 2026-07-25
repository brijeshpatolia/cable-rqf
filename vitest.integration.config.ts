import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Integration tests — these need a seeded Postgres.
 *
 * Kept out of `pnpm test` on purpose: the unit suite must stay database-free
 * and run in about a second, so it is never the thing someone skips.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/db/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
