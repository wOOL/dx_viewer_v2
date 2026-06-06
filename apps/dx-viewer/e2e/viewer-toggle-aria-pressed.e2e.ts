import { test, expect } from '@playwright/test';
import { STUDIES, url } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// The 2D viewer tool rail's TOGGLE buttons (Magnifier, Adjust, Tooth numbers,
// Anatomy) each render a `class:active` to show their on/off state visually and
// MUST also expose `aria-pressed` so a screen-reader user can tell the state.
// (The Ruler toggle was removed per the clinician feedback.)
const TOGGLES = [
	{ label: 'Magnifier' },
	{ label: 'Brightness / contrast / sharpness' },
	{ label: 'Tooth numbers' },
	{ label: 'Anatomy' }
];

test.describe('viewer toggle-button a11y', () => {
	test('every visual toggle in the tool rail exposes aria-pressed (off then on)', async ({
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

		for (const t of TOGGLES) {
			const btn = page.getByRole('button', { name: t.label, exact: true });
			await expect(btn, `${t.label}: expected to be visible`).toBeVisible();
			// Off state — must report aria-pressed=false (NOT null).
			const before = await btn.getAttribute('aria-pressed');
			expect(before, `${t.label}: aria-pressed missing in OFF state`).not.toBeNull();
			expect(['false', 'true']).toContain(before);
			// Click → on.
			await btn.click();
			await expect(btn, `${t.label}: aria-pressed must flip after click`).toHaveAttribute(
				'aria-pressed',
				before === 'true' ? 'false' : 'true'
			);
			// Click again → back to original.
			await btn.click();
			await expect(btn).toHaveAttribute('aria-pressed', before!);
		}
	});
});
