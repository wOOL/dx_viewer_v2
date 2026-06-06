import { test, expect } from '@playwright/test';

// The Settings "Measurement unit" control was an orphaned setting (#15 sibling):
// it persisted dxv:measurementUnit but nothing consumed it. It's now a disabled +
// explained row and the dead key is no longer written (and stale values dropped).
// localStorage-only — no prod mutation.

test('measurement-unit control is disabled + explained (orphaned setting #15 sibling)', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/settings');
	await expect(page.getByText('Measurement unit')).toBeVisible();
	await expect(page.getByText('N/A for 2D')).toBeVisible();

	// Both unit buttons are present but disabled (the feature is N/A for 2D).
	await expect(page.getByRole('button', { name: 'Millimeters' })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Percentage' })).toBeDisabled();

	// The live preferences are still interactive (sanity that we didn't disable everything).
	await expect(page.getByRole('button', { name: 'Universal (1–32)' })).toBeEnabled();

	expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
});

test('does not persist the dead dxv:measurementUnit key, and cleans up a stale value', async ({
	page
}) => {
	await page.goto('/settings');
	// Seed a stale value as a previous build would have written.
	await page.evaluate(() => localStorage.setItem('dxv:measurementUnit', '%'));
	// Reload → constructing the shared prefs store removes the dead key (the
	// cleanup moved from the Settings mount $effect into the prefs store ctor),
	// and nothing ever re-writes it.
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('dxv:measurementUnit')))
		.toBeNull();

	// A live preference is NOT written on mount anymore (the mount-time write-back
	// $effect was removed to fix the cross-tab clobber — S2-#1). It's written ONLY
	// when the user changes a control. Prove writes still happen on interaction:
	// flip tooth-numbering to FDI and assert it persisted.
	await page.getByRole('button', { name: /^FDI/ }).click();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('dxv:toothNumbering')))
		.toBe('fdi');
});
