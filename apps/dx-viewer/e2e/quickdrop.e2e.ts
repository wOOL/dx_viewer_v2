import { test, expect } from '@playwright/test';

// One-click drag-to-analyze: the global drop overlay must appear when a FILE is
// dragged anywhere in the app, and be suppressed on /upload (whose form owns the
// drop). The full drop→analyze→navigate path mutates prod data + runs AI, so it
// is covered by the detectModality unit test + the upload-flow E2E instead; here
// we only exercise the overlay UX (no file is actually dropped).

test.describe('one-click drag-to-analyze overlay', () => {
	test('appears while a file is dragged over the app and clears on leave', async ({ page }) => {
		await page.goto('/studies');
		// The drop listener lives in the (app) shell's ready-gated block — wait for the
		// shell (sidebar) to mount before simulating the drag, or it races the mount.
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await expect(page.getByTestId('quickdrop-overlay')).toHaveCount(0);

		// Simulate a native file drag entering the window.
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['x'], 'scan.png', { type: 'image/png' }));
			window.dispatchEvent(
				new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		});
		await expect(page.getByTestId('quickdrop-overlay')).toBeVisible();
		await expect(page.getByText('Drop to analyze')).toBeVisible();

		// Leaving the window clears the overlay.
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['x'], 'scan.png', { type: 'image/png' }));
			window.dispatchEvent(
				new DragEvent('dragleave', { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		});
		await expect(page.getByTestId('quickdrop-overlay')).toHaveCount(0);
	});

	test('is suppressed on the New-Study page (its own form handles drops)', async ({ page }) => {
		await page.goto('/upload');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.items.add(new File(['x'], 'scan.png', { type: 'image/png' }));
			window.dispatchEvent(
				new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })
			);
		});
		// Give the overlay a chance to (incorrectly) appear, then assert it didn't.
		await page.waitForTimeout(300);
		await expect(page.getByTestId('quickdrop-overlay')).toHaveCount(0);
	});
});

test.describe('Ctrl+V paste-to-analyze', () => {
	test('Ctrl+V with no valid file opens the screen-capture picker', async ({ page }) => {
		// Stub the screen-capture API so headless Chromium has it; record the call and
		// simulate the user dismissing the picker (mutation-free — no frame analyzed).
		await page.addInitScript(() => {
			const md = navigator.mediaDevices;
			if (md) {
				md.getDisplayMedia = async () => {
					document.documentElement.setAttribute('data-gdm-called', '1');
					const err = new Error('cancelled');
					err.name = 'NotAllowedError';
					throw err;
				};
			}
		});
		await page.goto('/studies');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		// A text-only clipboard (no image/3D file) → the handler opens screen capture.
		await page.evaluate(() => {
			const dt = new DataTransfer();
			dt.setData('text/plain', 'hello');
			window.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			);
		});
		await expect(page.locator('html[data-gdm-called="1"]')).toHaveCount(1);
		// User dismissed the picker → nothing left running, no stuck overlay.
		await expect(page.getByTestId('quickdrop-overlay')).toHaveCount(0);
	});

	test('pasting a file while a text field is focused is ignored', async ({ page }) => {
		await page.goto('/studies');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		await page.evaluate(() => {
			const el = document.querySelector('input[type="text"]') as HTMLElement | null;
			el?.focus();
			const dt = new DataTransfer();
			dt.items.add(new File(['x'], 'scan.png', { type: 'image/png' }));
			el?.dispatchEvent(
				new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
			);
		});
		await page.waitForTimeout(300);
		await expect(page.getByTestId('quickdrop-overlay')).toHaveCount(0);
	});
});
