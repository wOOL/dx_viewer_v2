import { describe, it, expect } from 'vitest';
import { capForPrint } from './printout';

describe('capForPrint', () => {
	it('returns everything when the list is under the cap', () => {
		const r = capForPrint([1, 2, 3], 60);
		expect(r.shown).toEqual([1, 2, 3]);
		expect(r.omitted).toBe(0);
	});

	it('returns everything when the list is exactly at the cap', () => {
		const list = Array.from({ length: 60 }, (_, i) => i);
		const r = capForPrint(list, 60);
		expect(r.shown).toHaveLength(60);
		expect(r.omitted).toBe(0);
	});

	it('caps and reports the omitted count when over the cap', () => {
		const list = Array.from({ length: 200 }, (_, i) => i);
		const r = capForPrint(list, 60);
		expect(r.shown).toHaveLength(60);
		expect(r.shown[0]).toBe(0);
		expect(r.shown[59]).toBe(59);
		expect(r.omitted).toBe(140);
	});

	it('handles an empty list', () => {
		const r = capForPrint([], 60);
		expect(r.shown).toEqual([]);
		expect(r.omitted).toBe(0);
	});

	it('guards a non-positive or non-finite cap (caps to zero, omits all)', () => {
		expect(capForPrint([1, 2, 3], 0)).toEqual({ shown: [], omitted: 3 });
		expect(capForPrint([1, 2, 3], -5)).toEqual({ shown: [], omitted: 3 });
		expect(capForPrint([1, 2, 3], Number.NaN)).toEqual({ shown: [], omitted: 3 });
	});

	it('floors a fractional cap', () => {
		const list = [1, 2, 3, 4, 5];
		const r = capForPrint(list, 2.9);
		expect(r.shown).toEqual([1, 2]);
		expect(r.omitted).toBe(3);
	});

	it('guards a non-array input', () => {
		// @ts-expect-error testing defensive runtime guard
		expect(capForPrint(null, 60)).toEqual({ shown: [], omitted: 0 });
	});
});
