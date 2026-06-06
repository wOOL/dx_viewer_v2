import { test, expect } from '@playwright/test';
import { readAll } from './seed';

// Multi-file upload: a clinician picking an entire FMX (16+ films) at once used to be
// blocked because the file input had no `multiple` and the JS only read files[0]. Now each
// picked file becomes its own study under the SAME patient, and on completion we land on
// the patient page (FMX grid) rather than a single-study viewer. LOCAL-FIRST: studies write
// to IndexedDB, so we assert N studies under ONE patient there.

const TEST_IMAGE = '/home/yang/appv3/test_images/image2.jpg';
const TEST_IMAGE_B = '/home/yang/appv3/test_images/image1.jpg';

const STUB_INFERENCE = {
	result: null,
	report: '',
	detection: '',
	tooth_numbers: '',
	segmentation: '',
	extra: {
		disease_result: { result: { bboxes: [], labels: [], scores: [], masks: [] }, extra: {} },
		number_result: { result: { bboxes: [], labels: [], scores: [] }, extra: {} },
		anatomy_result: { result: { bboxes: [], labels: [], scores: [] }, extra: { anomaly: false } }
	}
};

test('multi-file X-ray upload: N picked files → N studies under ONE patient, land on patient page', async ({
	page
}) => {
	const handler = async (route: import('@playwright/test').Route) => {
		const u = route.request().url();
		if (u.includes('/api/ai/find_xray')) {
			await route.fulfill({
				json: { result: null, extra: { xrayfound: false, score: 0, width: 0, height: 0 } }
			});
		} else {
			await route.fulfill({ json: STUB_INFERENCE });
		}
	};

	try {
		await page.route('**/api/ai/**', handler);
		await page.goto('/upload');
		await page.getByRole('button', { name: 'X-Ray', exact: true }).click();

		// Pick TWO files — the input declares `multiple` for X-ray modality.
		await page.locator('input[type=file]').setInputFiles([TEST_IMAGE, TEST_IMAGE_B]);
		await page.locator('#pname').fill('E2E Multi Probe');

		// The action button now reads "Run analysis on 2 files".
		const runBtn = page.getByRole('button', { name: /Run analysis on 2 files/i });
		await expect(runBtn).toBeEnabled();
		await runBtn.click();

		// A multi-file X-ray batch lands on the patient page, not the per-study viewer.
		await page.waitForURL(/\/patients\/[a-z0-9]+/, { timeout: 40_000 });
		expect(page.url()).not.toMatch(/\/viewer\//);

		// IndexedDB: exactly ONE patient (the second file reused the first's patient) with
		// TWO X-ray studies.
		const patients = await readAll(page, 'patients');
		expect(patients.length).toBe(1);
		const studies = await readAll<{ modality: string }>(page, 'studies');
		expect(studies.length).toBe(2);
		expect(studies.every((s) => s.modality === 'xray')).toBe(true);
	} finally {
		await page.unroute('**/api/ai/**', handler);
	}
});
