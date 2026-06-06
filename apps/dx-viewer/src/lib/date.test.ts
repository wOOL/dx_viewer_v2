import { describe, it, expect } from 'vitest';
import {
	localDateKey,
	formatDateKey,
	countByLocalDate,
	todayLocalISO,
	validateDobISO,
	MIN_DOB_ISO,
	formatDisplayDate
} from './date';

// capturedAt is an instant shown in LOCAL time; the patient-page date filter must
// bucket + label by the same local calendar date. These guard the contract; the
// actual cross-timezone day-shift is exercised by patient-date-filter.e2e.ts under
// America/Los_Angeles (a UTC test runner can't observe a local-vs-UTC divergence —
// same reason #53 was verified via browser tz emulation, not a unit test).

describe('localDateKey', () => {
	it('returns the LOCAL calendar date of a timestamp', () => {
		// Built from local components, so getFullYear/Month/Date read them straight back
		// regardless of the runner timezone.
		const d = new Date(2026, 4, 22, 23, 30); // local 2026-05-22 23:30
		expect(localDateKey(d.toISOString())).toBe('2026-05-22');
		const e = new Date(2026, 0, 5, 0, 15); // local 2026-01-05 00:15 (zero-padding)
		expect(localDateKey(e.toISOString())).toBe('2026-01-05');
	});

	it('guards missing / invalid input', () => {
		expect(localDateKey('')).toBe('');
		expect(localDateKey(null)).toBe('');
		expect(localDateKey(undefined)).toBe('');
		expect(localDateKey('not-a-date')).toBe('');
	});
});

describe('formatDateKey', () => {
	it('parses a YYYY-MM-DD key as a LOCAL date (no UTC-midnight day shift)', () => {
		// Must equal a locally-constructed date's label — NOT new Date('2026-05-22'),
		// which is UTC midnight and renders as the previous day west of UTC. Both
		// sides pin locale='en-US' so the test is deterministic regardless of the
		// runner's default; runtime callers pass $locale instead.
		const expected = new Date(2026, 4, 22).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: '2-digit'
		});
		expect(formatDateKey('2026-05-22', 'en-US')).toBe(expected);
		expect(formatDateKey('2026-05-22', 'en-US')).toContain('22');
	});

	it('honours the locale arg (the en-US-was-hardcoded bug)', () => {
		// French should produce a French-formatted month name.
		const fr = formatDateKey('2026-05-22', 'fr-FR');
		expect(fr).toMatch(/mai/);
		expect(fr).not.toMatch(/May/);
	});

	it('round-trips with localDateKey to the LOCAL display of a timestamp (the filter↔tile invariant)', () => {
		const tileLabel = (iso: string) =>
			new Date(iso).toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'short',
				day: '2-digit'
			});
		for (const iso of [
			new Date(2026, 4, 22, 6, 18).toISOString(),
			new Date(2026, 11, 31, 23, 59).toISOString(),
			new Date(2026, 0, 1, 0, 1).toISOString()
		]) {
			// What the filter label shows === what a study tile shows for the same study.
			expect(formatDateKey(localDateKey(iso), 'en-US')).toBe(tileLabel(iso));
		}
	});

	it('passes through non-date strings unchanged', () => {
		expect(formatDateKey('')).toBe('');
		expect(formatDateKey('garbage')).toBe('garbage');
	});
});

describe('countByLocalDate', () => {
	it('buckets timestamps by local calendar date and counts each', () => {
		const a = new Date(2026, 4, 20, 9, 0).toISOString();
		const b = new Date(2026, 4, 20, 17, 0).toISOString(); // same local day as a
		const c = new Date(2026, 4, 21, 1, 0).toISOString();
		const counts = countByLocalDate([a, b, c]);
		expect(counts.get('2026-05-20')).toBe(2);
		expect(counts.get('2026-05-21')).toBe(1);
		// Keys match localDateKey, so the caller's date list = [...counts.keys()].
		expect([...counts.keys()].sort()).toEqual(['2026-05-20', '2026-05-21']);
	});

	it('skips missing / invalid timestamps', () => {
		const counts = countByLocalDate([undefined, null, '', 'garbage', '2026-05-20T10:00:00.000Z']);
		expect(counts.size).toBe(1);
		expect([...counts.values()][0]).toBe(1);
	});
});

describe('todayLocalISO', () => {
	// Don't hardcode a calendar date (would flake daily). Assert the format and
	// that it equals a LOCALLY-computed reference built the same way — proving it
	// uses local date components, not toISOString() (UTC), which is the DOB cap's
	// whole point west of UTC.
	it('returns a YYYY-MM-DD string', () => {
		expect(todayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('is exactly 10 characters', () => {
		expect(todayLocalISO()).toHaveLength(10);
	});

	it('equals a locally-computed reference (local components, not UTC)', () => {
		const d = new Date();
		const ref = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		expect(todayLocalISO()).toBe(ref);
	});

	it('is not in the future relative to itself', () => {
		// String compare is chronological for YYYY-MM-DD — today is never > today.
		const t = todayLocalISO();
		expect(t > t).toBe(false);
		expect(t <= t).toBe(true);
	});
});

describe('validateDobISO', () => {
	it('treats empty/undefined/null as ok (DOB is optional)', () => {
		expect(validateDobISO('')).toBe('ok');
		expect(validateDobISO(undefined)).toBe('ok');
		expect(validateDobISO(null)).toBe('ok');
	});

	it('accepts a normal past date', () => {
		expect(validateDobISO('1990-06-15')).toBe('ok');
	});

	it('flags a future date (built relative to todayLocalISO, never stale)', () => {
		// Construct tomorrow's local YYYY-MM-DD the same way the helper derives
		// today (local date components), so this never hardcodes a date or flakes
		// around midnight. Date math handles month/year rollover; re-read the
		// components back out and zero-pad to match the helper's format.
		const [y, mo, d] = todayLocalISO().split('-').map(Number);
		const t = new Date(y, mo - 1, d + 1);
		const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
		expect(validateDobISO(tomorrow)).toBe('future');
	});

	it('flags an absurdly old date', () => {
		expect(validateDobISO('1800-01-01')).toBe('tooOld');
		expect(validateDobISO('0001-01-01')).toBe('tooOld');
	});

	it('accepts the MIN_DOB_ISO boundary itself', () => {
		expect(validateDobISO(MIN_DOB_ISO)).toBe('ok');
	});
});

// The single shared display formatter — several components had their own inline fmtDate
// and the "Invalid Date" guard (#75) had drifted onto only some of them. A malformed /
// missing capturedAt must render a dash, never the literal "Invalid Date".
describe('formatDisplayDate', () => {
	it('guards missing/empty/malformed input to a dash (NOT "Invalid Date")', () => {
		expect(formatDisplayDate(undefined, 'en-US')).toBe('—');
		expect(formatDisplayDate(null, 'en-US')).toBe('—');
		expect(formatDisplayDate('', 'en-US')).toBe('—');
		const bad = formatDisplayDate('not-a-date', 'en-US');
		expect(bad).toBe('—');
		expect(bad).not.toContain('Invalid');
	});

	it('formats a valid ISO string + epoch ms in the given locale', () => {
		const iso = formatDisplayDate('2026-05-22T12:00:00.000Z', 'en-US');
		expect(iso).toContain('2026');
		expect(iso).not.toBe('—');
		// Epoch ms is accepted too (CbctReport's print passes a numeric timestamp).
		expect(formatDisplayDate(Date.UTC(2026, 4, 22, 12), 'en-US')).toContain('2026');
	});

	it('respects custom Intl options (e.g. a long month, a UTC timezone)', () => {
		const longMonth = formatDisplayDate('2026-05-22T12:00:00.000Z', 'en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
		expect(longMonth).toContain('May'); // long month name, not "05"
		// UTC option pins the calendar day regardless of the runner's local zone.
		const utc = formatDisplayDate('2026-05-22T00:30:00.000Z', 'en-US', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			timeZone: 'UTC'
		});
		expect(utc).toContain('22');
	});
});
