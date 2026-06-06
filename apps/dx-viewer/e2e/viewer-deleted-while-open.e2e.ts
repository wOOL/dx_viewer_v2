import { test, expect } from '@playwright/test';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Deleted-while-open: the local-first cross-tab change channel propagates another tab's
// delete into every open tab's projection. The viewer/patient routes used to check
// "entity exists" only in onMount, so a propagated delete flipped them onto their
// {:else} loading spinner FOREVER (an empty shell with no explanation). They must now
// LEAVE — the same redirect a bad URL gets — once the projection settles without the
// entity. Drives a REAL second tab in the same context (shared profile + BroadcastChannel
// scope), not a simulated event.

const PATIENT = 'delwhileopenpx1';
const STUDY = 'delwhileopensx1';

test('the 2D viewer leaves (not strands) when another tab deletes the study', async ({
	page,
	context
}) => {
	test.skip(!process.env.E2E_PASSWORD, 'needs an authenticated session');

	await page.goto('/studies');
	await seedXrayStudies(page, [
		{
			patient: PATIENT,
			study: STUDY,
			patientName: 'Deleted WhileOpen',
			findingCounts: FINDING_COUNTS_2D
		}
	]);
	await page.goto(`/viewer/${PATIENT}/${STUDY}`);
	await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });

	// "Another tab": a second page in the SAME browser context deletes the patient.
	const tab2 = await context.newPage();
	await tab2.goto(`/patients/${PATIENT}`);
	tab2.once('dialog', (d) => void d.accept());
	await tab2.getByTestId('patient-delete-btn').click();
	await tab2.waitForURL(/\/studies/, { timeout: 15_000 });

	// The change channel refreshes tab 1's projection → study gone → viewer redirects
	// instead of stranding on the spinner.
	await page.waitForURL(/\/studies/, { timeout: 15_000 });
	await tab2.close();
});
