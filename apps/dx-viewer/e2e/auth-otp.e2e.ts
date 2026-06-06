import { test, expect } from '@playwright/test';

// The OTP "Sign in with code" path. Catches a Svelte template-attr gotcha:
// `pattern="\d{6}"` in markup has `{6}` evaluated as a template expression →
// rendered HTML becomes `pattern="\d6"` and a real 6-digit code fails browser
// validity, so the form silently never submits and the user sees nothing.
test.describe('login OTP path', () => {
	test.use({ storageState: { cookies: [], origins: [] } }); // public route, no session

	test('code input has the literal "\\d{6}" pattern and accepts six digits', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: 'Sign in with email code' }).click();
		await page.getByRole('textbox', { name: 'Email' }).fill('demo@becertain.ai');
		await page.getByRole('button', { name: 'Send code' }).click();
		// OTP-verify form is now rendered; the code input must accept a 6-digit code.
		const code = page.locator('#code');
		await expect(code).toBeVisible();
		await expect(code).toHaveAttribute('pattern', '\\d{6}');
		await code.fill('000000');
		// The whole form (with the code filled in) must be HTML-valid; otherwise
		// the browser blocks the submit and the user never sees an error.
		const valid = await page.evaluate(() => document.querySelector('form')?.checkValidity());
		expect(valid).toBe(true);
	});
});
