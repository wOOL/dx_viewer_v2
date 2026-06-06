import { test, expect } from '@playwright/test';
import { STUDIES } from './helpers';
import { seedXrayStudies, readAll, FINDING_COUNTS_2D } from './seed';

// Adding a study to an EXISTING patient must attach to that patient (by id) — never
// create a duplicate. The patient page's "Add study" opens /upload?patient=<id>; the
// upload then attached by re-matching name+DOB, so any mismatch silently spawned a
// duplicate patient. LOCAL-FIRST: the study is written to IndexedDB (no PB), so we seed
// the target patient, mock only the AI inference (fast/deterministic), run the upload, and
// assert IndexedDB has the new study under the SAME patient with NO duplicate patient.

const TEST_IMAGE = '/home/yang/appv3/test_images/image2.jpg';
const TARGET = STUDIES.fmxPatient;
const INFERENCE = {
	result: null,
	report: '',
	detection: '',
	tooth_numbers: '',
	segmentation: '',
	extra: {
		disease_result: { result: { bboxes: [], labels: [], scores: [], masks: [] }, extra: {} },
		number_result: { result: { bboxes: [], labels: [], scores: [] } },
		anatomy_result: { result: { bboxes: [], labels: [], scores: [] }, extra: { anomaly: false } }
	}
};

test('adding a study via ?patient= attaches to that patient and creates NO duplicate', async ({
	page
}) => {
	// Seed exactly one patient (the target). Any duplicate-create would make it 2.
	await seedXrayStudies(page, [
		{
			patient: TARGET,
			study: 'seedaddexist001',
			patientName: 'Existing Patient',
			findingCounts: FINDING_COUNTS_2D
		}
	]);

	// Mock only the AI calls (find_xray + inference) so the run is fast + deterministic.
	const handler = async (route: import('@playwright/test').Route) => {
		const u = route.request().url();
		if (u.includes('/api/ai/find_xray')) {
			await route.fulfill({
				json: { result: null, extra: { xrayfound: false, score: 0, width: 0, height: 0 } }
			});
		} else if (u.includes('/api/ai/')) {
			await route.fulfill({ json: INFERENCE });
		} else {
			await route.continue();
		}
	};

	try {
		await page.route('**/api/ai/**', handler);
		// Open the upload pre-scoped to the existing patient (as the patient page's "Add
		// study" does). onMount loads the local patient, finds this id, locks the form to it.
		await page.goto(`/upload?patient=${TARGET}`);
		await expect(page.getByText(/Adding a study to/)).toBeVisible();
		await expect(page.locator('#pname')).toBeDisabled();

		await page.locator('input[type=file]').setInputFiles(TEST_IMAGE);
		const run = page.getByRole('button', { name: 'Run analysis' });
		await expect(run).toBeEnabled();
		await run.click();

		// Lands in that patient's viewer (the new study under the same patient).
		await expect.poll(() => page.url(), { timeout: 30_000 }).toContain(`/viewer/${TARGET}/`);

		// IndexedDB: still exactly ONE patient (the target — no duplicate), now with 2 studies.
		const patients = await readAll<{ id: string }>(page, 'patients');
		expect(patients.length).toBe(1);
		expect(patients[0]!.id).toBe(TARGET);
		const studies = (await readAll<{ patient: string }>(page, 'studies')).filter(
			(s) => s.patient === TARGET
		);
		expect(studies.length).toBe(2); // the seeded one + the just-added one
	} finally {
		await page.unroute('**/api/ai/**', handler);
	}
});
