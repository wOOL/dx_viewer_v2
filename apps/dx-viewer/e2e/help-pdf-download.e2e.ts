import { test, expect } from '@playwright/test';

// The 4 manual PDFs (en/fr/es/de) are committed at repo root /manual/ AND copied to
// fe/static/manual/, but there was no UI link to them — 88 MB of PDFs the user
// could never reach. Help page now exposes a per-locale "Download this manual as
// PDF" link; this guard confirms it deploys, fetches, and a JSON-headed HEAD
// returns 200 + application/pdf.
test.describe('Help page → PDF download', () => {
	test('the PDF download link is visible, points at /manual/dx-viewer-manual-en.pdf, and the file 200s', async ({
		page,
		request
	}) => {
		await page.goto('/help');
		const link = page.getByTestId('manual-pdf-download');
		await expect(link).toBeVisible();
		const href = await link.getAttribute('href');
		expect(href).toMatch(/\/manual\/dx-viewer-manual-en\.pdf(\?v=\w+)?$/);
		// Resolve to absolute URL and HEAD it — must serve as PDF.
		const url = new URL(href!, page.url()).toString();
		const r = await request.head(url);
		expect(r.status(), `manual PDF HEAD ${url} → ${r.status()}`).toBe(200);
		expect(r.headers()['content-type'] ?? '').toMatch(/pdf/i);
	});

	test('switching to French swaps the link to the FR manual', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('dxv:lang', 'fr'));
		await page.goto('/help');
		const link = page.getByTestId('manual-pdf-download');
		await expect(link).toBeVisible();
		const href = await link.getAttribute('href');
		expect(href).toMatch(/\/manual\/dx-viewer-manual-fr\.pdf(\?v=\w+)?$/);
	});
});
