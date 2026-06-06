import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';
import type { StoredPatient } from '$lib/types';

// addStudy is the core write path (upload + one-click quick-analyze both land here).
// Guards: it denormalizes patientName onto the study, prepends the new study to the
// patient, moves that patient to the front, and PERSISTS to IndexedDB (study + blob).
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./auth.svelte', () => ({ auth: { user: { id: 'u1' }, isLoggedIn: true } }));
vi.mock('./history.svelte', () => ({ history: { remove: vi.fn() } }));

import { studies } from './studies.svelte';

const U = 'u1';
let db: LocalDb;

function patient(id: string, studyIds: string[] = []): StoredPatient {
	return {
		id,
		name: id === 'pat1' ? 'Jane Doe' : id,
		dob: id === 'pat1' ? '1990-01-01' : undefined,
		initials: 'JD',
		studies: studyIds.map((sid) => ({
			id: sid,
			patientId: id,
			patientName: 'Jane Doe',
			capturedAt: '2026-04-01T00:00:00.000Z',
			modality: 'xray' as const
		})),
		lastCapture: '2026-04-01T00:00:00.000Z',
		totalToothCount: 0,
		ringColors: ['#000', '#111']
	};
}

beforeEach(() => {
	db = new LocalDb('test-' + genId());
	studies.setDbForTesting(db);
	studies.patients = [];
});
afterEach(async () => {
	await db.destroy();
});

describe('studies.addStudy (core write path)', () => {
	async function dbPatient(id: string) {
		// The real flow (findOrCreatePatient) persists the patient BEFORE addStudy;
		// createStudy enforces that invariant (orphan guard, parent edition).
		await db.putPatient({ id, user: 'u1', name: id, created: '', updated: '' });
	}

	it('returns a study with the denormalized patient name + modality + findingCounts', async () => {
		studies.patients = [patient('pat1')];
		await dbPatient('pat1');
		const s = await studies.addStudy({
			patientId: 'pat1',
			modality: 'xray',
			capturedAt: '2026-05-01T10:00:00.000Z',
			findingCounts: { toothCount: 5 }
		});
		expect(s.id).toMatch(/^[a-z0-9]{15}$/);
		expect(s.patientId).toBe('pat1');
		expect(s.patientName).toBe('Jane Doe');
		expect(s.modality).toBe('xray');
		expect(s.findingCounts).toEqual({ toothCount: 5 });
		// Persisted to IndexedDB.
		expect((await db.getStudy(U, s.id))?.findingCounts).toEqual({ toothCount: 5 });
	});

	it('prepends the new study to its patient and moves that patient to the front', async () => {
		studies.patients = [patient('other'), patient('pat1', ['old1'])];
		await dbPatient('pat1');
		const s = await studies.addStudy({
			patientId: 'pat1',
			modality: 'xray',
			capturedAt: '2026-05-01T10:00:00.000Z'
		});
		expect(studies.patients[0]!.id).toBe('pat1');
		const ids = studies.patients[0]!.studies.map((x) => x.id);
		expect(ids).toContain(s.id);
		expect(ids).toContain('old1');
		expect(studies.patients.map((p) => p.id)).toContain('other');
	});

	it('persists the image blob to the files store and stores the inference', async () => {
		studies.patients = [patient('pat1')];
		await dbPatient('pat1');
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
		const s = await studies.addStudy({
			patientId: 'pat1',
			modality: 'xray',
			imageBlob: blob,
			originalFilename: 'film.jpg',
			inference: { report: 'hi' }
		});
		const f = await db.getFile(s.id, 'image');
		expect(f?.filename).toBe('film.jpg');
		expect(Array.from(new Uint8Array(await f!.blob.arrayBuffer()))).toEqual([1, 2, 3]);
		expect((await db.getInference(s.id))?.inference).toBeTruthy();
	});

	it('falls back to the IndexedDB patient record when the patient isn’t cached', async () => {
		// Patient not in the in-memory cache → addStudy reads its name from the db.
		await db.putPatient({
			id: 'pat7',
			user: U,
			name: 'Cbct Person',
			created: '2026-01-01T00:00:00.000Z',
			updated: '2026-01-01T00:00:00.000Z'
		});
		studies.patients = [];
		const s = await studies.addStudy({
			patientId: 'pat7',
			modality: 'cbct',
			capturedAt: '2026-05-01T10:00:00.000Z'
		});
		expect(s.patientId).toBe('pat7');
		expect(s.modality).toBe('cbct');
		expect(studies.getPatient('pat7')?.studies.map((x) => x.id)).toContain(s.id);
	});
});
