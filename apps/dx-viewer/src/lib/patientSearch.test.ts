import { describe, it, expect } from 'vitest';
import { searchableDate, buildPatientSearchIndex, filterPatientsByQuery } from './patientSearch';
import type { StoredPatient } from './types';

function patient(over: Partial<StoredPatient> & { name: string }): StoredPatient {
	return {
		id: over.name,
		initials: 'XX',
		studies: [],
		lastCapture: '2026-01-01T00:00:00.000Z',
		totalToothCount: 0,
		ringColors: ['#000', '#111'],
		...over // name (+ any provided id/dob/lastCapture) override the defaults
	};
}

describe('searchableDate', () => {
	it('includes the ISO date, the short label, and the full month (folded, lowercased)', () => {
		const s = searchableDate('1988-08-08', 'en-US');
		expect(s).toContain('1988-08-08'); // raw ISO
		expect(s).toContain('aug'); // short month label shown on cards
		expect(s).toContain('august'); // full month name
	});
	it('returns empty for missing/invalid dates', () => {
		expect(searchableDate(undefined)).toBe('');
		expect(searchableDate('not-a-date')).toBe('');
	});
});

describe('buildPatientSearchIndex + filterPatientsByQuery', () => {
	const patients = [
		patient({ name: 'André Müller', dob: '1988-08-08', lastCapture: '2026-05-20T00:00:00.000Z' }),
		patient({ name: 'Ann Smith', dob: '1990-02-01', lastCapture: '2026-03-10T00:00:00.000Z' }),
		patient({ name: 'Bob Jones', dob: '1975-12-31', lastCapture: '2024-07-04T00:00:00.000Z' })
	];
	const index = buildPatientSearchIndex(patients, 'en-US');

	it('an empty query returns every patient in the original order', () => {
		const out = filterPatientsByQuery(index, '   ');
		expect(out.map((p) => p.name)).toEqual(['André Müller', 'Ann Smith', 'Bob Jones']);
	});

	it('matches names diacritic- and case-insensitively', () => {
		expect(filterPatientsByQuery(index, 'andre').map((p) => p.name)).toEqual(['André Müller']);
		expect(filterPatientsByQuery(index, 'MÜLLER').map((p) => p.name)).toEqual(['André Müller']);
		expect(filterPatientsByQuery(index, 'muller').map((p) => p.name)).toEqual(['André Müller']);
	});

	it('matches the localized month label and the ISO date', () => {
		// "aug" hits André's 1988-08-08 DOB short label.
		expect(filterPatientsByQuery(index, 'aug').map((p) => p.name)).toEqual(['André Müller']);
		// ISO substring of a last-capture date.
		expect(filterPatientsByQuery(index, '2024-07').map((p) => p.name)).toEqual(['Bob Jones']);
	});

	it('does not match a query that only spans two different fields (no cross-field join)', () => {
		// "ann" (name) + "1990" (dob) concatenated must NOT match as one token.
		expect(filterPatientsByQuery(index, 'ann1990')).toEqual([]);
	});

	it('returns nothing for an unmatched query', () => {
		expect(filterPatientsByQuery(index, 'zzzznope')).toEqual([]);
	});
});
