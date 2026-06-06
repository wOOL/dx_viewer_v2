import { test, expect } from '@playwright/test';

// Regression for the intermittent "I pick a file but it acts like I picked
// nothing" bug. The Browse <label> (wrapping the hidden <input type=file>) sits
// inside the dropzone <div onclick=activateDropzone>. A click on Browse used to
// dispatch a click on the input TWICE in one gesture — the label's native
// activation PLUS activateDropzone calling input.click() as the click bubbled to
// the div. Two opens in one gesture made the OS chooser's `change` drop
// intermittently, so the picked file failed to register ~1/3-1/2 of the time.
// The fix: activateDropzone ignores clicks originating on a nested
// label/input/button, so Browse dispatches exactly ONE input click.
//
// Measured the way upload-dropzone.e2e.ts does it: instrument the hidden input
// with a capturing click listener that counts and preventDefault()s (so no real
// OS dialog opens), click Browse, and assert the count is exactly 1 (pre-fix: 2).

test.describe('New Study file picker', () => {
	test('clicking Browse opens the file input exactly once (no double-open)', async ({ page }) => {
		await page.goto('/upload');
		await page.getByRole('button', { name: 'X-Ray', exact: true }).click();

		await page.evaluate(() => {
			const fi = document.querySelector(
				'div.dropzone input[type="file"]'
			) as HTMLInputElement | null;
			if (!fi) throw new Error('no file input');
			(window as unknown as { __clicks: number }).__clicks = 0;
			fi.addEventListener(
				'click',
				(e) => {
					(window as unknown as { __clicks: number }).__clicks++;
					e.preventDefault(); // don't open the real OS dialog
				},
				true
			);
		});

		await page.getByText('Browse files', { exact: true }).click();
		await page.waitForTimeout(300); // give any erroneous second dispatch time to fire

		const clicks = await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
		expect(clicks, 'Browse must dispatch exactly one file-input click').toBe(1);
	});

	test('an oversized file reports its size in the active locale (i18n-leak fix + $locale wiring)', async ({
		page
	}) => {
		// Pre-fix, formatBytes ignored the locale → a German UI still rendered the file size
		// as "40.5 MB" (en dot) in the too-large error. Drive a German UI + an oversized
		// FRACTIONAL-MB 2D file and assert the error reads "40,5 MB" (comma). This proves the
		// formatter fix AND that the active $locale is actually threaded from the upload page
		// into validateUploadFile (a type-checked but otherwise untested wiring). dxv:lang is
		// context-local localStorage, so it doesn't leak to other tests.
		await page.addInitScript(() => localStorage.setItem('dxv:lang', 'de'));
		await page.goto('/upload'); // default modality is xray (2D) → 40 MB cap, dropzone shown
		// 40.5 MB > the 40 MB 2D cap, and fractional so the decimal separator is visible.
		const bytes = Math.round(40.5 * 1024 * 1024);
		await page.locator('div.dropzone input[type="file"]').setInputFiles({
			name: 'huge.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(bytes)
		});
		// German decimal comma, never the en dot.
		await expect(page.getByText(/40,5\s*MB/)).toBeVisible();
		await expect(page.getByText(/40\.5\s*MB/)).toHaveCount(0);
	});

	test('clicking the bare dropzone still opens the file input', async ({ page }) => {
		await page.goto('/upload');
		await page.getByRole('button', { name: 'X-Ray', exact: true }).click();

		await page.evaluate(() => {
			const fi = document.querySelector(
				'div.dropzone input[type="file"]'
			) as HTMLInputElement | null;
			if (!fi) throw new Error('no file input');
			(window as unknown as { __clicks: number }).__clicks = 0;
			fi.addEventListener(
				'click',
				(e) => {
					(window as unknown as { __clicks: number }).__clicks++;
					e.preventDefault();
				},
				true
			);
		});

		const dz = page.locator('div.dropzone');
		const box = await dz.boundingBox();
		if (!box) throw new Error('no bbox');
		// Top area — the icon/text, well above the Browse label.
		await page.mouse.click(box.x + box.width / 2, box.y + 24);

		const clicks = await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);
		expect(clicks, 'a bare-dropzone click should still open the picker').toBe(1);
	});
});
