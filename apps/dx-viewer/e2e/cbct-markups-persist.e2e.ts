import { test, expect } from '@playwright/test';
import { STUDIES, url, waitForCbctVolume } from './helpers';
import { seedCbctStudy, seedStateRow, readAll } from './seed';

// CBCT markups (linear measurements, angles, annotations) used to be localStorage-only — a
// clinician adding a 12.3 mm linear measurement on laptop A saw NOTHING on laptop B.
// LOCAL-FIRST: they now ride the `cbctReportState` store in IndexedDB (alongside the
// sign-off / per-tooth approvals). This test seeds a cbctReportState row with one synthetic
// measurement, opens the CBCT workspace, and asserts the measurement is RESTORED into the
// store — proven by a DOM-observable signal: "Reset all" pops the destructive-clear confirm
// ONLY when store.measurements/angles/annotations is non-empty (CbctWorkspace.resetAll), so
// the confirm appearing means the seeded markup replayed from IndexedDB.
const cbct = STUDIES.cbctSeg;

test('CBCT markups restore from IndexedDB across a fresh load (cross-device persistence)', async ({
	page
}) => {
	const ok = await seedCbctStudy(page, cbct.patient, cbct.study, 'CBCT Markups Patient');
	test.skip(!ok, 'test_images CBCT fixtures not present');

	// Seed a persisted markup directly into the local store (the local-first replacement for
	// the old "POST a cbct_report_state PB record" step).
	await seedStateRow(page, 'cbctReportState', cbct.study, {
		markups: {
			measurements: [{ axis: 'axial', slice: 5, a: [10, 20], b: [40, 50], mm: 12.3 }],
			angles: [],
			annotations: []
		},
		hiddenMeshes: []
	});

	// Sanity: the row is in IndexedDB before we load the viewer.
	const seeded = await readAll<{ study: string; markups?: { measurements?: unknown[] } }>(
		page,
		'cbctReportState'
	);
	expect(seeded.find((r) => r.study === cbct.study)?.markups?.measurements?.length).toBe(1);

	// Capture the destructive-clear confirm. It only fires when the store HAS markups, so its
	// appearance proves loadFromDb() → applyMarkups() replayed the seeded measurement.
	let confirmMsg = '';
	page.on('dialog', (d) => {
		confirmMsg = d.message();
		void d.dismiss(); // cancel → keep the markups
	});

	await page.goto(url.cbct(cbct) + '?view=mpr');
	await waitForCbctVolume(page);

	await page.locator('button[aria-label="Reset all"]').click();
	await expect.poll(() => confirmMsg, { timeout: 10_000 }).toMatch(/Clear all measurements/i);
});

test('a Layers toggle made <350ms before navigating away still persists (flush-on-destroy)', async ({
	page
}) => {
	// REGRESSION: onDestroy used to CANCEL the pending debounced save, silently losing
	// any markup/layer edit made within 350ms of leaving the viewer. It must FLUSH.
	const ok = await seedCbctStudy(page, cbct.patient, cbct.study, 'CBCT Markups Patient');
	test.skip(!ok, 'test_images CBCT fixtures not present');

	// Start from a clean per-study state row so the assertion is unambiguous.
	await seedStateRow(page, 'cbctReportState', cbct.study, { markups: null, hiddenMeshes: [] });

	// volume view shows the seg mesh + the Layers sidebar without the slow raw-volume parse.
	await page.goto(url.cbct(cbct) + '?view=volume');
	const layerCb = page.getByRole('checkbox', { name: /^Tooth /i }).first();
	await expect(layerCb).toBeVisible({ timeout: 60_000 });

	// Toggle a layer (schedules the 350ms-debounced save), then leave via client-side
	// navigation IN THE SAME BROWSER TASK — two separate Playwright clicks have
	// round-trip latency that can exceed the 350ms debounce under load, letting the
	// save fire normally and the spec pass even WITHOUT the flush fix.
	await layerCb.evaluate((el) => {
		(el as HTMLInputElement).click();
		(document.querySelector('button[aria-label="Back"]') as HTMLButtonElement).click();
	});
	await page.waitForURL(/\/(patients|studies)/, { timeout: 15_000 });

	// The flushed write landed in IndexedDB even though the viewer unmounted.
	await expect
		.poll(
			async () => {
				const rows = await readAll<{ study: string; hiddenMeshes?: string[] }>(
					page,
					'cbctReportState'
				);
				return rows.find((r) => r.study === cbct.study)?.hiddenMeshes?.length ?? 0;
			},
			{ timeout: 10_000 }
		)
		.toBe(1);
});
