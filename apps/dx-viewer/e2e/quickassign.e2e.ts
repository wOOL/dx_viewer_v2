import { test, expect } from '@playwright/test';
import { seedXrayStudies, readAll, FINDING_COUNTS_2D } from './seed';

// The quick-analyze flow files a scan under a temporary patient (quick:true). The
// QuickAssignBanner then offers to name it, merge it into an existing patient, or keep
// it. LOCAL-FIRST: quick patients live in IndexedDB, so we seed one there and exercise
// the banner; the fresh per-test context is the cleanup (net mutation-free).

test.describe('quick-study assignment banner', () => {
	test('"Name it" saves a real name + DOB and clears the banner', async ({ page }) => {
		await seedXrayStudies(page, [
			{
				patient: 'qassignname001',
				study: 'qassignstd0001',
				patientName: 'ZZ QuickName E2E',
				quick: true,
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(`/patients/qassignname001`);
		const banner = page.getByTestId('quick-assign-banner');
		await expect(banner).toBeVisible();
		await banner.getByTestId('qa-name').click();

		// "Name it" form: name input + dob input + Save.
		await banner.locator('input[type="text"]').fill('Real Patient Name');
		await banner.locator('input[type="date"]').fill('1985-06-15');
		await banner.getByRole('button', { name: 'Save' }).click();

		// Banner disappears (quick flag cleared) and the header shows the new name.
		await expect(banner).toHaveCount(0);
		await expect(page.getByText('Real Patient Name')).toBeVisible();
	});

	test('a quick patient shows the assign banner; "Keep as-is" clears it', async ({ page }) => {
		await seedXrayStudies(page, [
			{
				patient: 'qassignkeep001',
				study: 'qassignstd0002',
				patientName: 'ZZ QuickAssign E2E',
				quick: true,
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(`/patients/qassignkeep001`);
		const banner = page.getByTestId('quick-assign-banner');
		await expect(banner).toBeVisible();
		await expect(banner.getByTestId('qa-name')).toBeVisible();
		await expect(banner.getByTestId('qa-existing')).toBeVisible();

		// Keep as-is → clears quick → banner removed from the DOM.
		await banner.getByTestId('qa-keep').click();
		await expect(banner).toHaveCount(0);
	});

	// Merging is destructive (moves studies + deletes the quick patient). Dismissing the
	// confirm dialog must NOT merge — the quick patient survives.
	test('"Add to existing" merge is guarded by a confirm — dismiss keeps the patient', async ({
		page
	}) => {
		await seedXrayStudies(page, [
			{
				patient: 'qmergetarget01',
				study: 'qmergestd00001',
				patientName: 'ZZ Merge Target E2E',
				quick: false,
				findingCounts: FINDING_COUNTS_2D
			},
			{
				patient: 'qmergesource01',
				study: 'qmergestd00002',
				patientName: 'ZZ Merge Source E2E',
				quick: true,
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(`/patients/qmergesource01`);
		const banner = page.getByTestId('quick-assign-banner');
		await expect(banner).toBeVisible();
		await banner.getByTestId('qa-existing').click();

		// Pick the target in the existing-patient list.
		await banner.getByText('ZZ Merge Target E2E').click();

		// DISMISS the confirm dialog → the merge must be cancelled.
		page.once('dialog', (d) => d.dismiss());
		await banner.getByRole('button', { name: 'Assign' }).click();

		// Still on the quick patient's page, banner still present (no merge happened),
		// and the source patient still exists locally.
		await expect(page).toHaveURL(/qmergesource01/);
		await expect(banner).toBeVisible();
		const patients = await readAll<{ id: string }>(page, 'patients');
		expect(patients.some((p) => p.id === 'qmergesource01')).toBe(true);
	});
});
