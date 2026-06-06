import { test, expect } from '@playwright/test';

// The "Labs" card (experimental modality opt-ins: Enable 3D / Show Photos / Panoramic) is
// shown ONLY when an admin has set labs_enabled on the user record. The demo account has it
// ON, so the card + its toggles render here. A normal user (labs_enabled false — the
// default) never sees the card; that gate is the {#if auth.labsEnabled} wrapper, asserted
// statically in settings.test.ts.
test('Labs card + experimental toggles render when labs_enabled is on', async ({ page }) => {
	await page.goto('/settings');
	await expect(page.getByTestId('sidebar')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Labs' })).toBeVisible();
	await expect(page.getByText('Enable experimental features for your account.')).toBeVisible();
	await expect(page.getByTestId('enable-3d-toggle')).toBeVisible();
	await expect(page.getByTestId('enable-photo-toggle')).toBeVisible();
	await expect(page.getByTestId('enable-panoramic-toggle')).toBeVisible();
});
