import { describe, it, expect } from 'vitest';
import { createCbctState, type CbctMeasurement } from './state.svelte';
import type { Volume } from './volumeLoader';

const measurement: CbctMeasurement = { axis: 'axial', slice: 0, a: [0, 0], b: [1, 1], mm: 5 };

function volume(): Volume {
	return {
		data: new Float32Array(8),
		dims: [2, 2, 2],
		spacing: [1, 1, 1],
		min: 0,
		max: 100,
		defaultWindow: 1500,
		defaultLevel: 300
	};
}

describe('createCbctState — markup management (backs CBCT measurement persistence)', () => {
	it('adds and clears measurements / angles / annotations', () => {
		const s = createCbctState();
		s.addMeasurement(measurement);
		s.addAngle({ axis: 'axial', slice: 0, a: [0, 0], vertex: [1, 1], c: [2, 2], deg: 90 });
		s.addAnnotation({ axis: 'axial', slice: 0, p: [0, 0], text: 'note' });
		expect(s.measurements).toHaveLength(1);
		expect(s.angles).toHaveLength(1);
		expect(s.annotations).toHaveLength(1);

		s.clearMarkups();
		expect(s.measurements).toHaveLength(0);
		expect(s.angles).toHaveLength(0);
		expect(s.annotations).toHaveLength(0);
	});

	it('setVolume centres the slice, resets W/L to the volume defaults, and DROPS stale markups', () => {
		const s = createCbctState();
		s.addMeasurement(measurement);
		s.setVolume(volume());
		// A fresh volume must not inherit the previous study's markups.
		expect(s.measurements).toHaveLength(0);
		expect(s.slice).toEqual({ axial: 1, coronal: 1, sagittal: 1 }); // floor(dim/2)
		expect(s.windowVal).toBe(1500);
		expect(s.levelVal).toBe(300);
	});

	it('loadMarkups restores persisted markups (and tolerates missing arrays)', () => {
		const s = createCbctState();
		s.loadMarkups({ measurements: [measurement] });
		expect(s.measurements).toHaveLength(1);
		expect(s.angles).toHaveLength(0); // undefined → []
		expect(s.annotations).toHaveLength(0);
	});

	it('resetWL restores the volume default window/level', () => {
		const s = createCbctState();
		s.setVolume(volume());
		s.windowVal = 50;
		s.levelVal = 10;
		s.resetWL();
		expect(s.windowVal).toBe(1500);
		expect(s.levelVal).toBe(300);
	});
});
