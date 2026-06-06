import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Accessibility regression guard. Scans the main authenticated surfaces with
// axe-core (WCAG 2.0/2.1 A + AA) and fails on serious/critical violations.
// Logs the full list so regressions are actionable.
//
// The suite runs in dark by default (playwright colorScheme). The redesigned
// surfaces are ALSO scanned in light (the dual-theme contract); this LIGHT_PAGES
// list grows as each surface is migrated to the new theme tokens.
const PAGES: Array<{ name: string; path: string; ready: string }> = [
	{ name: 'studies', path: '/studies', ready: 'aside' },
	{ name: 'patients', path: '/patients', ready: 'aside' },
	{ name: 'settings', path: '/settings', ready: 'aside' },
	{ name: 'account', path: '/account', ready: 'aside' },
	{ name: 'billing', path: '/billing', ready: 'aside' },
	{ name: 'help', path: '/help', ready: 'aside' },
	{ name: 'upload', path: '/upload', ready: 'aside' },
	// PremiumPlaceholder upsell pages: the shared component's CTA/footer contrast is fixed
	// (#97) and the decorative fake-data mockup is `inert` (hidden from a11y tree), so these
	// now pass the same AA bar as the rest of the app.
	{ name: 'practice', path: '/practice', ready: 'aside' },
	{ name: 'insights', path: '/insights', ready: 'aside' },
	{ name: 'insurance', path: '/insurance', ready: 'aside' },
	{ name: '2d-viewer', path: url.viewer2d(STUDIES.xray2d), ready: 'canvas' }
	// LOCAL-FIRST: the CBCT (mpr/report/volume/panoramic) + IOS page scans need a seeded 3D
	// volume/mesh + segmentation (binary fixtures) to render their canvas — they're covered
	// by the dedicated 3D specs and re-added here once the 3D seeding lands. See
	// local_first_design.md (deferred E2E reseed).
];

// Surfaces migrated to the Aurora dual-theme tokens — scanned in light too.
const LIGHT_PAGES = new Set([
	'studies',
	'patients',
	'settings',
	'account',
	'billing',
	'help',
	'upload',
	'practice',
	'insights',
	'insurance',
	'2d-viewer'
]);

async function scan(page: Page, p: { name: string; path: string; ready: string }, theme: string) {
	// The 2D-viewer scan needs a study; the rest are data-independent app surfaces.
	if (p.name === '2d-viewer') {
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'A11y Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
	}
	await page.goto(p.path);
	await page.locator(p.ready).first().waitFor({ timeout: 30_000 });
	await page.waitForTimeout(800); // let async content settle

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
		.analyze();

	const serious = results.violations.filter(
		(v) => v.impact === 'serious' || v.impact === 'critical'
	);
	if (results.violations.length) {
		console.log(`\n[a11y ${p.name} · ${theme}] ${results.violations.length} violations:`);
		for (const v of results.violations) {
			console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
			console.log(`      target: ${JSON.stringify(v.nodes[0]?.target)}`);
			console.log(`      html: ${v.nodes[0]?.html?.slice(0, 140)}`);
			console.log(`      why: ${v.nodes[0]?.failureSummary?.replace(/\n/g, ' ')}`);
		}
	}
	expect(serious, `serious/critical a11y violations on ${p.name} (${theme})`).toEqual([]);
}

for (const p of PAGES) {
	test(`a11y: ${p.name}`, async ({ page }) => {
		await scan(page, p, 'dark');
	});

	if (LIGHT_PAGES.has(p.name)) {
		test(`a11y: ${p.name} (light)`, async ({ page }) => {
			await page.addInitScript(() => localStorage.setItem('dxv:theme', 'light'));
			await scan(page, p, 'light');
		});
	}
}
