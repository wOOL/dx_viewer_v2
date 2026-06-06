import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';
import type { InferenceResponse } from '$lib/types';

// LOCAL-FIRST: refresh() loads patients + LIGHT study metadata from IndexedDB and must
// NOT pull the per-study `inference` blob (MBs each; a clinic has hundreds). The heavy
// inference is loaded lazily, per patient, by ensureInference().
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./auth.svelte', () => ({ auth: { user: { id: 'u1' }, isLoggedIn: true } }));
vi.mock('./history.svelte', () => ({ history: { remove: vi.fn() } }));

import { studies } from './studies.svelte';

const U = 'u1';
let db: LocalDb;

async function seedPatientWithStudies(
	patientId: string,
	studyIds: string[],
	withInference = false
) {
	await db.putPatient({
		id: patientId,
		user: U,
		name: 'Jane Doe',
		created: '2026-01-01T00:00:00.000Z',
		updated: '2026-01-01T00:00:00.000Z'
	});
	for (const sid of studyIds) {
		await db.putStudy({
			id: sid,
			user: U,
			patient: patientId,
			modality: 'xray',
			findingCounts: { caries: 2 },
			severityScore: 3,
			capturedAt: '2026-04-01T00:00:00.000Z',
			created: '2026-02-02T00:00:00.000Z',
			updated: '2026-02-02T00:00:00.000Z'
		});
		if (withInference) {
			await db.putInference({
				studyId: sid,
				user: U,
				inference: {
					extra: { disease_result: { result: { labels: [1] } } }
				} as unknown as InferenceResponse
			});
		}
	}
}

beforeEach(() => {
	db = new LocalDb('test-' + genId());
	studies.setDbForTesting(db);
	studies.patients = [];
});
afterEach(async () => {
	await db.destroy();
});

describe('refresh() — bounded-memory study fields (local-first)', () => {
	it('loads patients + studies with the scalar fields but NOT inference', async () => {
		await seedPatientWithStudies('p1', ['s1', 's2'], true);
		await studies.refresh();
		const p = studies.getPatient('p1');
		expect(p?.studies.length).toBe(2);
		expect(p?.studies.every((s) => s.inference === undefined)).toBe(true);
		// The list-view scalars are present.
		expect(p?.studies[0]?.findingCounts).toEqual({ caries: 2 });
		expect(p?.studies[0]?.severityScore).toBe(3);
	});

	it('CARRIES loaded inference across a refresh when the study row is unchanged (no cross-tab flicker)', async () => {
		await seedPatientWithStudies('p1', ['s1'], true);
		await studies.refresh();
		await studies.ensureInference('p1');
		expect(studies.getStudy('p1', 's1')?.inference).toBeTruthy();

		// A cross-tab signal triggers another refresh; the study row is UNCHANGED
		// (`updated` stamp equal) → the loaded inference must carry over instead of
		// blanking the AI overlay/findings for a refetch frame.
		await studies.refresh();
		expect(studies.getStudy('p1', 's1')?.inference).toBeTruthy();
	});

	it('DROPS the carried inference when the study row changed (another tab edited it)', async () => {
		await seedPatientWithStudies('p1', ['s1'], true);
		await studies.refresh();
		await studies.ensureInference('p1');
		expect(studies.getStudy('p1', 's1')?.inference).toBeTruthy();

		// "Another tab" updates the inference: putInference + the empty-patch bump that
		// every inference/edit writer performs (see saveUserEdits/updateStudyInference).
		await new Promise((r) => setTimeout(r, 2));
		await db.putInference({ studyId: 's1', user: U, inference: null, userEdits: null });
		await db.patchStudy(U, 's1', {});

		await studies.refresh();
		// Stale value must NOT survive — undefined re-arms the lazy ensureInference.
		expect(studies.getStudy('p1', 's1')?.inference).toBeUndefined();
	});

	it('only surfaces the current user’s data', async () => {
		await seedPatientWithStudies('p1', ['s1']);
		await db.putPatient({
			id: 'pOther',
			user: 'someoneelse',
			name: 'Not Mine',
			created: '2026-01-01T00:00:00.000Z',
			updated: '2026-01-01T00:00:00.000Z'
		});
		await studies.refresh();
		expect(studies.patients.map((p) => p.id)).toEqual(['p1']);
	});
});

describe('ensureInference(patientId)', () => {
	const INF_A = {
		extra: { disease_result: { result: { labels: [1] } } }
	} as unknown as InferenceResponse;

	it('patches inference onto the patient’s studies from IndexedDB', async () => {
		await seedPatientWithStudies('p1', ['s1', 's2'], true);
		await studies.refresh();
		expect(studies.getPatient('p1')?.studies.every((s) => s.inference === undefined)).toBe(true);
		await studies.ensureInference('p1');
		const list = studies.getPatient('p1')?.studies ?? [];
		expect(list.find((s) => s.id === 's1')?.inference).toEqual(INF_A);
		expect(list.find((s) => s.id === 's2')?.inference).toEqual(INF_A);
	});

	it('is idempotent — a second call re-reads nothing new', async () => {
		await seedPatientWithStudies('p1', ['s1'], true);
		await studies.refresh();
		const spy = vi.spyOn(db, 'getInferencesForStudies');
		await studies.ensureInference('p1');
		expect(spy).toHaveBeenCalledTimes(1);
		await studies.ensureInference('p1'); // every study now resolved → no further read
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('shares one in-flight read across concurrent calls for the same patient', async () => {
		await seedPatientWithStudies('p1', ['s1', 's2'], true);
		await studies.refresh();
		const spy = vi.spyOn(db, 'getInferencesForStudies');
		await Promise.all([studies.ensureInference('p1'), studies.ensureInference('p1')]);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('marks an image-only study’s inference null (so it never re-queries forever)', async () => {
		await seedPatientWithStudies('p1', ['s1'], false); // no inference row
		await studies.refresh();
		await studies.ensureInference('p1');
		expect(studies.getPatient('p1')?.studies[0]?.inference).toBeNull();
	});

	it('is a no-op for an unknown patient', async () => {
		await seedPatientWithStudies('p1', ['s1'], true);
		await studies.refresh();
		const spy = vi.spyOn(db, 'getInferencesForStudies');
		await studies.ensureInference('does-not-exist');
		expect(spy).not.toHaveBeenCalled();
	});
});
