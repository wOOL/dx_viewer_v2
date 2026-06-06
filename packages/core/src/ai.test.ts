import { describe, it, expect } from 'vitest';
import { countFindings } from './ai';
import type { InferenceResponse } from './types';

// countFindings runs in the upload flow as an argument to studies.addStudy(),
// AFTER the patient record has already been created. If it throws on a partial /
// malformed AI response it both loses an otherwise-successful inference and leaves
// the new patient stranded with 0 studies (the #40 orphan). These tests pin the
// #68-class hardening: complete data counts correctly; every partial shape
// degrades to a partial count instead of throwing.

const complete = {
	extra: {
		disease_result: { result: { labels: [1, 1, 2, 5] } },
		number_result: { result: { labels: [11, 12, 13, 14, 15] } }
	}
} as unknown as InferenceResponse;

describe('countFindings', () => {
	it('counts disease findings per class and total teeth from a complete inference', () => {
		const out = countFindings(complete);
		expect(out.dz_1).toBe(2);
		expect(out.dz_2).toBe(1);
		expect(out.dz_5).toBe(1);
		expect(out.toothCount).toBe(5);
	});

	it('does not throw when number_result is missing (counts diseases, toothCount 0)', () => {
		const partial = {
			extra: { disease_result: { result: { labels: [3, 3] } } }
		} as unknown as InferenceResponse;
		const out = countFindings(partial);
		expect(out.dz_3).toBe(2);
		expect(out.toothCount).toBe(0);
	});

	it('does not throw when disease_result is missing (no dz_ keys, counts teeth)', () => {
		const partial = {
			extra: { number_result: { result: { labels: [11, 12] } } }
		} as unknown as InferenceResponse;
		const out = countFindings(partial);
		expect(out.toothCount).toBe(2);
		expect(Object.keys(out).some((k) => k.startsWith('dz_'))).toBe(false);
	});

	it('does not throw when extra is entirely absent', () => {
		const out = countFindings({} as unknown as InferenceResponse);
		expect(out.toothCount).toBe(0);
	});

	it('does not throw on a null/undefined inference', () => {
		expect(countFindings(null as unknown as InferenceResponse).toothCount).toBe(0);
		expect(countFindings(undefined as unknown as InferenceResponse).toothCount).toBe(0);
	});

	it('returns toothCount 0 for empty label arrays (no NaN/undefined)', () => {
		const empty = {
			extra: {
				disease_result: { result: { labels: [] } },
				number_result: { result: { labels: [] } }
			}
		} as unknown as InferenceResponse;
		const out = countFindings(empty);
		expect(out.toothCount).toBe(0);
		expect(Object.keys(out)).toEqual(['toothCount']);
	});
});
