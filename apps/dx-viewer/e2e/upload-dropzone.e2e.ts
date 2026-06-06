import { test, expect } from '@playwright/test';

// The /upload dropzone renders as `<div role="button" tabindex="0">` but had
// no click or keydown handler — only the inner "Browse files" <label> opened
// the picker. Clicking the dropzone center (or pressing Enter while focused)
// did nothing, contradicting the role/tabindex contract.
test.describe('upload dropzone', () => {
	test('clicking the dropzone (not the Browse label) triggers the file input', async ({ page }) => {
		await page.goto('/upload');
		await page.getByRole('button', { name: 'X-Ray' }).click();

		// Instrument the hidden file input so we can observe activation.
		await page.evaluate(() => {
			const fi = document.querySelector(
				'div.dropzone input[type="file"]'
			) as HTMLInputElement | null;
			if (!fi) throw new Error('no file input');
			(window as unknown as { __pickerClicks: number }).__pickerClicks = 0;
			fi.addEventListener(
				'click',
				(e) => {
					(window as unknown as { __pickerClicks: number }).__pickerClicks++;
					// Prevent the real OS dialog from opening — we're proving the wiring, not picking.
					e.preventDefault();
				},
				true
			);
		});

		// Click the icon/text area of the dropzone (NOT the Browse <label>).
		const dz = page.locator('div.dropzone');
		const box = await dz.boundingBox();
		if (!box) throw new Error('no bbox');
		// Top quarter — well above the Browse label, on the icon/text.
		await page.mouse.click(box.x + box.width / 2, box.y + 30);

		expect(
			await page.evaluate(() => (window as unknown as { __pickerClicks: number }).__pickerClicks)
		).toBeGreaterThan(0);
	});

	test('keyboard activation (Enter on focused dropzone) triggers the file input', async ({
		page
	}) => {
		await page.goto('/upload');
		await page.getByRole('button', { name: 'X-Ray' }).click();

		await page.evaluate(() => {
			const fi = document.querySelector(
				'div.dropzone input[type="file"]'
			) as HTMLInputElement | null;
			if (!fi) throw new Error('no file input');
			(window as unknown as { __pickerClicks: number }).__pickerClicks = 0;
			fi.addEventListener(
				'click',
				(e) => {
					(window as unknown as { __pickerClicks: number }).__pickerClicks++;
					e.preventDefault();
				},
				true
			);
		});

		await page.locator('div.dropzone').focus();
		await page.keyboard.press('Enter');
		expect(
			await page.evaluate(() => (window as unknown as { __pickerClicks: number }).__pickerClicks)
		).toBeGreaterThan(0);
	});
});
