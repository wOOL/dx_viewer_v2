import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, readStudyReport, FINDING_COUNTS_2D } from './seed';

// The redesigned right panel: AI Analysis (grouped Diagnostic Results) ↔ Report tab
// (editable report + Acceptable/Unacceptable verdict + copy + download PDF). LOCAL-FIRST:
// report state now persists to IndexedDB (study_report_state mirror), so we seed the study
// and read the report state straight from IndexedDB (no PB; the fresh context is cleanup).
test.describe('2D right panel — Diagnostic Results + Report', () => {
	test.beforeEach(async ({ page }) => {
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'Report Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
	});

	test('Report tab: edit + Acceptable persist locally; copy + download available', async ({
		page
	}) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();

		await page.getByRole('tab', { name: 'Report' }).click();
		// Mark the radiograph Acceptable.
		await page.getByTestId('report-acceptable').click();
		// Edit the report with a unique marker, then Save.
		const marker = `E2E report edit ${Date.now()}`;
		await page.getByTestId('report-edit').click();
		await page.locator('.report-textarea').fill(marker);
		await page.getByTestId('report-save').click();

		// Both the verdict and the edited text persisted to the local study_report_state.
		await expect
			.poll(
				async () => {
					const rec = await readStudyReport(page, STUDIES.xray2d.study);
					return rec ? `${rec.status}|${rec.reportText}` : '';
				},
				{ timeout: 15_000 }
			)
			.toBe(`acceptable|${marker}`);

		// The edited text renders back, and Copy + Download are usable.
		await expect(page.getByText(marker)).toBeVisible();
		await expect(page.getByTestId('report-copy')).toBeEnabled();
		await expect(page.getByTestId('report-download')).toBeEnabled();
	});

	test('AI Analysis: groups expand to list individual findings with certainty', async ({
		page
	}) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas.pointer-events-none').first()).toBeVisible();
		// Diagnostic Results panel is the default (AI Analysis) tab.
		await expect(page.getByText('Diagnostic Results')).toBeVisible();
		// Expand the first group that has findings (its toggle is enabled).
		const group = page.locator('.grp-toggle:not(:disabled)').first();
		await group.click();
		// Individual finding rows appear with a certainty / author line.
		const rows = page.locator('.fi-main');
		await expect(rows.first()).toBeVisible();
		await expect(page.locator('.fi-cert').first()).toBeVisible();
	});

	test('toolbar tools are single-select and the ruler is gone', async ({ page }) => {
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await expect(page.locator('canvas').first()).toBeVisible();

		const magnify = page.getByRole('button', { name: 'Magnifier', exact: true });
		await magnify.click();
		await expect(magnify).toHaveAttribute('aria-pressed', 'true');
		// Selecting the rectangle draw tool must deselect the magnifier (single-select).
		await page.getByTestId('detect-add-rect').click();
		await expect(magnify).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByTestId('detect-add-rect')).toHaveAttribute('aria-pressed', 'true');

		// The Ruler tool was removed.
		await expect(page.getByRole('button', { name: 'Ruler / measurement' })).toHaveCount(0);
	});
});
