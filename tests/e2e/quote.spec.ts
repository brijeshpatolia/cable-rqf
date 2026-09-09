import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS } from './accounts';
import { signIn } from './helpers';

/**
 * The critical path, end to end.
 *
 * An engineer signs in, pastes an enquiry, sees it priced, approves it, and
 * gets a quote a customer could be sent. Every step below is one an engineer
 * takes with a mouse; nothing is called directly. If this passes, the app
 * does the one thing it is for.
 *
 * The enquiry line is the one the paste box offers as its placeholder: a
 * 3-core 50 mm² copper XLPE SWA PVC 1 kV cable, which the seeded library
 * carries and which therefore prices without a hand to settle it.
 */
const ENQUIRY = '3C x 50mm2 Cu XLPE SWA PVC 1kV — 12,000 m';

test.describe('from enquiry to quote', () => {
  test('an engineer pastes an enquiry and walks out with a quote', async ({ page }) => {
    const customer = `E2E Customer ${Date.now()}`;

    await signIn(page, ACCOUNTS.engineer);

    // Sign-in with nowhere to go lands on the Inbox: paste and go.
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await page.getByPlaceholder(/3C x 50mm2/).fill(ENQUIRY);
    await page.getByPlaceholder(/^Customer/).fill(customer);
    await page.getByRole('button', { name: 'Price this enquiry' }).click();

    // A job, named after the customer, carrying a reference.
    await page.waitForURL(/\/jobs\/[^/]+$/);
    await expect(page.getByRole('heading', { name: customer })).toBeVisible();
    const reference = page.url().split('/jobs/')[1]!;
    expect(reference).not.toBe('');

    // The line priced itself off the library, so approval is open.
    const approve = page.getByRole('button', { name: 'Approve and quote' });
    await expect(approve).toBeEnabled();
    await approve.click();

    // A quote, with a number and a total.
    await page.waitForURL(/\/quotes\/[^/]+$/);
    const number = page.url().split('/quotes/')[1]!;
    expect(number).not.toBe('');
    await expect(page.getByText('Quote total')).toBeVisible();
    await expect(page.getByText(customer).first()).toBeVisible();

    // The job now points at its quote, and is closed.
    await page.goto(`/jobs/${reference}`);
    await expect(page.getByRole('link', { name: `→ ${number}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and quote' })).toHaveCount(0);

    // Both exports come back as the documents they claim to be.
    //
    // Fetched from inside the page rather than through Playwright's own
    // request client: the session cookie is `Secure` in a production build,
    // and only a browser treats 127.0.0.1 as a secure origin.
    const xlsx = await fetched(page, `/quotes/${number}/xlsx`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.type).toContain('spreadsheetml');
    expect(xlsx.size).toBeGreaterThan(1000);

    const pdf = await fetched(page, `/quotes/${number}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toContain('application/pdf');
    expect(pdf.head).toBe('%PDF-');

    // And the quote is on the list.
    await page.goto('/quotes');
    await expect(page.getByRole('link', { name: number }).first()).toBeVisible();
  });

  test('a line with no quantity is priced by nobody, and the job says why', async ({ page }) => {
    // The line the placeholder offers, with the length cut off. It matches
    // the library exactly and must still not come out as a price.
    await signIn(page, ACCOUNTS.engineer, '/');
    await page.getByPlaceholder(/3C x 50mm2/).fill('3C x 50mm2 Cu XLPE SWA PVC 1kV');
    await page.getByRole('button', { name: 'Price this enquiry' }).click();
    await page.waitForURL(/\/jobs\/[^/]+$/);

    await expect(page.getByText(/No quantity is stated on this line/)).toBeVisible();
    const approve = page.getByRole('button', { name: /^Approve/ });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveText(/still needs pricing/);
  });

  test('a blank enquiry is refused, and says so', async ({ page }) => {
    await signIn(page, ACCOUNTS.engineer, '/');
    // The textarea is `required`, so the browser stops an empty submit before
    // the server sees it — which is the behaviour, and worth pinning.
    const box = page.getByPlaceholder(/3C x 50mm2/);
    await page.getByRole('button', { name: 'Price this enquiry' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await box.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
  });
});

/** What the browser gets back from a document route, in the four figures worth checking. */
async function fetched(
  page: Page,
  path: string,
): Promise<{ status: number; type: string; size: number; head: string }> {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      type: response.headers.get('content-type') ?? '',
      size: bytes.length,
      head: String.fromCharCode(...bytes.subarray(0, 5)),
    };
  }, path);
}
