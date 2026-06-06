import { describe, it, expect } from 'vitest';
import { isRenderableModel } from './renderableModel';

describe('isRenderableModel', () => {
	it('true for a normal model (meshes + finite, non-zero bbox)', () => {
		expect(isRenderableModel(3, { x: 100, y: 80, z: 60 })).toBe(true);
		expect(isRenderableModel(1, { x: 1, y: 1, z: 1 })).toBe(true);
	});

	it('false for zero meshes (a valid GLTF with no isMesh nodes → black viewport)', () => {
		// The D7 bug: loadGLTF committed this and fired onstats({count:0}) with no error.
		expect(isRenderableModel(0, { x: 100, y: 80, z: 60 })).toBe(false);
	});

	it('false for a fully-degenerate (zero-extent) bbox', () => {
		expect(isRenderableModel(2, { x: 0, y: 0, z: 0 })).toBe(false);
	});

	it('false for a non-finite bbox component (NaN / ±Infinity from junk vertices)', () => {
		expect(isRenderableModel(2, { x: NaN, y: 80, z: 60 })).toBe(false);
		expect(isRenderableModel(2, { x: 100, y: Infinity, z: 60 })).toBe(false);
		expect(isRenderableModel(2, { x: 100, y: 80, z: -Infinity })).toBe(false);
	});

	it('true for a flat-but-real surface (one zero axis only — matches loadOBJ guard)', () => {
		// A planar slice can have a single zero dimension and still render.
		expect(isRenderableModel(1, { x: 100, y: 0, z: 60 })).toBe(true);
		expect(isRenderableModel(1, { x: 0, y: 80, z: 60 })).toBe(true);
	});

	it('false for a negative or non-finite mesh count (can’t trust it → not renderable)', () => {
		expect(isRenderableModel(-1, { x: 100, y: 80, z: 60 })).toBe(false);
		expect(isRenderableModel(NaN, { x: 100, y: 80, z: 60 })).toBe(false);
	});
});
