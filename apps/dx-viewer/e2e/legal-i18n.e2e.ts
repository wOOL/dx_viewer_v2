import { test, expect } from '@playwright/test';

// Both legal pages (Terms of Service and Privacy Policy) used to render their
// 6/11 section bodies as hardcoded English regardless of UI locale, even though
// the heading + "back to sign-in" link were i18n'd. A French clinician was
// being asked to accept a contract they couldn't read in their language.
// Both pages now render every section body through `$_('legal.*')`.
test.describe('legal pages render in the active UI locale', () => {
	test.beforeEach(async ({ page }) => {
		// Public route: no auth needed. Set the locale BEFORE first nav so the
		// SSR pass / first paint pick it up.
		await page.goto('/terms');
		await page.evaluate(() => localStorage.setItem('dxv:lang', 'fr'));
	});

	test.afterEach(async ({ page }) => {
		await page.evaluate(() => localStorage.removeItem('dxv:lang')).catch(() => {});
	});

	test('Terms shows FR section titles after a locale switch', async ({ page }) => {
		await page.reload();
		await expect(page.getByRole('heading', { name: "Conditions d'utilisation" })).toBeVisible();
		// Each numbered section title — none of these strings exist in EN.
		await expect(page.getByText('1. Usage clinique')).toBeVisible();
		await expect(page.getByText('2. Éligibilité')).toBeVisible();
		await expect(page.getByText('3. Traitement des données')).toBeVisible();
		await expect(page.getByText('4. Facturation')).toBeVisible();
		await expect(page.getByText('5. Utilisation acceptable')).toBeVisible();
		await expect(page.getByText('6. Responsabilité')).toBeVisible();
		// And no English leaks of the old hardcoded titles.
		await expect(page.getByText('1. Clinical use')).toHaveCount(0);
		await expect(page.getByText('4. Billing')).toHaveCount(0);
	});

	test('Privacy shows FR section titles after a locale switch', async ({ page }) => {
		await page.goto('/privacy');
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible();
		await expect(page.getByText('1. Ce que nous collectons')).toBeVisible();
		await expect(page.getByText('6. Vos droits')).toBeVisible();
		await expect(page.getByText('11. Contact')).toBeVisible();
		// Old English leaks.
		await expect(page.getByText('1. What we collect')).toHaveCount(0);
		await expect(page.getByText('6. Your rights')).toHaveCount(0);
	});
});
