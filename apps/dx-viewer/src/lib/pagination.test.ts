import { describe, it, expect } from 'vitest';
import { paginate } from './pagination';

const nums = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('paginate', () => {
	it('slices the requested page', () => {
		const r = paginate(nums(50), 0, 10);
		expect(r.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(r.page).toBe(0);
		expect(r.pageCount).toBe(5);
		expect(r.total).toBe(50);
	});

	it('slices a middle and a partial last page', () => {
		expect(paginate(nums(50), 2, 10).items).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
		const last = paginate(nums(23), 2, 10); // 23 items → page 2 has 3
		expect(last.items).toEqual([20, 21, 22]);
		expect(last.pageCount).toBe(3);
	});

	it('clamps an out-of-range page to the last page (shrinking list never strands the view)', () => {
		const r = paginate(nums(15), 9, 10); // only 2 pages exist
		expect(r.page).toBe(1);
		expect(r.items).toEqual([10, 11, 12, 13, 14]);
	});

	it('clamps a negative / non-finite page to 0', () => {
		expect(paginate(nums(15), -3, 10).page).toBe(0);
		expect(paginate(nums(15), NaN, 10).page).toBe(0);
	});

	it('handles an empty list (one empty page, not zero)', () => {
		const r = paginate([], 0, 10);
		expect(r.items).toEqual([]);
		expect(r.pageCount).toBe(1);
		expect(r.total).toBe(0);
	});

	it('guards a bad pageSize', () => {
		expect(paginate(nums(5), 0, 0).pageSize).toBe(1);
		expect(paginate(nums(5), 0, -10).pageSize).toBe(1);
	});
});
