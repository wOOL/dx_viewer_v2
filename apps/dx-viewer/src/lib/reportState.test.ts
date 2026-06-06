import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	normalizeReportStatus,
	effectiveReportText,
	loadReportState,
	saveReportState
} from './reportState';
import { LocalDb } from '$lib/db/localDb';
import { genId } from '$lib/db/ids';

describe('normalizeReportStatus', () => {
	it('keeps the known verdicts and coerces anything else to empty', () => {
		expect(normalizeReportStatus('acceptable')).toBe('acceptable');
		expect(normalizeReportStatus('unacceptable')).toBe('unacceptable');
		expect(normalizeReportStatus('')).toBe('');
		expect(normalizeReportStatus('garbage')).toBe('');
		expect(normalizeReportStatus(null)).toBe('');
		expect(normalizeReportStatus(undefined)).toBe('');
	});
});

describe('effectiveReportText', () => {
	it('prefers a non-empty clinician edit, else the AI report', () => {
		expect(effectiveReportText('edited', 'ai')).toBe('edited');
		expect(effectiveReportText('', 'ai')).toBe('ai');
		expect(effectiveReportText('   ', 'ai')).toBe('ai');
		expect(effectiveReportText(null, 'ai')).toBe('ai');
	});
});

describe('loadReportState / saveReportState (local-first)', () => {
	let db: LocalDb;
	beforeEach(async () => {
		db = new LocalDb('test-' + genId());
		// The save path has an orphan guard (no-op when the study row is missing), so
		// the tests operate on a real study like the app does.
		await db.putPatient({ id: 'p1', user: 'u1', name: 'P', created: '', updated: '' });
		await db.putStudy({
			id: 's1',
			user: 'u1',
			patient: 'p1',
			modality: 'xray',
			created: '',
			updated: ''
		});
	});
	afterEach(async () => {
		await db.destroy();
	});

	it('returns null when there is no record', async () => {
		expect(await loadReportState('s1', 'u1', db)).toBeNull();
	});

	it('drops a save for a study that no longer exists (orphan guard) instead of resurrecting it', async () => {
		const id = await saveReportState(
			{ studyId: 'gone-study', userId: 'u1', text: 'late save', status: '' },
			db
		);
		expect(id).toBe('');
		expect(await loadReportState('gone-study', 'u1', db)).toBeNull();
	});

	it('round-trips an edited report + verdict', async () => {
		const id = await saveReportState(
			{ studyId: 's1', userId: 'u1', text: 'hi', status: 'acceptable' },
			db
		);
		expect(id).toMatch(/^[a-z0-9]{15}$/);
		expect(await loadReportState('s1', 'u1', db)).toEqual({
			recordId: id,
			text: 'hi',
			status: 'acceptable'
		});
	});

	it('a re-save reuses the same record id (no duplicate, unique [user+study])', async () => {
		const id1 = await saveReportState({ studyId: 's1', userId: 'u1', text: 'a', status: '' }, db);
		const id2 = await saveReportState(
			{ studyId: 's1', userId: 'u1', text: 'b', status: 'unacceptable' },
			db
		);
		expect(id2).toBe(id1);
		expect((await loadReportState('s1', 'u1', db))?.text).toBe('b');
	});

	it('scopes report state per user', async () => {
		await saveReportState({ studyId: 's1', userId: 'u1', text: 'mine', status: '' }, db);
		expect(await loadReportState('s1', 'u2', db)).toBeNull();
	});
});
