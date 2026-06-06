import { test, expect } from '@playwright/test';

// H5 regression guard: the New-Study upload page must reject an invalid file
// (here a 0-byte file) BEFORE the long encode + AI + upload round-trip, showing
// a specific localized reason in the error region and NOT queueing the file —
// so "Run analysis" stays disabled (an empty queue) and no upload is attempted.
//
// Auth comes from the shared storageState (project `setup` → storageState), same
// as the other e2e/upload*.e2e.ts specs; no real prod record is written because
// the file is rejected client-side before any network call.
//
// NOTE: the rejection copy uses the new i18n key `upload.errEmpty` (en: "That
// file is empty — choose a file with content."). Until that key is added
// centrally, svelte-i18n renders the raw key text; this test asserts on the
// error region appearing + the file not being queued, which holds either way.

test.describe('upload validation (H5)', () => {
	test('rejects a 0-byte file up front and does not queue it', async ({ page }) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (e) => pageErrors.push(e.message));

		await page.goto('/upload');
		// Default modality is X-ray; the file input accepts images.
		await page.getByRole('button', { name: 'X-Ray', exact: true }).click();
		await page.locator('#pname').fill('E2E Validation Patient');

		// A 0-byte PNG: passes extension/MIME detection but is empty.
		await page.locator('input[type=file]').setInputFiles({
			name: 'empty.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(0)
		});

		// The error region (role="alert") becomes visible with the empty-file
		// reason. Match the English copy OR the raw key, so it passes before/after
		// the i18n key is wired centrally.
		const alert = page.getByRole('alert');
		await expect(alert).toBeVisible();
		await expect(alert).toContainText(/empty|errEmpty/i);

		// The empty file was NOT added to the queue: no file name chip is shown and
		// the dropzone still prompts to drop a file.
		await expect(page.getByText('empty.png', { exact: true })).toHaveCount(0);

		// "Run analysis" stays disabled because the queue is empty (the button is
		// disabled whenever files.length === 0), i.e. no upload can be attempted.
		await expect(page.getByRole('button', { name: 'Run analysis', exact: true })).toBeDisabled();

		expect(pageErrors, `uncaught errors:\n${pageErrors.join('\n')}`).toEqual([]);
	});
});
