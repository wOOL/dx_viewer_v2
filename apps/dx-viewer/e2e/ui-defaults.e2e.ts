import { test, expect } from '@playwright/test';

test.describe('UI defaults (heading · collapsed rail · logo/favicon)', () => {
	test('home dashboard leads with the welcome heading, not a radiograph list', async ({ page }) => {
		await page.goto('/studies');
		// The redesigned homepage greets the clinician; the full patient grid moved to
		// /patients (reachable via "View All" + the Patients nav).
		await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Recently captured radiographs' })).toHaveCount(
			0
		);
	});

	test('left rail is always collapsed (icon-only, no expand toggle)', async ({ page }) => {
		await page.addInitScript(() => localStorage.removeItem('dxv:sidebar'));
		await page.goto('/studies');
		const sidebar = page.getByTestId('sidebar');
		await expect(sidebar).toBeVisible();
		await expect(sidebar).toHaveClass(/collapsed/);
		// Collapsed → brand text hidden; the expand/collapse toggle was removed entirely
		// (clinician request), so neither control should exist.
		await expect(sidebar.getByText('Dx Viewer')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveCount(0);
	});

	test('the official logo + favicon are wired and served', async ({ page }) => {
		await page.goto('/studies');
		// The sidebar mark is the official logo image (a Vite content-hashed asset URL, so
		// match by name — the hash busts the Cloudflare cache on every redeploy).
		const mark = page.getByTestId('sidebar').locator('img.logo-mark');
		await expect(mark).toHaveAttribute('src', /logo.*\.png/i);
		// Exactly one favicon (the old data-URI SVG tooth was removed) → the official PNG.
		const favicon = page.locator('head link[rel="icon"]');
		await expect(favicon).toHaveCount(1);
		await expect(favicon).toHaveAttribute('href', /favicon.*\.png/i);
		// Both resolve to a real 200 (fetch the actual hashed URLs the page references).
		const logoSrc = await mark.getAttribute('src');
		const favHref = await favicon.getAttribute('href');
		expect((await page.request.get(logoSrc!)).ok()).toBeTruthy();
		expect((await page.request.get(favHref!)).ok()).toBeTruthy();
	});

	test('the logo background is genuinely transparent in light mode (no chip/backdrop)', async ({
		page
	}) => {
		// The mark is the official glow-on-dark art with its background keyed out. The user
		// explicitly wants it transparent in BOTH themes — no rounded chip behind it on light.
		await page.addInitScript(() => localStorage.setItem('dxv:theme', 'light'));
		await page.goto('/studies');
		const mark = page.getByTestId('sidebar').locator('img.logo-mark');
		await expect(mark).toBeVisible();
		const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
		// Fully transparent → rgba(0, 0, 0, 0) (or the keyword 'transparent'); never an opaque fill.
		expect(['rgba(0, 0, 0, 0)', 'transparent'], `logo-mark bg in light was "${bg}"`).toContain(bg);
	});

	test('the app shell has no unreplaced %sveltekit.*% placeholder leaking into the page', async ({
		page
	}) => {
		// Regression: SvelteKit does a single String.replace for %sveltekit.head%, so a
		// literal token anywhere earlier in app.html (even inside an HTML comment) steals the
		// replacement and leaves the real placeholder to render as visible text.
		const resp = await page.goto('/studies');
		const html = (await resp?.text()) ?? '';
		expect(html, 'served HTML still contains a raw %sveltekit.head% token').not.toContain(
			'%sveltekit.head%'
		);
		expect(html).not.toContain('%sveltekit.body%');
		// And nothing leaks as visible text in the hydrated DOM.
		await expect(page.locator('body')).not.toContainText('%sveltekit');
	});
});
