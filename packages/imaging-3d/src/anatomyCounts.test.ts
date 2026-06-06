import { describe, it, expect } from 'vitest';
import { computeAnatomyCounts } from './anatomyCounts';

// The CBCT anatomy sidebar must count ONLY structures the segmentation model produces.
// Sinus has no model class, so it must never appear (a hardcoded "Sinus: 0" would falsely
// imply the sinus was assessed — the (a) fabricated/impossible-content class).
describe('computeAnatomyCounts', () => {
	it('never includes a sinus key (the model has no sinus class)', () => {
		for (const r of [
			computeAnatomyCounts(0, 0, 0, 0),
			computeAnatomyCounts(3, 0, 0, 0),
			computeAnatomyCounts(32, 28, 2, 3),
			computeAnatomyCounts(10, 0, 2, 3)
		]) {
			expect('sinus' in r).toBe(false);
		}
	});

	it('returns all-zero (no structures key) for an empty/absent volume', () => {
		expect(computeAnatomyCounts(0, 0, 0, 0)).toEqual({ teeth: 0, jaws: 0, canals: 0 });
		expect(computeAnatomyCounts(-1, 0, 0, 0)).toEqual({ teeth: 0, jaws: 0, canals: 0 });
	});

	it('reports a generic structure count for a small/class-level volume (≤5 meshes)', () => {
		// At this scale the AI segments anatomic classes (enamel/dentin/pulp), not teeth —
		// so it must NOT guess per-tooth counts.
		expect(computeAnatomyCounts(5, 0, 0, 0)).toEqual({
			teeth: 0,
			jaws: 0,
			canals: 0,
			structures: 5
		});
	});

	it('uses the real FDI-mapped tooth count when teeth got FDI labels', () => {
		expect(computeAnatomyCounts(33, 28, 2, 3)).toEqual({ teeth: 28, jaws: 2, canals: 3 });
	});

	it('estimates teeth as (total − jaws − canals) when no tooth got an FDI label', () => {
		expect(computeAnatomyCounts(10, 0, 2, 3)).toEqual({ teeth: 5, jaws: 2, canals: 3 });
		// Never negative even if the jaw/canal classification overruns.
		expect(computeAnatomyCounts(6, 0, 5, 4).teeth).toBe(0);
	});
});
