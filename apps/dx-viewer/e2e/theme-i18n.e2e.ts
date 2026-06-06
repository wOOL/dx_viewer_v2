import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Feature contract for the two new UI prefs: dark/light theme + i18n.
// Both must persist (localStorage) and reach the whole app (theme via
// <html data-theme>, language via reactive re-render of the chrome).

test.describe('theme', () => {
	test('sidebar toggle flips + persists the theme', async ({ page }) => {
		await page.goto('/studies');
		// Suite default is dark (playwright colorScheme + no saved pref).
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		await page.getByTestId('theme-toggle').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
		expect(await page.evaluate(() => localStorage.getItem('dxv:theme'))).toBe('light');

		// Persists across reload.
		await page.reload();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		// …and back to dark.
		await page.getByTestId('theme-toggle').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	});

	test('settings Light/Dark/System control sets <html data-theme>', async ({ page }) => {
		await page.goto('/settings');
		await page.getByTestId('theme-light').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

		await page.getByTestId('theme-dark').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		// 'System' clears the explicit pref (no stored key) and follows the OS,
		// which the suite pins to dark.
		await page.getByTestId('theme-system').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		expect(await page.evaluate(() => localStorage.getItem('dxv:theme'))).toBeNull();
	});
});

test.describe('i18n', () => {
	test('language switch re-translates the chrome + persists', async ({ page }) => {
		await page.goto('/settings');
		// Default English: the sidebar Help link shows the English label.
		await expect(page.getByRole('link', { name: 'Help' })).toBeVisible();

		// Switch to French → reactive re-render (no reload) translates the sidebar.
		await page.getByTestId('lang-fr').click();
		await expect(page.getByRole('link', { name: 'Aide' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Help' })).toHaveCount(0);
		expect(await page.evaluate(() => localStorage.getItem('dxv:lang'))).toBe('fr');
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

		// Persists across reload (no-FOUC sets <html lang>, init reads dxv:lang).
		await page.reload();
		await expect(page.getByRole('link', { name: 'Aide' })).toBeVisible();

		// Restore English so other tests/specs see the default locale.
		await page.getByTestId('lang-en').click();
		await expect(page.getByRole('link', { name: 'Help' })).toBeVisible();
	});

	test('language reaches the 2D viewer findings panel', async ({ page }) => {
		// Pin French before the app boots, then open a study with cached AI findings.
		await page.addInitScript(() => localStorage.setItem('dxv:lang', 'fr'));
		// LOCAL-FIRST: seed the study so the viewer's findings panel has data to translate.
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'Theme Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(url.viewer2d(STUDIES.xray2d));
		// The redesigned right panel is translated: the "AI Analysis" tab, the
		// "Diagnostic Results" header, and the "By disease" view toggle. (The pre-trim
		// "AI Viewer" / "Pathology" headers no longer exist — see the findings redesign.)
		await expect(page.getByText('Analyse IA')).toBeVisible();
		await expect(page.getByText('Résultats diagnostiques')).toBeVisible();
		await expect(page.getByText('Par pathologie')).toBeVisible();
	});
});
