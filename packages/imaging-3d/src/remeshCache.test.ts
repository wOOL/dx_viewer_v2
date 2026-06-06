import { describe, it, expect } from 'vitest';
import { getRemesh, setRemesh } from './remeshCache';
import type { BufferGeometry } from 'three';

// Stand-in geometries — the cache is type-agnostic (it only stores/returns refs).
const geom = (id: string) => ({ id }) as unknown as BufferGeometry;

describe('remeshCache', () => {
	it('returns undefined for an unseen blob/index', () => {
		const blob = new Blob(['a']);
		expect(getRemesh(blob, 0)).toBeUndefined();
	});

	it('round-trips a stored geometry by (blob, index)', () => {
		const blob = new Blob(['b']);
		const g0 = geom('g0');
		const g1 = geom('g1');
		setRemesh(blob, 0, g0);
		setRemesh(blob, 1, g1);
		expect(getRemesh(blob, 0)).toBe(g0);
		expect(getRemesh(blob, 1)).toBe(g1);
		expect(getRemesh(blob, 2)).toBeUndefined();
	});

	it('keys per blob — a different blob object is a separate cache', () => {
		const a = new Blob(['x']);
		const b = new Blob(['x']); // same bytes, different object
		setRemesh(a, 0, geom('a0'));
		expect(getRemesh(b, 0)).toBeUndefined();
		expect((getRemesh(a, 0) as unknown as { id: string }).id).toBe('a0');
	});
});
