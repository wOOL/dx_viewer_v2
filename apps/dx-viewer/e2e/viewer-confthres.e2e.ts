import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// #101: a corrupted (non-numeric) dxv:confThres parses to NaN, and every
// `score >= NaN` is false → the AI overlay silently draws nothing and the panel
// reads "0 findings detected". The guarded reader ($lib/prefs) falls back to the
// default, so the viewer stays functional. Seed garbage before the page mounts.
test('a corrupted confidence-threshold setting does not blank the findings (#101)', async ({
	page
}) => {
	await page.addInitScript(() => localStorage.setItem('dxv:confThres', 'garbage'));

	await page.goto('/studies');
	await seedXrayStudies(page, [
		{
			patient: STUDIES.xray2d.patient,
			study: STUDIES.xray2d.study,
			patientName: 'Test Patient',
			findingCounts: FINDING_COUNTS_2D
		}
	]);
	await page.goto(url.viewer2d(STUDIES.xray2d));
	await expect(page.locator('canvas').first()).toBeVisible();

	// The inference blob now loads lazily (studies.ensureInference on mount); the
	// count populates reactively a beat later, so poll THROUGH that fetch window.
	// A real, non-zero count is the direct #101 proof: pre-fix the NaN threshold
	// makes this read "0 findings detected"; with the guard it reads a real count.
	// Match the COUNT line specifically (leading digit) so the empty-state copy
	// ("No findings detected.") doesn't make the locator ambiguous.
	const detected = page.getByText(/\d+ findings detected/);
	await expect(detected).toBeVisible();
	await expect
		.poll(async () => (await detected.textContent()) ?? '', {
			timeout: 30_000,
			message: 'findings stayed at "0 findings detected" (corrupted threshold blanked them)'
		})
		.toMatch(/[1-9]\d* findings detected/);
});
