import { describe, it, expect } from 'vitest';
import { isDegenerateMeasure, MEASURE_MIN_SEP_FRACTION } from './measure';

// The 3D surface-measure tool commits on the 2nd click. A fat-finger double-click puts both
// points at ~the same spot → a 0 mm segment that gets persisted and replayed. This guard
// (the 3D sibling of MprPane's bare-click reject) must drop such degenerate pairs while
// still committing genuine measurements, and must scale with the model so the same code
// works for a small IOS mesh and a large CBCT volume.

describe('isDegenerateMeasure', () => {
	const HINT = 5; // modelScaleHint() falls back to 5 when the model has no extent

	it('rejects a zero-length (exact double-click) pair', () => {
		expect(isDegenerateMeasure(0, HINT)).toBe(true);
	});

	it('rejects a pair just inside the min separation', () => {
		const minSep = HINT * MEASURE_MIN_SEP_FRACTION; // 1.5
		expect(isDegenerateMeasure(minSep - 0.001, HINT)).toBe(true);
	});

	it('commits exactly at the boundary (>= keeps a real, deliberate short measure)', () => {
		const minSep = HINT * MEASURE_MIN_SEP_FRACTION;
		expect(isDegenerateMeasure(minSep, HINT)).toBe(false);
	});

	it('commits a normal measurement', () => {
		expect(isDegenerateMeasure(50, HINT)).toBe(false);
	});

	it('is scale-relative — a 2-unit gap is degenerate on a 100-scale model but fine on a tiny one', () => {
		expect(isDegenerateMeasure(2, 100)).toBe(true); // minSep 30
		expect(isDegenerateMeasure(2, 5)).toBe(false); // minSep 1.5
	});

	it('rejects a NaN distance defensively (never commits garbage)', () => {
		expect(isDegenerateMeasure(NaN, HINT)).toBe(true);
	});
});
