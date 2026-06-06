import { test, expect } from '@playwright/test';

// App-shell smoke: every authenticated page mounts within the shell, the auth
// guard lets the demo session through (no bounce to /login), and nothing throws
// an uncaught exception. /help is the #89 in-app page (was a dead external link).
const ROUTES = [
	'/studies',
	'/patients',
	'/upload',
	'/settings',
	'/account',
	'/billing',
	'/insights',
	'/practice',
	'/insurance',
	'/help'
];

for (const route of ROUTES) {
	test(`${route} renders in the app shell without uncaught errors`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		await page.goto(route);
		expect(page.url(), `bounced away from ${route}`).toContain(route);
		expect(page.url()).not.toContain('/login');
		await expect(page.locator('aside').first()).toBeVisible();

		expect(errors, `uncaught errors on ${route}:\n${errors.join('\n')}`).toEqual([]);
	});
}
