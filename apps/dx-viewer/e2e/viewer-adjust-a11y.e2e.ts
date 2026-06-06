import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The 2D viewer's brightness/contrast/sharpness/saturation sliders rendered
// as `<input type="range">` with no aria-label. A focused range slider
// announces just "slider, 1" with no hint of which property it controls — a
// real screen-reader / keyboard a11y miss. Each slider must name itself.
test.describe('viewer adjust panel a11y', () => {
	test('every brightness/contrast/sharpness/saturation slider has an aria-label', async ({
		page
	}) => {
		await page.goto('/studies');
		await seedXrayStudies(page, [
			{
				patient: STUDIES.xray2d.patient,
				study: STUDIES.xray2d.study,
				patientName: 'Test Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(url.viewer2d(STUDIES.xray2d));
		await page.getByText('Test Patient').first().waitFor();
		await page.getByRole('button', { name: 'Brightness / contrast / sharpness' }).click();
		await expect(page.locator('input[type="range"]').first()).toBeVisible();

		const labels = await page
			.locator('input[type="range"]')
			.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
		// Every slider must have a non-empty aria-label, and they must be distinct.
		expect(
			labels.every((l) => !!l && l.trim().length > 0),
			`missing aria-labels: ${JSON.stringify(labels)}`
		).toBe(true);
		expect(
			new Set(labels).size,
			`slider aria-labels must be unique; got ${JSON.stringify(labels)}`
		).toBe(labels.length);
	});
});
