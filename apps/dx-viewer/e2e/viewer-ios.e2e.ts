import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url, waitFor3dReady } from './helpers';
import { seedIosStudy, readAll } from './seed';

// LOCAL-FIRST: seed a segmented IOS study (ios_test.obj mesh + its seg glb from
// test_images) into IndexedDB; the per-study state (measures / hidden meshes) now persists
// to the iosState store, so we read it from IndexedDB rather than the old dxv:ios:* keys.
const ios = STUDIES.iosSeg;

async function iosState(
	page: Page,
	studyId: string
): Promise<{ measures?: unknown[]; hiddenMeshes?: string[] } | null> {
	const rows = await readAll<{ study: string; measures?: unknown[]; hiddenMeshes?: string[] }>(
		page,
		'iosState'
	);
	return rows.find((r) => r.study === studyId) ?? null;
}

test.describe('IOS viewer', () => {
	test.beforeEach(async ({ page }) => {
		const ok = await seedIosStudy(page, ios.patient, ios.study, 'IOS E2E Patient');
		test.skip(!ok, 'test_images IOS fixtures (ios_test.obj + ios-seg.glb) not present');
	});

	test('mesh loads with the per-tooth layer panel', async ({ page }) => {
		await page.goto(url.ios(ios));
		await waitFor3dReady(page);
		await expect(page.getByText('Mesh stats')).toBeVisible();
	});

	// Reseeded against the demo's ORIGINAL ios-seg.glb (byte-identical, recovered from the
	// pre-wipe snapshot), so the EXACT per-tooth/arch geometry is reproduced faithfully.
	test('grouped layer toggles (All / Upper / Lower) hide the right arch', async ({ page }) => {
		await page.goto(url.ios(ios));
		await waitFor3dReady(page);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await expect
			.poll(async () => (await iosState(page, ios.study))?.hiddenMeshes?.length ?? 0)
			.toBe(0);

		// "Lower" hides the upper arch → hiddenMeshes becomes non-empty.
		await page.getByRole('button', { name: 'Lower', exact: true }).click();
		await expect
			.poll(async () => (await iosState(page, ios.study))?.hiddenMeshes?.length ?? 0)
			.toBeGreaterThan(0);

		await page.getByRole('button', { name: 'All', exact: true }).click();
		await expect
			.poll(async () => (await iosState(page, ios.study))?.hiddenMeshes?.length ?? 0)
			.toBe(0);
	});

	// Reseeded against the demo's ORIGINAL ios-seg.glb (byte-identical, recovered from the
	// pre-wipe snapshot), so the EXACT per-tooth/arch geometry — FDI layer labels, Upper/Lower
	// arch groups, and a mesh framed so the fixed canvas-relative measure points hit a surface
	// — is reproduced faithfully.
	test('surface measurement persists + RESTORES across reload', async ({ page }) => {
		await page.goto(url.ios(ios));
		await waitFor3dReady(page);

		await page.getByRole('button', { name: 'Measure', exact: true }).click();
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('mesh canvas not found');
		await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.62);
		await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.62);

		// The "Clear measurements" control only renders when measureCount > 0.
		const clearBtn = page.getByRole('button', { name: 'Clear measurements' });
		await expect(clearBtn).toBeVisible();

		// The Clear button appears on the in-memory commit, but the persist is debounced
		// (350ms) — wait for the segment to actually land in IndexedDB before reloading, or
		// we'd be testing restore-of-nothing.
		await expect
			.poll(async () => (await iosState(page, ios.study))?.measures?.length ?? 0, {
				timeout: 15_000
			})
			.toBeGreaterThan(0);

		// Reload: after a fresh load measureCount starts at 0, so the Clear button reappearing
		// proves loadMeasurements() replayed the IndexedDB-persisted segment.
		await page.reload();
		await waitFor3dReady(page);
		await expect(clearBtn).toBeVisible();
	});

	// Reseeded against the demo's ORIGINAL ios-seg.glb (byte-identical, recovered from the
	// pre-wipe snapshot), so the EXACT per-tooth/arch geometry is reproduced faithfully.
	test('a fat-finger double-click does NOT commit a 0 mm measurement (degenerate guard)', async ({
		page
	}) => {
		await page.goto(url.ios(ios));
		await waitFor3dReady(page);
		await page.getByRole('button', { name: 'Measure', exact: true }).click();
		const canvas = page.locator('canvas').first();
		const box = await canvas.boundingBox();
		if (!box) throw new Error('mesh canvas not found');
		// Same screen point twice → identical raycast → distance 0 → must be ignored.
		const ax = box.x + box.width * 0.45;
		const ay = box.y + box.height * 0.62;
		await page.mouse.click(ax, ay);
		await page.mouse.click(ax, ay);
		// A genuine 2nd point now completes the measurement, proving the pending was kept.
		await page.mouse.click(box.x + box.width * 0.55, ay);

		const clearBtn = page.getByRole('button', { name: 'Clear measurements' });
		await expect(clearBtn).toBeVisible(); // a measurement committed

		// The single committed segment must be the REAL A→B (non-zero length).
		await expect
			.poll(
				async () => {
					const segs = ((await iosState(page, ios.study))?.measures ?? []) as {
						a: number[];
						b: number[];
					}[];
					if (!segs.length) return -1;
					const s = segs[0]!;
					return Math.hypot(s.b[0]! - s.a[0]!, s.b[1]! - s.a[1]!, s.b[2]! - s.a[2]!);
				},
				{ timeout: 15_000 }
			)
			.toBeGreaterThan(0.1);
	});

	// Reseeded against the demo's ORIGINAL ios-seg.glb (byte-identical, recovered from the
	// pre-wipe snapshot), so the EXACT per-tooth/arch geometry is reproduced faithfully.
	test('layer panel follows the tooth-numbering preference (matches the chart, not raw FDI)', async ({
		page
	}) => {
		const fdiOnly = /Tooth (3[3-8]|4[1-8])/;
		const layerCb = (re: RegExp) => page.getByRole('checkbox', { name: re });

		await page.goto(url.ios(ios));
		await waitFor3dReady(page);
		// Default (Universal): segmented lower teeth render ≤32 — no FDI-only labels.
		await page.evaluate(() => localStorage.removeItem('dxv:toothNumbering'));
		await page.reload();
		await waitFor3dReady(page);
		await expect(layerCb(/^Tooth /i).first()).toBeVisible({ timeout: 60_000 });
		await expect.poll(() => layerCb(fdiOnly).count()).toBe(0);

		// FDI preference: the same teeth now expose their FDI numbers (some ≥33).
		await page.evaluate(() => localStorage.setItem('dxv:toothNumbering', 'fdi'));
		await page.reload();
		await waitFor3dReady(page);
		await expect(layerCb(/^Tooth /i).first()).toBeVisible({ timeout: 60_000 });
		await expect.poll(() => layerCb(fdiOnly).count()).toBeGreaterThan(0);

		await page.evaluate(() => localStorage.removeItem('dxv:toothNumbering'));
	});
});
