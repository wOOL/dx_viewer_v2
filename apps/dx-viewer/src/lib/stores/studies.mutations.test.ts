import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { addMessages, init } from 'svelte-i18n';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';
import type { StoredPatient, StoredStudy } from '$lib/types';

// mergePatientInto's partial-failure error is localized via
// get(_)('quickassign.mergeIncomplete', {moved,total}). Register a minimal dictionary
// so the resolved message carries the structured counts.
addMessages('en', {
	quickassign: { mergeIncomplete: 'Could not file all studies: moved {moved} of {total}.' }
});
init({ fallbackLocale: 'en', initialLocale: 'en' });

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./auth.svelte', () => ({ auth: { user: { id: 'u1' }, isLoggedIn: true } }));
vi.mock('./history.svelte', () => ({ history: { remove: vi.fn() } }));

import { studies } from './studies.svelte';

const U = 'u1';
let db: LocalDb;

function study(id: string, patientId: string): StoredStudy {
	return {
		id,
		patientId,
		patientName: patientId,
		capturedAt: '2026-04-01T00:00:00.000Z',
		modality: 'xray'
	};
}
function patient(id: string, studyIds: string[]): StoredPatient {
	return {
		id,
		name: id,
		initials: 'XX',
		studies: studyIds.map((s) => study(s, id)),
		lastCapture: '2026-04-01T00:00:00.000Z',
		totalToothCount: 0,
		ringColors: ['#000', '#111']
	};
}

// Seed the db so the store's mutations (which write to the db then patch the cache)
// have real rows to operate on, then mirror them into the in-memory cache.
async function seed(patients: StoredPatient[]) {
	for (const p of patients) {
		await db.putPatient({
			id: p.id,
			user: U,
			name: p.name,
			created: '2026-01-01T00:00:00.000Z',
			updated: '2026-01-01T00:00:00.000Z'
		});
		for (const s of p.studies) {
			await db.putStudy({
				id: s.id,
				user: U,
				patient: p.id,
				modality: 'xray',
				created: '2026-02-01T00:00:00.000Z',
				updated: '2026-02-01T00:00:00.000Z'
			});
		}
	}
	studies.patients = patients;
}

beforeEach(() => {
	db = new LocalDb('test-' + genId());
	studies.setDbForTesting(db);
	studies.patients = [];
});
afterEach(async () => {
	vi.restoreAllMocks();
	await db.destroy();
});

describe('studies delete / move mutations', () => {
	it('deleteStudy removes only the targeted study from its patient + db', async () => {
		await seed([patient('p1', ['s1', 's2', 's3'])]);
		await studies.deleteStudy('s2');
		expect(studies.patients[0]!.studies.map((s) => s.id)).toEqual(['s1', 's3']);
		expect(await db.getStudy(U, 's2')).toBeUndefined();
		expect(await db.getStudy(U, 's1')).toBeTruthy();
	});

	it('deleteStudy recomputes the DERIVED patient fields (lastCapture must not show the deleted study)', async () => {
		// Two studies with distinct capture dates — delete the NEWEST one.
		const p = patient('p1', ['s1', 's2']);
		p.studies[0]!.capturedAt = '2026-03-01T00:00:00.000Z';
		p.studies[1]!.capturedAt = '2026-05-01T00:00:00.000Z'; // newest → drives lastCapture
		p.lastCapture = '2026-05-01T00:00:00.000Z';
		p.studies[0]!.findingCounts = { toothCount: 4 };
		p.studies[1]!.findingCounts = { toothCount: 3 };
		p.totalToothCount = 7;
		await seed([p]);

		await studies.deleteStudy('s2');
		const after = studies.patients[0]!;
		// A bare splice left these stale (the deleted study's date kept showing on the
		// patient header / PatientCard / dashboard Recent sort until a full refresh).
		expect(after.lastCapture).toBe('2026-03-01T00:00:00.000Z');
		expect(after.totalToothCount).toBe(4);
	});

	it('deletePatient drops the whole patient (+ its studies), keeping the others', async () => {
		await seed([patient('p1', ['s1']), patient('p2', ['s2'])]);
		await studies.deletePatient('p1');
		expect(studies.patients.map((p) => p.id)).toEqual(['p2']);
		expect(await db.getPatient(U, 'p1')).toBeUndefined();
		expect(await db.getStudy(U, 's1')).toBeUndefined();
	});

	it('updateStudyFmxSlot sets the slot on the right study only (+ db)', async () => {
		await seed([patient('p1', ['s1', 's2'])]);
		await studies.updateStudyFmxSlot('s2', 'pa-ur-mol');
		const byId = Object.fromEntries(studies.patients[0]!.studies.map((s) => [s.id, s.fmxSlot]));
		expect(byId.s2).toBe('pa-ur-mol');
		expect(byId.s1).toBeUndefined();
		expect((await db.getStudy(U, 's2'))?.fmxSlot).toBe('pa-ur-mol');
	});

	it('updateStudyFmxSlot clears the slot when passed null', async () => {
		await seed([patient('p1', ['s1'])]);
		await studies.updateStudyFmxSlot('s1', 'pa-ur-mol');
		await studies.updateStudyFmxSlot('s1', null);
		expect(studies.patients[0]!.studies[0]!.fmxSlot).toBeUndefined();
		expect((await db.getStudy(U, 's1'))?.fmxSlot).toBe('');
	});
});

describe('getPatient ↔ byPatientId (derived; #62 reactivity staleness)', () => {
	it('reflects patients across replacements, with no stale entry', () => {
		studies.patients = [];
		expect(studies.getPatient('px')).toBeUndefined();
		studies.patients = [patient('px', ['s1'])];
		expect(studies.getPatient('px')?.studies.map((s) => s.id)).toEqual(['s1']);
		studies.patients = [patient('px', ['s1', 's2']), patient('py', [])];
		expect(studies.getPatient('px')?.studies.map((s) => s.id)).toEqual(['s1', 's2']);
		expect(studies.getPatient('py')).toBeDefined();
		studies.patients = [];
		expect(studies.getPatient('px')).toBeUndefined();
	});
});

describe('mergePatientInto', () => {
	it('moves all studies to the target, deletes the source, and refreshes', async () => {
		await seed([patient('p1', ['s1', 's2']), patient('p2', [])]);
		await studies.mergePatientInto('p1', 'p2');
		// Studies now belong to p2; source p1 gone.
		expect((await db.getStudiesByPatient(U, 'p2')).map((s) => s.id).sort()).toEqual(['s1', 's2']);
		expect(await db.getPatient(U, 'p1')).toBeUndefined();
		expect(
			studies
				.getPatient('p2')
				?.studies.map((s) => s.id)
				.sort()
		).toEqual(['s1', 's2']);
	});

	it('reports moved/total and keeps the source when a reassign fails partway', async () => {
		await seed([patient('p1', ['s1', 's2', 's3']), patient('p2', [])]);
		// Make the SECOND reassign throw (the first commits).
		let calls = 0;
		vi.spyOn(db, 'reassignStudy').mockImplementation(async (user, sid, to) => {
			calls++;
			if (calls === 2) throw new Error('write failed');
			await db.patchStudy(user, sid, { patient: to });
		});
		const delSpy = vi.spyOn(db, 'deletePatient');
		const err = await studies.mergePatientInto('p1', 'p2').then(
			() => null,
			(e: unknown) => e as Error
		);
		expect(err).toBeInstanceOf(Error);
		expect(err!.message).toContain('1'); // moved
		expect(err!.message).toContain('3'); // total
		// A1 rule: the raw English-technical detail must NOT leak into the clinician-
		// facing message (reassignStudy's new throws made this path newly reachable).
		expect(err!.message).not.toContain('write failed');
		// Source NOT deleted on partial failure.
		expect(delSpy).not.toHaveBeenCalled();
	});

	it('does NOT mask a successful merge when the post-merge resync throws', async () => {
		await seed([patient('p1', ['s1', 's2']), patient('p2', [])]);
		vi.spyOn(studies, 'refresh').mockRejectedValue(new Error('resync 500'));
		await expect(studies.mergePatientInto('p1', 'p2')).resolves.toBeUndefined();
	});
});

describe('renamePatient', () => {
	it('caps an oversized name before persisting (defence at the store choke point)', async () => {
		await seed([patient('p1', [])]);
		await studies.renamePatient('p1', { name: '   ' + 'Z'.repeat(5000) });
		const rec = await db.getPatient(U, 'p1');
		expect(rec?.name.length).toBe(100); // MAX_NAME_LENGTH
		expect(rec?.name.startsWith('Z')).toBe(true); // trimmed before capping
		expect(rec?.quick).toBe(false);
	});
});
