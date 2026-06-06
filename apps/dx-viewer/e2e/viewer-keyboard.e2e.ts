import { test, expect } from '@playwright/test';
import { STUDIES, url, waitForCbctVolume } from './helpers';
import { seedXrayStudies, seedCbctStudy, FINDING_COUNTS_2D } from './seed';

// #44 keyboard-nav parity gap: Left/Right arrows step through a patient's X-rays
// (a universal radiograph-viewer convention). LOCAL-FIRST: seed two X-rays under the
// patient. xrayStudies is newest-first and prevStudy needs idx>0, so the NEWER sibling
// sits at index 0 and the target at index 1 — giving ArrowLeft a study to move to.
const SIBLING = 'seedsibkbd00001';

test('Left/Right arrows navigate prev/next X-ray in the 2D viewer (#44)', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/studies');
	await seedXrayStudies(page, [
		{
			patient: STUDIES.xray2d.patient,
			study: SIBLING,
			patientName: 'Test Patient',
			capturedAt: '2026-06-01T00:00:00.000Z',
			findingCounts: FINDING_COUNTS_2D
		},
		{
			patient: STUDIES.xray2d.patient,
			study: STUDIES.xray2d.study,
			patientName: 'Test Patient',
			capturedAt: '2025-01-01T00:00:00.000Z',
			findingCounts: FINDING_COUNTS_2D
		}
	]);

	await page.goto(url.viewer2d(STUDIES.xray2d));
	await expect(page.locator('canvas').first()).toBeVisible();
	const original = page.url();
	expect(original).toContain(`/viewer/${STUDIES.xray2d.patient}/${STUDIES.xray2d.study}`);

	// ArrowLeft → previous X-ray (the older sibling under the same patient).
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => page.url(), { timeout: 10_000 }).not.toBe(original);
	const prevUrl = page.url();
	expect(prevUrl).toContain(`/viewer/${STUDIES.xray2d.patient}/`);

	// ArrowRight → back to the original study (prev/next are inverses by index).
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => page.url(), { timeout: 10_000 }).toBe(original);

	expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
});

// #44 CBCT half: Up/Down arrows scrub the slice of the MPR pane under the cursor.
// LOCAL-FIRST: seedCbctStudy injects the tooth.nrrd volume into IndexedDB (the MPR
// slice-scrub only needs the raw volume, not the segmentation), so this is no longer
// blocked. Hovering a pane sets store.activeAxis; ArrowDown/Up scrub THAT pane's slice.
test('Up/Down arrows scrub the hovered MPR pane slice (#44, CBCT)', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	const ok = await seedCbctStudy(
		page,
		STUDIES.cbctSeg.patient,
		STUDIES.cbctSeg.study,
		'KBD CBCT Patient'
	);
	test.skip(!ok, 'test_images CBCT fixtures (tooth.nrrd) not present');

	await page.goto(url.cbct(STUDIES.cbctSeg) + '?view=mpr');
	await waitForCbctVolume(page);

	// Hover an MPR pane → its axis becomes store.activeAxis (the Up/Down scrub target).
	const pane = page.locator('.mpr-pane').first();
	await pane.hover();
	const counter = pane.getByText(/^\d+\/\d+$/); // "<current>/<max>" overlay
	const before = (await counter.textContent())!;

	// ArrowDown advances the hovered pane's slice (initial index is 0, so go down first to
	// avoid the lower clamp), ArrowUp reverts it.
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => counter.textContent(), { timeout: 5_000 }).not.toBe(before);
	await page.keyboard.press('ArrowUp');
	await expect.poll(() => counter.textContent(), { timeout: 5_000 }).toBe(before);

	expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
});
