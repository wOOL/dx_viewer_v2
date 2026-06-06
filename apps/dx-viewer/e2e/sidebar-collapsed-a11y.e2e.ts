import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The rail now DEFAULTS to collapsed (icon-only). Every nav row that renders its
// label-text only when expanded needs an aria-label to stay accessible as an icon.
// Pre-fix: the Help row had a `title` (tooltip) but no `aria-label`, so screen
// readers got either no name or an inconsistent fallback.
test.describe('sidebar (collapsed) a11y', () => {
	test('every nav button/link in the collapsed sidebar has an accessible name', async ({
		page
	}) => {
		// Collapsed is the default, but pin it so this test is robust to that default.
		await page.addInitScript(() => localStorage.setItem('dxv:sidebar', 'collapsed'));
		await page.goto('/studies');
		await page.getByTestId('sidebar').waitFor();
		// Sanity-check the collapse happened (width drops to ~68px in CSS).
		await expect
			.poll(async () => {
				return await page
					.locator('aside.sidebar')
					.evaluate((el) => el.getBoundingClientRect().width);
			})
			.toBeLessThan(120);

		const missingNames = await page
			.locator('aside.sidebar a, aside.sidebar button')
			.evaluateAll((nodes) =>
				nodes
					.filter((n) => {
						const aria = n.getAttribute('aria-label')?.trim();
						const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
						return !aria && !text;
					})
					.map((n) => ({ tag: n.tagName, html: (n as HTMLElement).outerHTML.slice(0, 200) }))
			);
		expect(missingNames, `controls without accessible names in collapsed sidebar`).toEqual([]);

		// And confirm axe agrees (link-name / button-name rules).
		const results = await new AxeBuilder({ page })
			.include('aside.sidebar')
			.withTags(['wcag2a'])
			.analyze();
		const serious = results.violations.filter(
			(v) => v.impact === 'serious' || v.impact === 'critical'
		);
		expect(serious, `serious/critical a11y violations in collapsed sidebar`).toEqual([]);
	});
});
