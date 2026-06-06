import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The 2D viewer's FMX navigator: a mini full-mouth map that marks which frame you're
// viewing, expands on hover, and opens another frame on click. It renders when the patient
// has >1 X-ray (and the user is panoramic-enabled — the demo account is).
// LOCAL-FIRST: seed two X-rays under the patient, each tagged with an explicit fmxSlot so
// they deterministically land in distinct slots (assignStudiesToSlots: explicit tags win).
// The current study occupies one slot (aria-current) and the sibling fills another (the
// click target). No panoramic is seeded, so there are no derived patches — just two real
// filled cells.
const SIBLING = 'seedfmxnav00001';

test('FMX navigator marks the current frame, expands on hover, and navigates on click', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/studies');
	await seedXrayStudies(page, [
		{
			patient: STUDIES.xray2d.patient,
			study: SIBLING,
			patientName: 'Test Patient',
			fmxSlot: 'pa-ul-mol',
			findingCounts: FINDING_COUNTS_2D
		},
		{
			patient: STUDIES.xray2d.patient,
			study: STUDIES.xray2d.study,
			patientName: 'Test Patient',
			fmxSlot: 'pa-ur-mol',
			findingCounts: FINDING_COUNTS_2D
		}
	]);

	await page.goto(url.viewer2d(STUDIES.xray2d));
	await expect(page.locator('canvas').first()).toBeVisible();

	const nav = page.getByRole('group', { name: 'Full-mouth series navigator' });
	await expect(nav).toBeVisible();
	// "You are here": exactly one frame is marked current.
	await expect(nav.locator('[aria-current="true"]')).toHaveCount(1);

	const original = page.url();
	// Hover to expand to thumbnails, then open the other populated frame (the sibling slot).
	await nav.hover();
	const other = nav.locator('.cell.filled:not(.current)').first();
	await expect(other).toBeVisible();
	await other.click();

	await expect.poll(() => page.url(), { timeout: 10_000 }).not.toBe(original);
	expect(page.url()).toContain(`/viewer/${STUDIES.xray2d.patient}/`);

	expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
});
