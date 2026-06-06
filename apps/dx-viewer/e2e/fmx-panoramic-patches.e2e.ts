import { test, expect } from '@playwright/test';
import { seedPanoramicStudy } from './seed';

// Panoramic-only patient (a single .png panoramic, no partials yet): the FMX
// grid used to show empty placeholders in every non-pano slot. Now each slot
// whose teeth the AI located gets a "patch" — a crop of the panoramic region
// containing those teeth (the source panoramic still shows in the central slot
// and stays clickable). When real partials arrive, they take priority (the
// patches only fill empty slots — see the unit test for the helper).
//
// LOCAL-FIRST: seed a panoramic study (pan.png) with a synthetic 32-tooth number_result
// spread across the arch, so every surrounding slot's teeth are detected → a patch per slot.
const PANO_PATIENT_ID = 'l495wy5xncyxs21';

test('panoramic-only patient: every slot whose teeth the AI located gets a derived patch', async ({
	page
}) => {
	const ok = await seedPanoramicStudy(page, PANO_PATIENT_ID, 'seedpanostd0001', 'Pano FMX Patient');
	test.skip(!ok, 'test_images/pan.png not present');

	await page.goto(`/patients/${PANO_PATIENT_ID}`);
	// FMX grid is the X-rays tab default; wait for the slots to render.
	await expect(page.locator('button.slot').first()).toBeVisible();

	const slots = page.locator('button.slot');
	const total = await slots.count();
	expect(total).toBeGreaterThan(10);

	// One real pano in the central slot + N >= 10 derived patches in surrounding
	// slots. The patches are computed from the panoramic's NATURAL dimensions, so
	// they render a beat after the slots appear (once the image loads). Poll for
	// them rather than reading the count once — otherwise the assertion races the
	// image load and flakes when the page is under load.
	await expect
		.poll(
			() => slots.evaluateAll((els) => els.filter((e) => e.classList.contains('patch')).length),
			{ timeout: 10_000, message: 'most surrounding slots should be patches derived from the pano' }
		)
		.toBeGreaterThanOrEqual(10);

	const filled = await slots.evaluateAll(
		(els) => els.filter((e) => e.classList.contains('filled')).length
	);
	expect(filled, 'exactly the panoramic slot should be a real `filled` study').toBe(1);

	// A patch is interactive (clicking opens the source panoramic in the viewer).
	const firstPatch = page.locator('button.slot.patch').first();
	await expect(firstPatch).toBeEnabled();
	await firstPatch.click();
	await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/\/viewer\/[^/]+\/[^/]+$/);
});
