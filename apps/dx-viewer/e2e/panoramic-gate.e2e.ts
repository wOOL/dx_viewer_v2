import { test, expect, type Page } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The "Panoramic" account preference gates the panoramic upload modality AND the FMX
// (full-mouth series) view — without panoramic there is no FMX. The demo account ships
// with it ON; this spec drives it OFF, asserts both gates, then restores ON (afterAll
// GUARANTEES it's left ON regardless of outcome).
test.describe.configure({ mode: 'serial' });

async function setToggle(page: Page, on: boolean) {
	await page.goto('/settings');
	const toggle = page.getByTestId('enable-panoramic-toggle');
	await expect(toggle).toBeVisible();
	if ((await toggle.isChecked()) !== on) {
		await toggle.click();
		await expect(toggle).toBeChecked({ checked: on });
		await expect(toggle).toBeEnabled();
		await expect.poll(async () => await toggle.isChecked(), { timeout: 10_000 }).toBe(on);
	}
}

test.describe('Panoramic account gate', () => {
	test.afterAll(async ({ browser }) => {
		const ctx = await browser.newContext({ storageState: 'e2e/.auth/state.json' });
		const page = await ctx.newPage();
		try {
			await setToggle(page, true);
		} catch {
			/* best effort */
		} finally {
			await ctx.close();
		}
	});

	test('OFF hides the Panoramic modality + disables FMX; ON restores them', async ({ page }) => {
		// LOCAL-FIRST: seed the 2D study so the viewer mounts (the FMX toggle is flag-gated).
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'Pano Gate Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		// Baseline ON: upload offers Panoramic and the viewer shows the FMX toggle.
		await setToggle(page, true);
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: 'Panoramic', exact: true })).toBeVisible();
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await expect(page.getByText('FMX', { exact: true })).toBeVisible();

		// Turn Panoramic OFF.
		await setToggle(page, false);

		// 1. Upload no longer offers the Panoramic modality.
		await page.goto('/upload');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Panoramic', exact: true })).toHaveCount(0);

		// 2. The viewer no longer shows the FMX toggle (FMX disabled with no panoramic).
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();
		await expect(page.getByText('FMX', { exact: true })).toHaveCount(0);

		// Restore ON → both return.
		await setToggle(page, true);
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: 'Panoramic', exact: true })).toBeVisible();
	});
});
