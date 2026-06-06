import { describe, it, expect } from 'vitest';
import {
	iou,
	containment,
	toothForDisease,
	groupDiseasesByTooth,
	type Tooth,
	type DiseaseRef
} from './toothMap';
import type { BBox } from './types';

describe('iou', () => {
	it('is 1 for identical boxes', () => {
		expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
	});
	it('is 0 for disjoint boxes', () => {
		expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
	});
	it('is the correct fraction for partial overlap', () => {
		// Two 10×10 boxes overlapping in a 5×10 strip: inter=50, union=150 → 1/3.
		expect(iou([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3, 5);
	});
	it('is 0 for a degenerate (zero-area) box', () => {
		expect(iou([0, 0, 0, 10], [0, 0, 10, 10])).toBe(0);
	});
});

describe('containment', () => {
	it('is 1 when a is fully inside b', () => {
		expect(containment([2, 2, 4, 4], [0, 0, 10, 10])).toBe(1);
	});
	it('is the covered fraction of a (not diluted by b’s area)', () => {
		// A small 2×2 disease box, half inside a big tooth box → 0.5 of A is covered,
		// even though the IoU would be tiny (big tooth area dominates the union).
		const small: BBox = [9, 0, 11, 2]; // 2×2, x∈[9,11]
		const big: BBox = [0, 0, 10, 100]; // covers x∈[9,10] of the small box → half
		expect(containment(small, big)).toBeCloseTo(0.5, 5);
		expect(iou(small, big)).toBeLessThan(0.01); // IoU would have mis-ranked this
	});
	it('is 0 when disjoint', () => {
		expect(containment([0, 0, 2, 2], [5, 5, 7, 7])).toBe(0);
	});
});

describe('toothForDisease', () => {
	const teeth: Tooth[] = [
		{ index: 0, label: 0, box: [0, 0, 20, 60] }, // tooth A (left)
		{ index: 1, label: 1, box: [20, 0, 40, 60] }, // tooth B (middle)
		{ index: 2, label: 2, box: [40, 0, 60, 60] } // tooth C (right)
	];

	it('assigns a disease box to the tooth that most contains it', () => {
		// A caries box well inside tooth B.
		expect(toothForDisease([24, 10, 34, 25], teeth)).toBe(1);
	});

	it('assigns a box straddling two teeth to the one with greater containment', () => {
		// Mostly inside C (x 42→58) with a sliver in B.
		expect(toothForDisease([42, 5, 58, 20], teeth)).toBe(2);
	});

	it('falls back to the nearest tooth centre when nothing overlaps (apical lesion below the arch)', () => {
		// A radiolucency well below all crown boxes, horizontally under tooth A.
		expect(toothForDisease([2, 90, 18, 110], teeth)).toBe(0);
	});

	it('returns null when there are no teeth detected', () => {
		expect(toothForDisease([0, 0, 10, 10], [])).toBeNull();
	});
});

describe('groupDiseasesByTooth', () => {
	const teeth: Tooth[] = [
		{ index: 0, label: 5, box: [0, 0, 20, 60] },
		{ index: 1, label: 6, box: [20, 0, 40, 60] },
		{ index: 2, label: 7, box: [40, 0, 60, 60] }
	];

	it('groups multiple diseases under the same tooth', () => {
		const diseases: DiseaseRef[] = [
			{ index: 0, label: 9, box: [22, 5, 32, 15], score: 0.8 }, // tooth 1: calculus
			{ index: 1, label: 5, box: [24, 30, 36, 50], score: 0.7 }, // tooth 1: bone loss
			{ index: 2, label: 0, box: [2, 5, 12, 18], score: 0.6 } // tooth 0: caries
		];
		const { groups, unassigned } = groupDiseasesByTooth(diseases, teeth);
		expect(unassigned).toEqual([]);
		const byTooth = Object.fromEntries(groups.map((g) => [g.tooth.index, g.diseases.length]));
		expect(byTooth[1]).toBe(2); // two findings under tooth index 1
		expect(byTooth[0]).toBe(1);
		expect(byTooth[2]).toBeUndefined(); // tooth 2 has no findings → no row
	});

	it('preserves the disease detection index (the stable id used to toggle the canvas)', () => {
		const diseases: DiseaseRef[] = [{ index: 7, label: 9, box: [22, 5, 32, 15], score: 0.8 }];
		const { groups } = groupDiseasesByTooth(diseases, teeth);
		expect(groups[0]!.diseases[0]!.index).toBe(7);
	});

	it('returns unplaceable diseases as unassigned (no teeth) rather than dropping them', () => {
		const diseases: DiseaseRef[] = [{ index: 0, label: 9, box: [0, 0, 10, 10], score: 0.5 }];
		const { groups, unassigned } = groupDiseasesByTooth(diseases, []);
		expect(groups).toEqual([]);
		expect(unassigned).toHaveLength(1);
		expect(unassigned[0]!.index).toBe(0);
	});

	it('orders groups left-to-right within a row so the list reads like the mouth', () => {
		const diseases: DiseaseRef[] = [
			{ index: 0, label: 9, box: [44, 5, 54, 15], score: 0.8 }, // tooth 2 (right)
			{ index: 1, label: 9, box: [2, 5, 12, 15], score: 0.8 } // tooth 0 (left)
		];
		const { groups } = groupDiseasesByTooth(diseases, teeth);
		expect(groups.map((g) => g.tooth.index)).toEqual([0, 2]); // left then right
	});
});
