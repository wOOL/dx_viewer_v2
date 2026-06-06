import { test, expect } from '@playwright/test';
import { STUDIES } from './helpers';
import { seedXrayStudies, FINDING_COUNTS_2D } from './seed';

// Patient page X-rays / 3D / Photos tab-pills are pressed-style buttons (one
// `class:active` at a time) but never set aria-pressed. A screen-reader user
// can't tell which tab is active.
test.describe('patient page tab-pills a11y', () => {
	test('X-rays + Photos tabs (and 3D if present) expose aria-pressed', async ({ page }) => {
		// LOCAL-FIRST: seed a study so the patient page + its tab-pills render.
		await seedXrayStudies(page, [
			{
				patient: STUDIES.fmxPatient,
				study: 'seedtabsstd0001',
				patientName: 'Tabs Patient',
				findingCounts: FINDING_COUNTS_2D
			}
		]);
		await page.goto(`/patients/${STUDIES.fmxPatient}`);
		// Wait for tabs to render.
		await expect(page.getByRole('button', { name: /X-rays/i })).toBeVisible();

		const tabs = page.locator('button.tab-pill');
		const count = await tabs.count();
		expect(count).toBeGreaterThanOrEqual(2);

		const states = await tabs.evaluateAll((nodes) =>
			nodes.map((n) => ({
				label: (n.textContent || '').replace(/\s+/g, ' ').trim(),
				ariaPressed: n.getAttribute('aria-pressed'),
				active: n.classList.contains('active')
			}))
		);
		// Every tab must report aria-pressed (true/false), not null.
		for (const s of states) {
			expect(s.ariaPressed, `tab "${s.label}" missing aria-pressed`).not.toBeNull();
			expect(['true', 'false']).toContain(s.ariaPressed);
			// And the value must match the visual `active` class.
			expect(s.ariaPressed === 'true').toBe(s.active);
		}
		// Exactly one tab is active.
		expect(states.filter((s) => s.ariaPressed === 'true').length).toBe(1);
	});
});
