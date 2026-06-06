import { describe, it, expect } from 'vitest';
import {
	effectiveDetections,
	effectiveCountsByLabel,
	normalizeUserEdits,
	withEffectiveDetections
} from './detections';
import type { InferenceResponse, UserEdits, BBox } from './types';

// A minimal inference with 3 disease detections (one masked) + tooth numbers.
function inf(): InferenceResponse {
	return {
		detection: '',
		tooth_numbers: '',
		segmentation: '',
		report: '',
		extra: {
			disease_result: {
				result: {
					bboxes: [
						[0, 0, 10, 10],
						[20, 20, 30, 30],
						[40, 40, 50, 50]
					] as BBox[],
					labels: [5, 9, 0],
					scores: [0.9, 0.4, 0.8],
					masks: [null, null, { counts: 'abc', size: [100, 100] }] // det 2 is masked
				},
				extra: { class_probs: [], bboxes_var: [] }
			},
			number_result: { result: { bboxes: [], labels: [], scores: [] } },
			anatomy_result: { result: { bboxes: [], labels: [], scores: [] }, extra: { anomaly: false } }
		}
	};
}

const noEdits: UserEdits = { hidden: [], added: [], resized: {} };

describe('effectiveDetections — base (no edits)', () => {
	it('returns all AI detections above the threshold, in order, marked source=ai', () => {
		const d = effectiveDetections(inf(), noEdits, 0);
		expect(d).toHaveLength(3);
		expect(d.map((x) => x.aiIndex)).toEqual([0, 1, 2]);
		expect(d.every((x) => x.source === 'ai')).toBe(true);
	});

	it('drops AI detections below the confidence threshold', () => {
		const d = effectiveDetections(inf(), noEdits, 0.5);
		// det 1 (score 0.4) drops; 0 (0.9) and 2 (0.8) stay.
		expect(d.map((x) => x.aiIndex)).toEqual([0, 2]);
	});

	it('marks a masked detection non-editable, a bbox-only one editable', () => {
		const d = effectiveDetections(inf(), noEdits, 0);
		expect(d.find((x) => x.aiIndex === 0)!.editable).toBe(true); // bbox-only
		expect(d.find((x) => x.aiIndex === 2)!.editable).toBe(false); // masked
	});

	it('tolerates a null inference', () => {
		expect(effectiveDetections(null, noEdits, 0)).toEqual([]);
	});
});

describe('effectiveDetections — hide', () => {
	it('drops a hidden AI detection (recoverable: the AI data is untouched)', () => {
		const edits: UserEdits = { ...noEdits, hidden: [1] };
		const d = effectiveDetections(inf(), edits, 0);
		expect(d.map((x) => x.aiIndex)).toEqual([0, 2]);
		// The source inference is not mutated — calling again with no edits restores it.
		expect(effectiveDetections(inf(), noEdits, 0)).toHaveLength(3);
	});
});

describe('effectiveDetections — resize', () => {
	it('uses the resized box instead of the AI box', () => {
		const newBox: BBox = [1, 1, 99, 99];
		const edits: UserEdits = { ...noEdits, resized: { 0: newBox } };
		const d = effectiveDetections(inf(), edits, 0);
		expect(d.find((x) => x.aiIndex === 0)!.box).toEqual(newBox);
	});

	it('makes a previously-masked detection editable once it has been resized to a box', () => {
		const edits: UserEdits = { ...noEdits, resized: { 2: [0, 0, 5, 5] } };
		const d = effectiveDetections(inf(), edits, 0);
		expect(d.find((x) => x.aiIndex === 2)!.editable).toBe(true);
	});
});

describe('effectiveDetections — add', () => {
	it('appends user-added detections after the AI ones, at full score', () => {
		const edits: UserEdits = {
			...noEdits,
			added: [{ id: 'u1', label: 2, box: [5, 5, 15, 15], kind: 'rect' }]
		};
		const d = effectiveDetections(inf(), edits, 0);
		expect(d).toHaveLength(4);
		const u = d[3]!;
		expect(u.source).toBe('user');
		expect(u.addedId).toBe('u1');
		expect(u.label).toBe(2);
		expect(u.editable).toBe(true);
	});

	it('keeps a user-added detection even below the confidence threshold (it has no model score)', () => {
		const edits: UserEdits = {
			...noEdits,
			added: [{ id: 'u1', label: 2, box: [5, 5, 15, 15], kind: 'rect' }]
		};
		// High threshold drops the low-score AI det, but the user one always survives.
		const d = effectiveDetections(inf(), edits, 0.95);
		expect(d.some((x) => x.source === 'user')).toBe(true);
	});

	it('carries a freeform region’s points through', () => {
		const pts: [number, number][] = [
			[0, 0],
			[10, 0],
			[5, 10]
		];
		const edits: UserEdits = {
			...noEdits,
			added: [{ id: 'f1', label: 9, box: [0, 0, 10, 10], kind: 'free', points: pts }]
		};
		const d = effectiveDetections(inf(), edits, 0);
		const f = d.find((x) => x.addedId === 'f1')!;
		expect(f.box).toEqual([0, 0, 10, 10]); // bbox kept (for hit-test/layout)
		// …AND the actual trajectory is preserved, so the overlay can draw the real
		// shape (circle/oval/curve) instead of the bounding rectangle.
		expect(f.kind).toBe('free');
		expect(f.points).toEqual(pts);
	});

	it('a rectangle add carries no points (it IS its box)', () => {
		const edits: UserEdits = {
			...noEdits,
			added: [{ id: 'r1', label: 9, box: [0, 0, 10, 10], kind: 'rect' }]
		};
		const r = effectiveDetections(inf(), edits, 0).find((x) => x.addedId === 'r1')!;
		expect(r.kind).toBe('rect');
		expect(r.points).toBeUndefined();
	});
});

describe('effectiveDetections — combined edits flow into one list', () => {
	it('applies hide + resize + add together', () => {
		const edits: UserEdits = {
			hidden: [1],
			resized: { 0: [2, 2, 8, 8] },
			added: [{ id: 'u1', label: 4, box: [60, 60, 70, 70], kind: 'rect' }]
		};
		const d = effectiveDetections(inf(), edits, 0);
		// det1 hidden; det0 resized; det2 kept; +1 added → 3 total.
		expect(d.map((x) => x.aiIndex ?? x.addedId)).toEqual([0, 2, 'u1']);
		expect(d[0]!.box).toEqual([2, 2, 8, 8]);
	});
});

describe('effectiveCountsByLabel', () => {
	it('counts the EFFECTIVE detections per label (so edits change the numbers)', () => {
		const edits: UserEdits = {
			hidden: [0], // remove the label-5 detection
			resized: {},
			added: [{ id: 'u1', label: 9, box: [0, 0, 1, 1], kind: 'rect' }] // add a 2nd label-9
		};
		const counts = effectiveCountsByLabel(effectiveDetections(inf(), edits, 0));
		expect(counts.get(5)).toBeUndefined(); // hidden
		expect(counts.get(9)).toBe(2); // AI's 1 + user's 1
		expect(counts.get(0)).toBe(1);
	});
});

describe('withEffectiveDetections (the display inference every read-only consumer sees)', () => {
	it('returns the inference unchanged when there are no edits', () => {
		const i = inf();
		expect(withEffectiveDetections(i, null)).toBe(i);
		expect(withEffectiveDetections(i, { hidden: [], added: [], resized: {} })).toBe(i);
	});

	it('rewrites disease_result.result to the merged detections, parallel arrays aligned', () => {
		const edits: UserEdits = {
			hidden: [0],
			resized: {},
			added: [{ id: 'u1', label: 14, box: [1, 2, 3, 4], kind: 'rect' }]
		};
		const out = withEffectiveDetections(inf(), edits)!;
		const r = out.extra.disease_result.result;
		// det0 hidden → starts at det1; +user box at the end.
		expect(r.labels).toEqual([9, 0, 14]);
		expect(r.bboxes).toHaveLength(3);
		expect(r.scores).toHaveLength(3);
		expect(r.masks).toHaveLength(3);
		// The user-added box has no mask; the masked AI det (label 0) keeps its mask.
		expect(r.masks![2]).toBeNull();
		expect(r.masks![1]).not.toBeNull();
	});

	it('carries index-aligned freeform outlines so the overlay draws the real shape', () => {
		const pts: [number, number][] = [
			[10, 10],
			[20, 12],
			[15, 22]
		];
		const edits: UserEdits = {
			hidden: [],
			resized: {},
			added: [
				{ id: 'r1', label: 9, box: [0, 0, 5, 5], kind: 'rect' },
				{ id: 'f1', label: 14, box: [10, 10, 20, 22], kind: 'free', points: pts }
			]
		};
		const r = withEffectiveDetections(inf(), edits)!.extra.disease_result.result;
		// 3 AI dets + 2 added = 5; freeforms aligned: nulls for AI + rect, points for freeform.
		expect(r.freeforms).toHaveLength(5);
		expect(r.freeforms!.slice(0, 4)).toEqual([null, null, null, null]); // AI ×3 + rect
		expect(r.freeforms![4]).toEqual(pts); // the freeform's trajectory, index-aligned with its box
	});

	it('carries index-aligned sources so the overlay can omit the fabricated 100% on user boxes', () => {
		const edits: UserEdits = {
			hidden: [],
			resized: {},
			added: [{ id: 'r1', label: 9, box: [0, 0, 5, 5], kind: 'rect' }]
		};
		const r = withEffectiveDetections(inf(), edits)!.extra.disease_result.result;
		// 3 AI dets + 1 added = 4; sources mark provenance, index-aligned with bboxes/scores.
		expect(r.sources).toEqual(['ai', 'ai', 'ai', 'user']);
		// The user box's score is the synthetic 1 (so it survives the confidence filter) —
		// which is exactly why the overlay must key off `sources`, NOT the score, to decide
		// whether to show a confidence (else a clinician's box reads as "AI 100% confident").
		expect(r.scores[3]).toBe(1);
	});

	it('does NOT mutate the original inference (AI stays pristine)', () => {
		const i = inf();
		const before = i.extra.disease_result.result.labels.slice();
		withEffectiveDetections(i, { hidden: [0], added: [], resized: {} });
		expect(i.extra.disease_result.result.labels).toEqual(before);
	});

	it('passes tooth numbers + anatomy through untouched', () => {
		const i = inf();
		const out = withEffectiveDetections(i, { hidden: [0], added: [], resized: {} })!;
		expect(out.extra.number_result).toBe(i.extra.number_result);
		expect(out.extra.anatomy_result).toBe(i.extra.anatomy_result);
	});

	it('returns null for a null inference', () => {
		expect(withEffectiveDetections(null, { hidden: [1], added: [], resized: {} })).toBeNull();
	});
});

describe('normalizeUserEdits', () => {
	it('fills a full shape from null/garbage', () => {
		expect(normalizeUserEdits(null)).toEqual({ hidden: [], added: [], resized: {} });
		expect(normalizeUserEdits('nonsense')).toEqual({ hidden: [], added: [], resized: {} });
	});
	it('drops non-integer hidden ids', () => {
		expect(normalizeUserEdits({ hidden: [1, 'x', 2.5, 3] }).hidden).toEqual([1, 3]);
	});
	it('passes through valid partial shapes', () => {
		const r = normalizeUserEdits({
			added: [{ id: 'a', label: 1, box: [0, 0, 1, 1], kind: 'rect' }]
		});
		expect(r.added).toHaveLength(1);
		expect(r.hidden).toEqual([]);
	});
});
