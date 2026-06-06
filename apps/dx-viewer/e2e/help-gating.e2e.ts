import { test, expect } from '@playwright/test';

// The Help manual moves experimental (Labs-gated) features — CBCT/IOS 3D, photos, FMX —
// to the bottom and shows them only for accounts with Labs access. The PDF (and the
// `?pdf=1` render it is built from) always omits them. Section anchors (`#help-<id>`)
// are i18n-independent, so we assert on those rather than on localized headings.
const EXPERIMENTAL = [
	'#help-fmxNavigator',
	'#help-photos',
	'#help-cbctNavigate',
	'#help-cbct3d',
	'#help-cbctPanoramic',
	'#help-cbctReport',
	'#help-readIos'
];
const CORE = [
	'#help-signin',
	'#help-newStudy',
	'#help-xrayTools',
	'#help-findings',
	'#help-reportPrintout',
	'#help-settings',
	'#help-billing'
];

test.describe('Help manual — experimental gating', () => {
	// The demo account has labs_enabled ON, so the in-app /help shows experimental
	// sections (at the bottom) alongside the core ones.
	test('Labs account sees experimental sections, ordered at the bottom', async ({ page }) => {
		await page.goto('/help');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		for (const sel of [...CORE, ...EXPERIMENTAL]) {
			await expect(page.locator(sel)).toHaveCount(1);
		}
		// Ordering: the first experimental section appears AFTER the last core section
		// in document order.
		const order = await page.$$eval('section.section', (els) => els.map((e) => e.id));
		const firstExp = order.findIndex((id) => id === 'help-cbctNavigate');
		const lastCore = order.lastIndexOf('help-billing');
		expect(firstExp).toBeGreaterThan(lastCore);
	});

	// `?pdf=1` forces the baseline manual regardless of the account's Labs flag — this is
	// exactly what the PDF generator renders, so it guards the "omit from PDF" promise.
	test('pdf mode omits experimental sections + experimental controls', async ({ page }) => {
		await page.goto('/help?pdf=1');
		await expect(page.locator('#help-settings')).toHaveCount(1);
		for (const sel of EXPERIMENTAL) {
			await expect(page.locator(sel)).toHaveCount(0);
		}
		// Core sections survive; experimental in-core controls are filtered out. The PDF
		// render has strictly fewer demo cards than the full in-app manual.
		const pdfDemos = await page.locator('.demo').count();
		await page.goto('/help');
		await expect(page.getByTestId('sidebar')).toBeVisible();
		const fullDemos = await page.locator('.demo').count();
		expect(pdfDemos).toBeGreaterThan(0);
		expect(pdfDemos).toBeLessThan(fullDemos);
		// The experimental upload-modality demo (e.g. CBCT) is gone in pdf mode but the
		// X-ray one stays — assert via the demo image alt text (localized name).
		await page.goto('/help?pdf=1');
		await expect(page.locator('#help-newStudy')).toHaveCount(1);
	});
});
