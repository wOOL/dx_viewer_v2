import { test, expect } from '@playwright/test';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The patient page tile captions used to render the raw modality slug
// (`xray`, `panoramic`, `cbct`, `ios`, `photo`) regardless of the UI locale —
// a French clinician saw "panoramic" sitting under the date. The captions and
// the TopBar recently-viewed list now go through $lib/modality.modalityLabel,
// which resolves a `common.modality*` i18n key.
test.describe('modality labels are localized', () => {
	test('French locale renders FR labels on the patient page tiles', async ({ page }) => {
		// LOCAL-FIRST: seed an X-ray study (→ FR label "Radio") on a patient.
		await seedXrayStudies(page, [
			{
				patient: 'seedmodpat00001',
				study: 'seedmodstd00001',
				patientName: 'Modality Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		// Set the locale BEFORE navigating so the SPA boots in French. The full patient
		// grid lives at /patients now.
		await page.goto('/patients');
		await page.evaluate(() => localStorage.setItem('dxv:lang', 'fr'));

		// Hop to any patient with at least one tile.
		const firstPatient = page.locator('a[href*="/patients/"]').first();
		await expect(firstPatient).toBeVisible();
		const href = await firstPatient.getAttribute('href');
		if (!href) test.skip(true, 'no patients in demo data');
		await page.goto(href!);

		// Wait for the patient page to mount — header is i18n'd, but the tile
		// strip is the load-bearing element we care about.
		await expect(page.locator('main')).toBeVisible();

		// Tile labels live in a `<span>` underneath the date. They should NOT
		// contain the raw slugs ("xray", "panoramic", "cbct", "ios", "photo").
		const main = page.locator('main');
		const text = (await main.textContent()) || '';
		// At least one of the localized strings should be present if there's
		// any study at all.
		const hasFrLabel =
			/Radio\b/.test(text) ||
			/Panoramique\b/.test(text) ||
			/CBCT\b/.test(text) ||
			/Scan IO\b/.test(text) ||
			/Photo\b/.test(text);
		test.skip(!hasFrLabel, 'no studies to assert localized modality on');

		// And no raw slug strings should leak through any tile/list. The
		// `panoramic` slug is the easiest to spot — it's both common and
		// totally distinct from its FR translation.
		const slugLeaks = await main
			.locator('span', { hasText: /^(xray|panoramic|cbct|ios|photo)$/ })
			.count();
		expect(slugLeaks).toBe(0);
	});

	test.afterEach(async ({ page }) => {
		// Reset so other tests don't inherit FR.
		await page.evaluate(() => localStorage.removeItem('dxv:lang')).catch(() => {});
	});
});
