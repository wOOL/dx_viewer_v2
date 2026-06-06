import { test, expect } from '@playwright/test';
import { STUDIES } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The patient-page capture-date filter bucketed studies by their UTC date but labelled
// the buckets by re-parsing the date string as UTC midnight, so west of UTC the filter
// label drifted a day off the study tiles (which show the capturedAt timestamp in local
// time). Ryan's 18 studies are all 2026-05-22 ~13:18Z → in Los Angeles the tiles read
// "May 22, 2026" but the filter menu read "May 21, 2026" pre-fix. Emulate that timezone
// (the UTC dev/prod box can't reproduce it — #53 vein) and assert the filter is now
// consistent with the local capture date.
test.use({ timezoneId: 'America/Los_Angeles' });

test('capture-date filter labels match the local capture date in a non-UTC timezone (#53 vein)', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	// LOCAL-FIRST: seed a study captured 2026-05-22 13:18Z (→ May 22 local in LA).
	await seedXrayStudies(page, [
		{
			patient: STUDIES.fmxPatient,
			study: 'seeddatestd0001',
			patientName: 'Date Patient',
			capturedAt: '2026-05-22T13:18:00.000Z',
			findingCounts: FINDING_COUNTS_2D
		}
	]);
	await page.goto(`/patients/${STUDIES.fmxPatient}`);

	// The date-filter button (header, the only aria-expanded control) shows the local
	// capture date when nothing is selected.
	const dateBtn = page.locator('header button[aria-expanded]');
	await expect(dateBtn).toBeVisible();
	await expect(dateBtn).toContainText('May 22, 2026');

	// Open the menu; the capture-date item must read the SAME local day as the tiles,
	// not the UTC-midnight day-before.
	await dateBtn.click();
	const menu = page.locator('div.z-50');
	await expect(menu).toBeVisible();
	await expect(menu).toContainText('May 22, 2026'); // local capture date (post-fix)
	await expect(menu).not.toContainText('May 21, 2026'); // the pre-fix off-by-one-day label

	expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
});
