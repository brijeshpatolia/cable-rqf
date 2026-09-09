/**
 * Who the browser tests are, one account per role they need.
 *
 * Addresses under `.test` cannot be delivered to (RFC 6761), so nothing these
 * tests do can reach a real inbox; the passwords are long enough to pass any
 * rule the sign-in form might one day grow, and are worth nothing outside a
 * database seeded for testing.
 */
export const ACCOUNTS = {
  engineer: {
    email: 'e2e-engineer@cable-rqf.test',
    name: 'E2E Engineer',
    role: 'engineer',
    password: 'browser-test-engineer-7f3a9c1e',
  },
  viewer: {
    email: 'e2e-viewer@cable-rqf.test',
    name: 'E2E Viewer',
    role: 'viewer',
    password: 'browser-test-viewer-2b8d4e6f',
  },
} as const;

export type Account = (typeof ACCOUNTS)[keyof typeof ACCOUNTS];
