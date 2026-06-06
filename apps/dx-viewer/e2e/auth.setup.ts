import { test as setup, expect } from '@playwright/test';

// Logs in the demo account through the real UI once, then persists the
// PocketBase session (localStorage `pocketbase_auth` + cookie) so every other
// test reuses it via storageState — no per-test login.
//
// Creds default to the seeded demo account (active subscription, populated FMX);
// override with E2E_EMAIL / E2E_PASSWORD.
// Credentials come from the environment so no account password is committed. For
// local runs, set E2E_PASSWORD (and optionally E2E_EMAIL) in your shell before the
// suite, e.g. `E2E_PASSWORD=… bunx playwright test`.
const EMAIL = process.env.E2E_EMAIL || 'demo@becertain.ai';
const PASSWORD = process.env.E2E_PASSWORD || '';

const authFile = 'e2e/.auth/state.json';

setup('authenticate', async ({ page }) => {
	if (!PASSWORD) {
		throw new Error(
			'Set the E2E_PASSWORD env var (and optionally E2E_EMAIL) to run the E2E suite.'
		);
	}
	await page.goto('/login');
	await page.locator('#email').fill(EMAIL);
	await page.locator('#password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();

	// On success the login page navigates to /studies. Wait for the URL AND a
	// real app-shell signal so a silent auth failure can't save an empty state.
	// Use the locale-independent sidebar testid (the heading text is now i18n'd).
	await page.waitForURL('**/studies', { timeout: 30_000 });
	await expect(page.getByTestId('sidebar')).toBeVisible();

	await page.context().storageState({ path: authFile });
});
