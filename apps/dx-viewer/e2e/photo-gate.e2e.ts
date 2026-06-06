import { test, expect, type Page } from '@playwright/test';
import { STUDIES } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The "Show Photos" account preference gates the intraoral-camera (Photo) modality
// everywhere (upload picker + the patient/viewer Photos tab). The demo account ships
// with it ON (so upload-photo.e2e.ts works); this spec drives it OFF, asserts the gate,
// then restores ON — with an afterAll that GUARANTEES it's left ON regardless of outcome.
test.describe.configure({ mode: 'serial' });

async function setToggle(page: Page, on: boolean) {
	await page.goto('/settings');
	const toggle = page.getByTestId('enable-photo-toggle');
	await expect(toggle).toBeVisible();
	if ((await toggle.isChecked()) !== on) {
		await toggle.click();
		// The change persists async (auth.setPhotoEnabled → PB update + authStore.save). The
		// checkbox is checked={auth.photoEnabled} (the gate source) and disabled while saving,
		// so wait for BOTH the checked state and re-enable before any caller navigates.
		await expect(toggle).toBeChecked({ checked: on });
		await expect(toggle).toBeEnabled();
		await expect.poll(async () => await toggle.isChecked(), { timeout: 10_000 }).toBe(on);
	}
}

test.describe('Show Photos account gate', () => {
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

	test('OFF hides the Photo modality + Photos tab; ON restores them', async ({ page }) => {
		// LOCAL-FIRST: seed a study so the patient page renders (the Photos tab shows from the
		// enablePhoto FLAG; the gating is flag-based, not data-based).
		await seedXrayStudies(page, [
			{
				patient: STUDIES.fmxPatient,
				study: 'seedphotogate01',
				patientName: 'Photo Gate Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		// Baseline ON: the upload picker offers Photo and the patient page shows a Photos tab.
		await setToggle(page, true);
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: 'Photo', exact: true })).toBeVisible();
		await page.goto(`/patients/${STUDIES.fmxPatient}`);
		await expect(page.locator('button.tab-pill', { hasText: /Photos/ })).toBeVisible();

		// Turn Photos OFF.
		await setToggle(page, false);

		// 1. Upload no longer offers the Photo modality.
		await page.goto('/upload');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Photo', exact: true })).toHaveCount(0);
		// X-ray remains.
		await expect(page.getByRole('button', { name: /X-Ray/i }).first()).toBeVisible();

		// 2. The patient record no longer shows the Photos tab.
		await page.goto(`/patients/${STUDIES.fmxPatient}`);
		await expect(page.locator('button.tab-pill', { hasText: /Photos/ })).toHaveCount(0);

		// Restore ON → the surfaces return.
		await setToggle(page, true);
		await page.goto('/upload');
		await expect(page.getByRole('button', { name: 'Photo', exact: true })).toBeVisible();
	});
});
