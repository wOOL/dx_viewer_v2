import { test, expect } from '@playwright/test';
import { readAll } from './seed';

// A "Photo" upload (modality 'photo') is a plain camera image: it must NOT hit the AI
// inference endpoints (so it's never paywalled), and must land on the patient's Photos
// tab. LOCAL-FIRST: the study is written to IndexedDB, so we assert it landed there with
// modality 'photo' and that no AI call was made.

const TEST_IMAGE = '/home/yang/appv3/test_images/image2.jpg';

test('a Photo upload stores the image with no AI inference and lands on the Photos tab', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	let aiHit = false;
	const handler = async (route: import('@playwright/test').Route) => {
		aiHit = true; // a photo must never reach inference / find_xray
		await route.fulfill({ json: {} });
	};

	try {
		await page.route('**/api/ai/**', handler);
		await page.goto('/upload');

		// Pick the Photo modality (exact so it doesn't match the "Photos" tab elsewhere).
		await page.getByRole('button', { name: 'Photo', exact: true }).click();
		await page.locator('#pname').fill('E2E Camera Probe');
		await page.locator('input[type=file]').setInputFiles(TEST_IMAGE);

		// The action button is photo-specific ("Save photo", not "Run analysis").
		const save = page.getByRole('button', { name: 'Save photo' });
		await expect(save).toBeEnabled();
		await save.click();

		// Lands on the patient's Photos tab (only the photo branch navigates here).
		await page.waitForURL(/\/patients\//, { timeout: 30_000 });
		expect(page.url()).toContain('tab=photos');
		await expect(page.getByRole('button', { name: /Photos \(/ })).toBeVisible();

		// The defining property: photos never touch the AI service (free, no paywall).
		expect(aiHit).toBe(false);
		// Persisted locally with the photo modality.
		const studies = await readAll<{ modality: string }>(page, 'studies');
		expect(studies.length).toBe(1);
		expect(studies[0]!.modality).toBe('photo');

		expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
	} finally {
		await page.unroute('**/api/ai/**', handler);
	}
});
