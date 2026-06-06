import { test, expect } from '@playwright/test';
import { STUDIES, url, waitFor3dReady } from './helpers';
import { seedCbctStudy, seedIosStudy } from './seed';

// #44 — tooth selection. The 3D highlight itself is WebGL (not pixel-readable), so
// we assert the DOM-observable bindings: the tooth-chart highlight ring and the
// CBCT conditions modal. The chart-click path is fully deterministic.
// LOCAL-FIRST: seed the segmented IOS + CBCT studies (recovered original segs) into IndexedDB.
test.describe('tooth selection (#44)', () => {
	test.beforeEach(async ({ page }) => {
		const okI = await seedIosStudy(page, STUDIES.iosSeg.patient, STUDIES.iosSeg.study);
		const okC = await seedCbctStudy(page, STUDIES.cbctSeg.patient, STUDIES.cbctSeg.study);
		test.skip(!okI || !okC, 'test_images 3D fixtures not present');
	});
	test('IOS: chart click selects + highlights a tooth; clicking again deselects', async ({
		page
	}) => {
		await page.goto(url.ios(STUDIES.iosSeg));
		await waitFor3dReady(page);

		// Nothing highlighted on load.
		await expect(page.locator('.ring-primary')).toHaveCount(0);

		const cell = page.locator('button[title^="Tooth "]').first();
		await cell.click();
		await expect(page.locator('.ring-primary')).toHaveCount(1);

		await cell.click();
		await expect(page.locator('.ring-primary')).toHaveCount(0);
	});

	test('IOS: clicking a tooth on the 3D mesh highlights it in the chart', async ({ page }) => {
		await page.goto(url.ios(STUDIES.iosSeg));
		await waitFor3dReady(page);
		await expect(page.locator('.ring-primary')).toHaveCount(0);

		// Click across the lower arch (where the coloured teeth sit) until a tooth is
		// picked → its chart cell gets the highlight ring. Several candidates make the
		// WebGL hit-test robust without depending on one exact pixel.
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('mesh canvas not found');
		const ys = [0.62, 0.7, 0.55];
		const xs = [0.45, 0.55, 0.4, 0.6, 0.5];
		let highlighted = false;
		for (const y of ys) {
			for (const x of xs) {
				await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
				if ((await page.locator('.ring-primary').count()) > 0) {
					highlighted = true;
					break;
				}
			}
			if (highlighted) break;
		}
		expect(highlighted, 'no tooth got picked on the 3D mesh').toBe(true);
	});

	test('CBCT: double-clicking a tooth on the 3D mesh opens its conditions modal', async ({
		page
	}) => {
		await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=volume');
		await waitFor3dReady(page);

		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('mesh canvas not found');
		const modal = page.getByRole('heading', { name: /Tooth \d+ conditions/i });

		// Double-click across candidate tooth positions until the modal opens (jaws
		// have no FDI → no modal, so we may need a few tries to land on a tooth). A
		// dense grid over the arch keeps this robust to the canvas size changing with
		// the wide sidebar (a sparse cluster could miss every crown on a narrower view).
		const pts: [number, number][] = [];
		for (const y of [0.42, 0.5, 0.55, 0.62, 0.7]) {
			for (const x of [0.35, 0.43, 0.5, 0.57, 0.65]) {
				pts.push([x, y]);
			}
		}
		let opened = false;
		for (const [x, y] of pts) {
			await page.mouse.dblclick(box.x + box.width * x, box.y + box.height * y);
			if (await modal.isVisible().catch(() => false)) {
				opened = true;
				break;
			}
		}
		expect(opened, 'conditions modal never opened from a 3D double-click').toBe(true);
	});
});
