import { test, expect } from '@playwright/test';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Smoke + studies-list regression. Validates the harness end-to-end: build+preview serves
// the app, the saved demo session is reused, and the patient list renders. LOCAL-FIRST:
// seed a patient into IndexedDB so the patient-cards assertion has data.
test.describe('auth + studies list', () => {
	test.beforeEach(async ({ page }) => {
		await seedXrayStudies(page, [
			{
				patient: 'seedauthpat0001',
				study: 'seedauthstd0001',
				patientName: 'Auth Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
	});
	test('reuses the demo session without bouncing to /login', async ({ page }) => {
		await page.goto('/studies');
		await expect(page).toHaveURL(/\/studies/);
		// Locale-independent app-shell signal (the heading text is now i18n'd).
		await expect(page.getByTestId('sidebar')).toBeVisible();
	});

	test('shell is decluttered: no placeholder nav links, studies bar leads with search', async ({
		page
	}) => {
		// The full patient list moved to /patients (the home dashboard is the focused
		// landing). Its top bar leads with the search box.
		await page.goto('/patients');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		// The upsell placeholders were removed from the left nav (only Dx Viewer was
		// ever wired; the logo links home now).
		await expect(page.getByRole('link', { name: 'Practice' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Insights' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Insurance' })).toHaveCount(0);
		// The patients top bar leads with the search box; the redundant "Dx Viewer"
		// heading is gone (the logo already brands the app). The PHI toggle was removed.
		await expect(page.getByRole('textbox', { name: 'Search' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Dx Viewer' })).toHaveCount(0);
		await expect(page.getByTestId('phi-toggle')).toHaveCount(0);
	});

	test('loads patient cards and never rests on the empty-state (#86)', async ({ page }) => {
		await page.goto('/patients');
		// The demo account has data → patient cards (links to /patients/<id>) must appear.
		const cards = page.locator('a[href*="/patients/"]');
		await expect(cards.first()).toBeVisible();
		expect(await cards.count()).toBeGreaterThan(0);
		// …and the "No studies yet" empty-state must not be the resting state (the #86
		// regression: it used to win the first paint before refresh() resolved).
		await expect(page.getByRole('heading', { name: 'No studies yet' })).toHaveCount(0);
	});
});
