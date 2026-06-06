import { test, expect } from '@playwright/test';
import { seedManyPatients } from './seed';

// The studies dashboard used to mount EVERY patient card at once — fine for a demo,
// but a real account with hundreds–thousands of patients would bog down / crash the
// tab. It now renders one page (24) at a time behind a pager. LOCAL-FIRST: seed 30
// patients (> 24) so a second page genuinely exists and we can drive it.
const card = 'a[href*="/patients/"]';

test('studies dashboard paginates the patient grid (caps the render + navigates)', async ({
	page
}) => {
	await seedManyPatients(page, 30);
	await page.goto('/patients');
	await expect(page.locator(card).first()).toBeVisible();

	// A pager appears only because the account exceeds one page.
	const pager = page.getByRole('navigation', { name: /pagination/i });
	await expect(pager).toBeVisible();
	await expect(page.getByText(/Page 1 of/)).toBeVisible();

	// Page 1 is capped — NOT all 34 cards mount at once.
	expect(await page.locator(card).count()).toBe(24);
	const firstOnPage1 = await page.locator(card).first().getAttribute('href');

	// Next → a different set of patients (proves it actually pages, not just relabels).
	await page.getByRole('button', { name: /next page/i }).click();
	await expect(page.getByText('Page 2 of 2')).toBeVisible();
	const firstOnPage2 = await page.locator(card).first().getAttribute('href');
	expect(firstOnPage2).not.toBe(firstOnPage1);
	expect(await page.locator(card).count()).toBeLessThan(24); // the remainder

	// Previous → back to the original first page.
	await page.getByRole('button', { name: /previous page/i }).click();
	await expect(page.getByText('Page 1 of 2')).toBeVisible();
	expect(await page.locator(card).first().getAttribute('href')).toBe(firstOnPage1);
});
