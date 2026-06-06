import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url, waitFor3dReady, waitForCbctVolume } from './helpers';
import { seedCbctStudy, seedIosStudy, readAll } from './seed';

// The existing 3D specs assert a single end-state (a pane is visible, a value
// persisted). They do NOT drive the interactive tools to completion while
// watching for runtime errors — so a tool that THROWS mid-interaction (orbit,
// angle commit, annotation focus, print) would pass those specs yet be broken
// for the user. This spec drives the previously-undriven 3D interactions and
// fails on any uncaught pageerror / console.error.

const cbct = STUDIES.cbctSeg;
const ios = STUDIES.iosSeg;

// LOCAL-FIRST: markups ride the `cbctReportState` store now (not dxv:cbct:markups
// localStorage). Read the persisted angle/annotation counts from IndexedDB.
async function cbctMarkups(
	page: Page,
	studyId: string
): Promise<{ measurements?: unknown[]; angles?: unknown[]; annotations?: unknown[] }> {
	const rows = await readAll<{ study: string; markups?: Record<string, unknown[]> }>(
		page,
		'cbctReportState'
	);
	return rows.find((r) => r.study === studyId)?.markups ?? {};
}

/** Collect uncaught errors + console.error (minus unrelated network noise). */
function trackErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
	page.on('console', (m) => {
		if (m.type() !== 'error') return;
		const t = m.text();
		// PB/network/asset noise unrelated to the viewer code under test.
		if (/favicon|net::ERR|Failed to load resource|ERR_|status of 4\d\d|status of 5\d\d/i.test(t))
			return;
		errors.push(`console.error: ${t}`);
	});
	return errors;
}

/** The CBCT/IOS mesh loads behind Volume3D's OWN "Loading 3D model…" overlay,
 *  which waitFor3dReady (slice/volume oriented) does not wait on. */
async function waitForMesh(page: Page, timeout = 60_000) {
	// Give loadGLTF a moment to mount its overlay, then wait for it to clear.
	await page.waitForTimeout(600);
	await expect(page.getByText('Loading 3D model…')).toHaveCount(0, { timeout });
}

test.describe('3D interactive tools (undriven paths)', () => {
	test.beforeEach(async ({ page }) => {
		const okC = await seedCbctStudy(page, cbct.patient, cbct.study);
		const okI = await seedIosStudy(page, ios.patient, ios.study);
		test.skip(!okC || !okI, 'test_images 3D fixtures not present');
	});

	test('CBCT 3D orientation gizmo snaps to every anatomical view without error', async ({
		page
	}) => {
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		await waitForMesh(page);

		// The gizmo buttons carry title="View: <label>" (label is localised but the
		// suite runs in English: Top/Front/R/Bot/Back/L).
		for (const label of ['Top', 'Front', 'R', 'Bot', 'Back', 'L']) {
			const btn = page.locator(`button[title="View: ${label}"]`);
			await expect(btn).toBeVisible();
			await btn.click();
			await page.waitForTimeout(120);
		}
		await expect(page.locator('canvas').first()).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('CBCT MPR angle tool commits a 3-point angle (persisted)', async ({ page }) => {
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);

		await page.locator('button[aria-label="Angle measurement"]').click();
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('axial pane canvas not found');
		// Three distinct points → vertex + two rays → one committed angle.
		await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
		await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4);
		await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);

		await expect
			.poll(async () => (await cbctMarkups(page, cbct.study)).angles?.length ?? 0, {
				timeout: 15_000
			})
			.toBeGreaterThan(0);
		expect(errors).toEqual([]);
	});

	test('CBCT MPR annotation tool opens a note input, types + commits (persisted)', async ({
		page
	}) => {
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=mpr');
		await waitForCbctVolume(page);

		await page.locator('button[aria-label="Annotation pin"]').click();
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('axial pane canvas not found');
		await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

		// The floating note input appears (deferred focus past the click's mouseup).
		const note = page.locator('input[placeholder="Note…"]');
		await expect(note).toBeVisible();
		await note.fill('apex lesion');
		await note.press('Enter');

		await expect
			.poll(async () => (await cbctMarkups(page, cbct.study)).annotations?.length ?? 0, {
				timeout: 15_000
			})
			.toBeGreaterThan(0);
		expect(errors).toEqual([]);
	});

	test('CBCT report "Print report" opens a populated print window', async ({ page }) => {
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=report');
		await waitFor3dReady(page);

		const [popup] = await Promise.all([
			page.waitForEvent('popup'),
			page.getByRole('button', { name: 'Print report' }).click()
		]);
		await popup.waitForLoadState('domcontentloaded');
		// The print HTML carries the AI-report heading + the findings table headers.
		await expect(popup.locator('h1')).toContainText(/report/i);
		await expect(popup.locator('table')).toBeVisible();
		await popup.close();
		expect(errors).toEqual([]);
	});

	test('CBCT panoramic ruler + slab + overlays toggle without error', async ({ page }) => {
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=panoramic');
		await waitFor3dReady(page);

		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('pano canvas not found');

		// Activate the ruler and drag a segment across the pano.
		await page.locator('button[aria-label^="Ruler"]').click();
		await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 8 });
		await page.mouse.up();

		// Cycle the MIP slab + toggle overlays off/on (each re-renders the canvas).
		await page.locator('button[aria-label^="MIP slab thickness"]').click();
		const overlays = page.locator('button[aria-label="Show / hide overlays"]');
		await overlays.click();
		await overlays.click();

		await expect(canvas).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('switching CBCT layouts 3D ↔ MPR ↔ 3D re-renders the mesh each remount (remesh cache)', async ({
		page
	}) => {
		// The MPR 4th pane and the dedicated 3D layout are separate {#if} branches, so
		// each switch unmounts + remounts Volume3D. The remesh cache lets the remount
		// reuse the already-processed geometry — the mesh must still render every time
		// (a cache that returned a wrong/disposed geometry would blank the 3D view).
		const errors = trackErrors(page);
		await page.goto(url.cbct(cbct) + '?view=volume');
		await waitFor3dReady(page);
		await waitForMesh(page); // 1st mount: full remesh (cache miss)

		await page.getByRole('button', { name: 'MPR', exact: true }).click();
		await waitForCbctVolume(page);
		await page.getByRole('button', { name: '3D', exact: true }).click();
		await waitFor3dReady(page);
		await waitForMesh(page); // 2nd mount: cache HIT — mesh must still render
		await expect(page.locator('canvas').first()).toBeVisible();

		expect(errors).toEqual([]);
	});

	test('IOS orientation rail + wireframe + screenshot fire without error', async ({ page }) => {
		const errors = trackErrors(page);
		await page.goto(url.ios(ios));
		await waitFor3dReady(page);
		await waitForMesh(page);

		for (const name of [
			'Anterior view',
			'Posterior view',
			'Right buccal',
			'Left buccal',
			'Occlusal — upper',
			'Occlusal — lower'
		]) {
			await page.getByRole('button', { name, exact: true }).click();
			await page.waitForTimeout(80);
		}

		// Wireframe toggle (on then off).
		const wf = page.getByRole('button', { name: 'Wireframe', exact: true });
		await wf.click();
		await wf.click();

		// Screenshot triggers a data-URL download; accept it so it doesn't dangle.
		const dl = page.waitForEvent('download').catch(() => null);
		await page.getByRole('button', { name: 'Screenshot', exact: true }).click();
		await dl;

		await expect(page.locator('canvas').first()).toBeVisible();
		expect(errors).toEqual([]);
	});
});
