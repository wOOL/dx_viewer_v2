import { describe, it, expect } from 'vitest';
import { canDenoiseMesh, DENOISE_MAX_TRIANGLES } from './denoiseGuard';

describe('canDenoiseMesh', () => {
	it('runs for a small mesh (well below the cap)', () => {
		expect(canDenoiseMesh(10_000)).toBe(true);
	});

	it('runs exactly at the cap', () => {
		expect(canDenoiseMesh(DENOISE_MAX_TRIANGLES)).toBe(true);
	});

	it('skips one triangle above the cap', () => {
		expect(canDenoiseMesh(DENOISE_MAX_TRIANGLES + 1)).toBe(false);
	});

	it('skips a multi-million-triangle full-res CBCT jaw mesh', () => {
		expect(canDenoiseMesh(3_000_000)).toBe(false);
	});

	it('runs for zero triangles (degenerate but finite, nothing to do)', () => {
		expect(canDenoiseMesh(0)).toBe(true);
	});

	it('skips a non-finite count (can’t size it → do not risk a freeze)', () => {
		expect(canDenoiseMesh(NaN)).toBe(false);
		expect(canDenoiseMesh(Infinity)).toBe(false);
	});

	it('skips a negative count', () => {
		expect(canDenoiseMesh(-5)).toBe(false);
	});

	it('honours a custom max', () => {
		expect(canDenoiseMesh(100, 50)).toBe(false);
		expect(canDenoiseMesh(40, 50)).toBe(true);
	});
});
