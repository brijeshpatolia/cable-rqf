import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests — the app in a real browser, against a real database.
 *
 * The unit suite proves the engine and the DB suite proves the store. What
 * neither can prove is that an engineer can sit down, sign in, paste an
 * enquiry and walk out with a quote — the path every other test exists to
 * protect. That is what lives under `tests/e2e`, and it runs against the
 * production build rather than the dev server, because a server component
 * that serialises in development and fails in production is exactly the kind
 * of thing that would otherwise reach Vercel first.
 *
 * Needs the same `.env` the DB suite needs: a migrated, seeded Postgres. Run
 * with `pnpm test:e2e`.
 *
 * `PLAYWRIGHT_CHROMIUM` points at a browser already on the machine, for
 * environments that carry one and cannot download another. Unset, Playwright
 * uses the Chromium it installed itself.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 3100);
const executablePath = process.env['PLAYWRIGHT_CHROMIUM'];

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI'] ? 'github' : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/sign-in`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
