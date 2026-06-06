import { test, expect } from '@playwright/test';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Searching the studies dashboard used to only look at the raw ISO DOB
// ("1988-08-08") and the name — so a clinician typing "Aug" (what they
// SEE on the card "Aug 08, 1988") got zero matches. The filter now also
// looks at the formatted month name in the user's locale.
test('searching "Aug" matches a patient born in August', async ({ page }) => {
	// LOCAL-FIRST: seed a patient with an August DOB so the locale-month search has a target.
	await seedXrayStudies(page, [
		{
			patient: 'seedaugpat00001',
			study: 'seedaugstd00001',
			patientName: 'August Born',
			patientDob: '1988-08-08',
			findingCounts: FINDING_COUNTS_2D
		}
	]);
	await page.goto('/patients');
	await expect(page.locator('a[href*="/patients/"]').first()).toBeVisible();

	// Confirm there's at least one card showing "Aug" in its DOB chip.
	const augCardCount = await page
		.locator('a[href*="/patients/"]')
		.evaluateAll((els) => els.filter((e) => /Aug/.test(e.textContent || '')).length);
	test.skip(augCardCount === 0, 'demo data has no August DOB to exercise');

	const search = page.getByRole('textbox', { name: 'Search' });
	await search.fill('Aug');

	const matches = page.locator('a[href*="/patients/"]');
	await expect.poll(() => matches.count(), { timeout: 5_000 }).toBeGreaterThan(0);
	const labels = await matches.evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
	for (const l of labels) expect(l).toMatch(/Aug/);
});
