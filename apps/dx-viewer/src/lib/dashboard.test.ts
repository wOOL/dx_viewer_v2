import { describe, it, expect } from 'vitest';
import { computeMetrics, recentPatients } from './dashboard';
import type { StoredPatient, StoredStudy } from './types';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function study(id: string, created: string, capturedAt = created): StoredStudy {
	return { id, patientId: 'p', patientName: 'x', capturedAt, created, modality: 'xray' };
}
function patient(
	id: string,
	studies: StoredStudy[],
	extra: Partial<StoredPatient> = {}
): StoredPatient {
	return {
		id,
		name: id,
		initials: id[0]!.toUpperCase(),
		studies,
		lastCapture: studies[0]?.created ?? '',
		totalToothCount: 0,
		ringColors: ['#000', '#111'],
		...extra
	};
}

describe('computeMetrics', () => {
	it('counts real patients, all analyses, and this-week analyses', () => {
		const patients = [
			patient('a', [study('a1', daysAgo(1)), study('a2', daysAgo(10))]),
			patient('b', [study('b1', daysAgo(3))]),
			patient('q', [study('q1', daysAgo(0))], { quick: true }) // throwaway patient
		];
		const m = computeMetrics(patients, NOW);
		expect(m.totalPatients).toBe(2); // quick patient excluded
		expect(m.totalAnalyses).toBe(4); // all studies, incl. the quick one
		expect(m.analysesThisWeek).toBe(3); // a1 (1d), b1 (3d), q1 (0d); a2 (10d) excluded
	});

	it('does not count future-dated studies as this week', () => {
		const m = computeMetrics(
			[patient('a', [study('a1', new Date(NOW + 86_400_000).toISOString())])],
			NOW
		);
		expect(m.analysesThisWeek).toBe(0);
		expect(m.totalAnalyses).toBe(1);
	});

	it('falls back to capturedAt when created is missing, and ignores unparseable dates', () => {
		const s1: StoredStudy = {
			id: 's1',
			patientId: 'p',
			patientName: 'x',
			capturedAt: daysAgo(2),
			modality: 'xray'
		};
		const s2: StoredStudy = {
			id: 's2',
			patientId: 'p',
			patientName: 'x',
			capturedAt: 'not-a-date',
			modality: 'xray'
		};
		const m = computeMetrics([patient('a', [s1, s2])], NOW);
		expect(m.analysesThisWeek).toBe(1); // s1 via capturedAt; s2 unparseable → skipped
		expect(m.totalAnalyses).toBe(2);
	});

	it('is all-zero for no patients', () => {
		expect(computeMetrics([], NOW)).toEqual({
			totalPatients: 0,
			totalAnalyses: 0,
			analysesThisWeek: 0
		});
	});
});

describe('recentPatients', () => {
	it('returns the N most-recent real patients with studies, newest first', () => {
		const patients = [
			patient('old', [study('o', daysAgo(30))]),
			patient('new', [study('n', daysAgo(1))]),
			patient('mid', [study('m', daysAgo(5))]),
			patient('empty', []), // no studies → excluded
			patient('quick', [study('qq', daysAgo(0))], { quick: true }) // quick → excluded
		];
		const r = recentPatients(patients, 3);
		expect(r.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
		expect(r[0]!.date).toBe(daysAgo(1));
	});

	it('respects the limit and never mutates the input', () => {
		const patients = [
			patient('a', [study('a', daysAgo(1))]),
			patient('b', [study('b', daysAgo(2))]),
			patient('c', [study('c', daysAgo(3))])
		];
		const snapshot = patients.map((p) => p.id);
		expect(recentPatients(patients, 2)).toHaveLength(2);
		expect(patients.map((p) => p.id)).toEqual(snapshot); // input order preserved
	});
});
