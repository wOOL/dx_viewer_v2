import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';

// findOrCreatePatient must report whether it CREATED a new patient (vs matched an
// existing one) so the upload flow can delete a freshly-created patient if the study
// save then fails (the #40/#96 orphan cleanup), and must dedupe concurrent creates.
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./auth.svelte', () => ({ auth: { user: { id: 'u1' }, isLoggedIn: true } }));
vi.mock('./history.svelte', () => ({ history: { remove: vi.fn() } }));

import { studies } from './studies.svelte';

let db: LocalDb;
beforeEach(() => {
	db = new LocalDb('test-' + genId());
	studies.setDbForTesting(db);
	studies.patients = [];
});
afterEach(async () => {
	await db.destroy();
});

describe('findOrCreatePatient — created flag (#96 orphan cleanup)', () => {
	it('reports created=false and returns the existing patient on a name+DOB match', async () => {
		studies.patients = [
			{
				id: 'existing1',
				name: 'Jane Doe',
				dob: '1990-05-05',
				initials: 'JD',
				studies: [],
				lastCapture: '2026-01-01',
				totalToothCount: 0,
				ringColors: ['#000', '#fff']
			}
		];
		const res = await studies.findOrCreatePatient({ name: 'jane doe', dob: '1990-05-05' });
		expect(res.created).toBe(false);
		expect(res.patient.id).toBe('existing1');
		expect(studies.patients.length).toBe(1);
	});

	it('reports created=true, prepends, and persists a new patient when there is no match', async () => {
		const res = await studies.findOrCreatePatient({ name: 'New Person', dob: '2000-01-01' });
		expect(res.created).toBe(true);
		expect(res.patient.id).toMatch(/^[a-z0-9]{15}$/);
		expect(studies.patients[0]?.id).toBe(res.patient.id);
		// Persisted to IndexedDB.
		expect((await db.getPatient('u1', res.patient.id))?.name).toBe('New Person');
	});

	it('dedups against the DB when the in-memory projection is STALE (no duplicate from a second tab)', async () => {
		// Another tab created this patient; this tab's projection hasn't refreshed yet.
		const p = await db.putPatient({
			id: genId(),
			user: 'u1',
			name: 'Tab A Patient',
			dob: '1985-03-03',
			created: '',
			updated: ''
		});
		expect(studies.patients.length).toBe(0); // projection is stale/empty

		const res = await studies.findOrCreatePatient({ name: 'tab a patient', dob: '1985-03-03' });
		expect(res.created).toBe(false);
		expect(res.patient.id).toBe(p.id);
		// No duplicate row in the DB.
		expect((await db.getPatients('u1')).length).toBe(1);
	});

	it('reports created=false when names differ only in diacritics', async () => {
		studies.patients = [
			{
				id: 'andre1',
				name: 'André Müller',
				dob: '1970-03-15',
				initials: 'AM',
				studies: [],
				lastCapture: '2026-01-01',
				totalToothCount: 0,
				ringColors: ['#000', '#fff']
			}
		];
		const res = await studies.findOrCreatePatient({ name: 'andre muller', dob: '1970-03-15' });
		expect(res.created).toBe(false);
		expect(res.patient.id).toBe('andre1');
		expect(studies.patients.length).toBe(1);
	});
});

describe('findOrCreatePatient — concurrent-create idempotency lock', () => {
	it('two concurrent creates for the same name+DOB create only ONE patient', async () => {
		const spy = vi.spyOn(db, 'putPatient');
		const [a, b] = await Promise.all([
			studies.findOrCreatePatient({ name: 'Race Condition', dob: '1990-01-01' }),
			studies.findOrCreatePatient({ name: 'Race Condition', dob: '1990-01-01' })
		]);
		// The persisting call happened exactly once.
		expect(spy).toHaveBeenCalledTimes(1);
		expect(a.patient.id).toBe(b.patient.id);
		expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
		expect(studies.patients).toHaveLength(1);
	});

	it('clears the lock so a later call for the same key hits the cache (no 2nd create)', async () => {
		const spy = vi.spyOn(db, 'putPatient');
		const first = await studies.findOrCreatePatient({ name: 'Sequential', dob: '2000-01-01' });
		expect(first.created).toBe(true);
		const second = await studies.findOrCreatePatient({ name: 'Sequential', dob: '2000-01-01' });
		expect(second.created).toBe(false);
		expect(second.patient.id).toBe(first.patient.id);
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
