import { describe, it, expect } from 'vitest';
import { assignablePatients, matchPatientsByName, foldDiacritics } from './patients';
import type { StoredPatient } from './types';

function p(id: string, name: string, quick = false): StoredPatient {
	return {
		id,
		name,
		initials: '',
		studies: [],
		lastCapture: '',
		totalToothCount: 0,
		ringColors: ['#000000', '#111111'],
		quick
	};
}

describe('assignablePatients', () => {
	it('excludes the patient itself (a quick patient is never its own merge target)', () => {
		const list = [p('a', 'A', true), p('b', 'B')];
		expect(assignablePatients(list, 'a').map((x) => x.id)).toEqual(['b']);
	});

	it('excludes other quick/temporary patients', () => {
		const list = [p('a', 'A', true), p('b', 'B'), p('c', 'C', true)];
		expect(assignablePatients(list, 'a').map((x) => x.id)).toEqual(['b']);
	});

	it('returns empty when there are no real patients to merge into', () => {
		expect(assignablePatients([p('a', 'A', true)], 'a')).toEqual([]);
	});

	it('keeps every non-quick patient regardless of order', () => {
		const list = [p('b', 'B'), p('a', 'A', true), p('c', 'C')];
		expect(assignablePatients(list, 'a').map((x) => x.id)).toEqual(['b', 'c']);
	});
});

describe('matchPatientsByName (New Study → add to an existing patient)', () => {
	const list = [p('a', 'Ryan Adamson'), p('b', 'Tomako Ryan'), p('c', 'Jane Doe')];

	it('returns nothing for queries under 2 characters (dropdown stays hidden)', () => {
		expect(matchPatientsByName(list, '')).toEqual([]);
		expect(matchPatientsByName(list, 'R')).toEqual([]);
	});

	it('matches the name case-insensitively as a substring (so duplicates can be avoided)', () => {
		expect(matchPatientsByName(list, 'ryan').map((x) => x.id)).toEqual(['a', 'b']);
		expect(matchPatientsByName(list, 'doe').map((x) => x.id)).toEqual(['c']);
	});

	it('caps the suggestions to the requested limit', () => {
		const many = Array.from({ length: 10 }, (_, i) => p(`p${i}`, `Smith ${i}`));
		expect(matchPatientsByName(many, 'smith', 6)).toHaveLength(6);
	});

	it('is diacritic-insensitive — "andre" matches "André" and "muller" matches "Müller"', () => {
		const intl = [p('a', 'André Dupont'), p('b', 'Hans Müller'), p('c', 'Jens Sørensen')];
		expect(matchPatientsByName(intl, 'andre').map((x) => x.id)).toEqual(['a']);
		expect(matchPatientsByName(intl, 'muller').map((x) => x.id)).toEqual(['b']);
		// And the inverse: searching with the diacritic still matches the same patient.
		expect(matchPatientsByName(intl, 'andré').map((x) => x.id)).toEqual(['a']);
	});
});

describe('foldDiacritics (the shared case+diacritic fold behind all name matching)', () => {
	it('lowercases and strips combining marks', () => {
		expect(foldDiacritics('André')).toBe('andre');
		expect(foldDiacritics('Müller')).toBe('muller');
		expect(foldDiacritics('JOSÉ')).toBe('jose');
		expect(foldDiacritics('Sørensen')).toBe('sørensen'); // ø is a distinct letter, not a combining mark
	});
	it('leaves plain ASCII and empty strings unchanged', () => {
		expect(foldDiacritics('Jane Doe')).toBe('jane doe');
		expect(foldDiacritics('')).toBe('');
	});
	it('is idempotent', () => {
		expect(foldDiacritics(foldDiacritics('André'))).toBe('andre');
	});
});
