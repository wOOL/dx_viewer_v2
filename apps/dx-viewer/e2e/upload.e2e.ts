import { test, expect } from '@playwright/test';
import { readAll } from './seed';

// Regression guard for the countFindings #68/#40 hardening: a PARTIAL AI inference
// (disease_result present, number_result missing) must still let the upload save the
// study. countFindings() runs as an argument to studies.addStudy() AFTER the patient is
// created, so before the fix it threw on the missing number_result → addStudy never ran →
// an orphaned 0-study patient + a discarded inference. LOCAL-FIRST: the study now persists
// to IndexedDB, so we mock only the AI calls and assert the study landed locally.
//
// (The old "#96 orphan on a study-save 413" companion test is obsolete: local studies don't
// hit the nginx 100MB cap — they save to IndexedDB regardless of size — so that failure mode
// no longer exists. The orphan-cleanup-on-save-failure logic is covered by the store unit
// tests, studies.findorcreate / studies.addstudy.)

const TEST_IMAGE = '/home/yang/appv3/test_images/image2.jpg';

// disease_result present, number_result ABSENT — the exact shape that made the old
// `inf.extra.number_result.result.labels.length` access throw.
const PARTIAL_INFERENCE = {
	result: null,
	report: '',
	detection: '',
	tooth_numbers: '',
	segmentation: '',
	extra: {
		disease_result: {
			result: { bboxes: [[10, 10, 40, 40]], labels: [1], scores: [0.91], masks: [null] },
			extra: {}
		}
	}
};

test('upload survives a partial AI inference (countFindings does not throw → study saved locally)', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	let inferenceHit = false;
	const handler = async (route: import('@playwright/test').Route) => {
		const u = route.request().url();
		if (u.includes('/api/ai/find_xray')) {
			await route.fulfill({
				json: { result: null, extra: { xrayfound: false, score: 0, width: 0, height: 0 } }
			});
		} else if (u.includes('/api/ai/inference')) {
			inferenceHit = true;
			await route.fulfill({ json: PARTIAL_INFERENCE });
		} else {
			await route.continue();
		}
	};

	try {
		await page.route('**/api/ai/**', handler);
		await page.goto('/upload');

		await page.locator('#pname').fill('E2E Partial Inference Probe');
		await page.locator('input[type=file]').setInputFiles(TEST_IMAGE);

		const run = page.getByRole('button', { name: 'Run analysis' });
		await expect(run).toBeEnabled();
		await run.click();

		// The flow completed (navigated into the viewer) rather than stranding on an
		// error — i.e. countFindings() produced a value instead of throwing.
		await page.waitForURL(/\/viewer\//, { timeout: 30_000 });
		expect(inferenceHit).toBe(true);

		// The study persisted to IndexedDB (addStudy ran despite the partial inference).
		const studies = await readAll<{ modality: string }>(page, 'studies');
		expect(studies.length).toBe(1);
		expect(errors, `uncaught errors:\n${errors.join('\n')}`).toEqual([]);
	} finally {
		await page.unroute('**/api/ai/**', handler);
	}
});
