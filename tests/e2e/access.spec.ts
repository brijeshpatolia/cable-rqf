import { expect, test } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import { signIn } from './helpers';

/**
 * Who may do what, checked from outside.
 *
 * The permission matrix is unit-tested; this is the door itself. Nothing
 * here should be reachable without signing in, and a viewer must not be
 * able to approve a quote however the button is pressed.
 */
test.describe('the door', () => {
  test('anonymous requests are sent to sign in, and remember where they were going', async ({
    page,
  }) => {
    await page.goto('/quotes');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fquotes$/);
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  });

  test('exports are not served to anyone who has not signed in', async ({ request }) => {
    // Not a document, not a 500: a redirect to the form, like any other page.
    const response = await request.get('/quotes/anything/xlsx', { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()['location']).toContain('/sign-in');
  });

  test('a wrong password is refused without saying which half was wrong', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel(/email/i).fill(ACCOUNTS.engineer.email);
    await page.getByLabel(/password/i).fill('not-the-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    // Filtered, because Next's route announcer is a second `role="alert"`.
    await expect(page.getByRole('alert').filter({ hasText: /do not match/ })).toHaveText(
      /That email and password do not match an active account/,
    );
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test('sign-in goes where the person was headed, and nowhere off this site', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.engineer, '/quotes');
    await expect(page).toHaveURL(/\/quotes$/);

    // An open redirect would begin on our own domain. It does not get to.
    await page.goto('/sign-in?next=https://example.com/');
    await page.getByLabel(/email/i).fill(ACCOUNTS.engineer.email);
    await page.getByLabel(/password/i).fill(ACCOUNTS.engineer.password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/rates$/);
  });

  test('a viewer can read a job but cannot approve it', async ({ page }) => {
    await signIn(page, ACCOUNTS.viewer, '/');
    await page.getByPlaceholder(/3C x 50mm2/).fill('3C x 50mm2 Cu XLPE SWA PVC 1kV — 500 m');
    await page.getByRole('button', { name: 'Price this enquiry' }).click();
    await page.waitForURL(/\/jobs\/[^/]+$/);

    const approve = page.getByRole('button', { name: /^Approve/ });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveText(/only an engineer may approve/);
  });

  test('signing out ends the session, not just the cookie', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.engineer);
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'cq_session' && c.value !== '');
    expect(session).toBeDefined();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);

    // Put the old token back. It names a session that has been ended, so it
    // is not a session any more.
    await context.addCookies([session!]);
    await page.goto('/rates');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
