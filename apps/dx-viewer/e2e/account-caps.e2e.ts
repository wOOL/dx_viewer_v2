import { test, expect } from '@playwright/test';

// The account contact fields persist to the user record. They were uncapped (no
// maxlength + only a trim on save), so a paste could bloat the row. Both the mobile
// input and the address textarea must now carry a maxlength (the browser-enforced cap;
// the matching capText backstop at the saveProfile choke point is unit-tested).
test('account contact fields are length-capped (mobile + address)', async ({ page }) => {
	await page.goto('/account');
	const mobile = page.getByLabel('Mobile', { exact: true });
	const address = page.getByLabel('Address', { exact: true });
	await expect(mobile).toBeVisible();
	await expect(address).toBeVisible();
	// Real caps wired (MAX_MOBILE_LENGTH = 32, MAX_ADDRESS_LENGTH = 300).
	await expect(mobile).toHaveAttribute('maxlength', '32');
	await expect(address).toHaveAttribute('maxlength', '300');
});
