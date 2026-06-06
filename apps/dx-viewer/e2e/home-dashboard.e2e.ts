import { test, expect } from '@playwright/test';

// The redesigned homepage (/studies): the X-ray drop/upload zone is the focal point,
// with Create-a-New-Patient + patient search alongside, Recent Analyses capped at 3
// (→ View All), and a small Metrics Dashboard. The full grid lives at /patients.
test.describe('home dashboard', () => {
	test('shows welcome, the X-ray dropzone, ≤3 recent analyses, and 3 metric cards', async ({
		page
	}) => {
		await page.goto('/studies');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();

		// Primary focal action.
		await expect(page.getByTestId('dash-dropzone')).toBeVisible();
		await expect(page.getByRole('button', { name: /Drop or Upload X-Rays/i })).toBeVisible();

		// Metrics dashboard — three stat cards.
		await expect(page.getByTestId('dash-metric-totalPatients')).toBeVisible();
		await expect(page.getByTestId('dash-metric-analysesThisWeek')).toBeVisible();
		await expect(page.getByTestId('dash-metric-totalAnalyses')).toBeVisible();

		// Recent Analyses is capped at 3 (the clinician's de-clutter requirement).
		await expect.poll(() => page.locator('a.recent-card').count()).toBeLessThanOrEqual(3);
	});

	test('"Create a New Patient" goes to the new-study flow', async ({ page }) => {
		await page.goto('/studies');
		await page.getByTestId('dash-create-patient').click();
		await expect(page).toHaveURL(/\/upload/);
	});

	test('"View All" opens the full patient list at /patients', async ({ page }) => {
		await page.goto('/studies');
		await page.getByTestId('dash-view-all').click();
		await expect(page).toHaveURL(/\/patients/);
	});

	test('patient search opens a quick-jump dropdown; "See all" carries the query to /patients', async ({
		page
	}) => {
		await page.goto('/studies');
		const search = page.getByTestId('dash-search');
		await search.click();
		await search.fill('a'); // a common letter — the dropdown renders regardless of matches
		await expect(page.getByTestId('dash-search-results')).toBeVisible();
		await page.getByRole('button', { name: /See all results/i }).click();
		await expect(page).toHaveURL(/\/patients\?q=a/);
	});
});
