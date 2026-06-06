import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedCbctStudy } from './seed';

// The CBCT workspace has TWO tabs banks and a tool rail that visually mark
// the selected option with `class:active` — they all need aria-pressed for
// keyboard / SR users to know which view/tool is current.
//
// We don't need the volume actually parsed — the view tabs + tool rail are
// chrome that render unconditionally. We DO need to switch to MPR explicitly
// because previous-session localStorage can leave the user on a different tab.
// LOCAL-FIRST: seed the segmented CBCT study so the route renders the workspace.
test.describe('CBCT view tabs + tool rail a11y', () => {
	test.beforeEach(async ({ page }) => {
		const ok = await seedCbctStudy(page, STUDIES.cbctSeg.patient, STUDIES.cbctSeg.study);
		test.skip(!ok, 'test_images CBCT fixtures not present');
	});
	// CbctWorkspace's onMount reads ?view= to deep-link a tab. Use it so the
	// rendering is deterministic instead of fighting the store's 'report' default.
	test('view-mode tabs (MPR/3D/Panoramic/Report) expose aria-pressed', async ({ page }) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=mpr');
		await page.getByRole('button', { name: 'MPR', exact: true }).first().waitFor();

		for (const name of ['MPR', '3D', 'Panoramic', 'Report']) {
			const btn = page.getByRole('button', { name, exact: true }).first();
			await expect(btn, `${name}: tab visible`).toBeVisible();
			const v = await btn.getAttribute('aria-pressed');
			expect(v, `${name}: aria-pressed missing`).not.toBeNull();
			expect(['true', 'false']).toContain(v);
		}
	});

	// Only the TOGGLE rail buttons need aria-pressed; pure actions (resetWL,
	// resetAll) intentionally don't. Labels are the i18n catalog values.
	const TOGGLES = [
		'Crosshair (link slices)',
		'Pan',
		'Window/Level',
		'Linear measurement',
		'Angle measurement',
		'Annotation pin',
		'Slab thickness',
		'Toggle crosshair overlay'
	];
	test('every MPR tool-rail TOGGLE button exposes aria-pressed', async ({ page }) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=mpr');
		await page.locator('aside button.rail-btn').first().waitFor();
		for (const label of TOGGLES) {
			const btn = page.locator(`aside button.rail-btn[aria-label="${label}"]`);
			await expect(btn, `tool-rail "${label}": visible`).toBeVisible();
			const v = await btn.getAttribute('aria-pressed');
			expect(v, `tool-rail "${label}": aria-pressed missing`).not.toBeNull();
			expect(['true', 'false']).toContain(v);
		}
	});
});
