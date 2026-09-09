import { expect, type Page } from '@playwright/test';
import type { Account } from './accounts';

/** Sign in through the form, the way a person does, and land where it sends you. */
export async function signIn(page: Page, account: Account, next?: string): Promise<void> {
  await page.goto(next === undefined ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel(/email/i).fill(account.email);
  await page.getByLabel(/password/i).fill(account.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}
