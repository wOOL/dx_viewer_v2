import { describe, it, expect, vi } from 'vitest';
import { disposeObject3D } from './disposeObject3D';

// Minimal stub factories carrying dispose spies — no real three.js / WebGL.
type Spy = ReturnType<typeof vi.fn>;
type Stub = { dispose: Spy };
// A concretely-typed test node so the test's own children/iteration is checked
// (the production Object3DLike is deliberately loose with `unknown` members).
interface StubNode {
	geometry?: Stub | null;
	material?: Stub | Stub[] | null;
	children?: StubNode[];
	traverse?: (cb: (o: StubNode) => void) => void;
}

function tex(): Stub {
	return { dispose: vi.fn() };
}
function geom(): Stub {
	return { dispose: vi.fn() };
}
function mat(extra: Record<string, unknown> = {}): Stub {
	return { dispose: vi.fn(), ...extra } as Stub;
}

/** A stub node with an Object3D-like `traverse` that visits self + descendants
 *  (matching THREE.Object3D.traverse semantics) so we exercise the traverse path. */
function node(props: Partial<StubNode> = {}): StubNode {
	const self: StubNode = {
		geometry: props.geometry ?? null,
		material: props.material ?? null,
		children: props.children ?? []
	};
	self.traverse = (cb: (o: StubNode) => void) => {
		cb(self);
		for (const c of self.children ?? []) {
			// children in these stubs are leaves or carry their own traverse
			if (typeof c.traverse === 'function') c.traverse(cb);
			else cb(c);
		}
	};
	return self;
}

describe('disposeObject3D', () => {
	it('disposes every mesh geometry, material, and material texture exactly once', () => {
		const g = geom();
		const t = tex();
		const m = mat({ map: t });
		const root = node({ geometry: g, material: m });

		disposeObject3D(root);

		expect(g.dispose).toHaveBeenCalledTimes(1);
		expect(m.dispose).toHaveBeenCalledTimes(1);
		expect(t.dispose).toHaveBeenCalledTimes(1);
	});

	it('handles a material array (multi-material mesh)', () => {
		const t1 = tex();
		const t2 = tex();
		const m1 = mat({ map: t1 });
		const m2 = mat({ normalMap: t2 });
		const root = node({ geometry: geom(), material: [m1, m2] });

		disposeObject3D(root);

		expect(m1.dispose).toHaveBeenCalledTimes(1);
		expect(m2.dispose).toHaveBeenCalledTimes(1);
		expect(t1.dispose).toHaveBeenCalledTimes(1);
		expect(t2.dispose).toHaveBeenCalledTimes(1);
	});

	it('disposes textures across all known map slots', () => {
		const map = tex();
		const normalMap = tex();
		const emissiveMap = tex();
		const m = mat({ map, normalMap, emissiveMap });
		disposeObject3D(node({ material: m }));
		expect(map.dispose).toHaveBeenCalledTimes(1);
		expect(normalMap.dispose).toHaveBeenCalledTimes(1);
		expect(emissiveMap.dispose).toHaveBeenCalledTimes(1);
	});

	it('does NOT dispose geometries in the keep set (remesh cache)', () => {
		const kept = geom();
		const m = mat();
		const root = node({ geometry: kept, material: m });

		disposeObject3D(root, new Set([kept]));

		expect(kept.dispose).not.toHaveBeenCalled();
		// material is never cached → still disposed
		expect(m.dispose).toHaveBeenCalledTimes(1);
	});

	it('still disposes a NON-kept geometry when other geometries are kept', () => {
		const kept = geom();
		const dropped = geom();
		const root = node({
			children: [node({ geometry: kept }), node({ geometry: dropped })]
		});

		disposeObject3D(root, new Set([kept]));

		expect(kept.dispose).not.toHaveBeenCalled();
		expect(dropped.dispose).toHaveBeenCalledTimes(1);
	});

	it('disposes resources on nested children via traverse', () => {
		const childGeom = geom();
		const childMat = mat();
		const root = node({
			children: [node({ geometry: childGeom, material: childMat })]
		});

		disposeObject3D(root);

		expect(childGeom.dispose).toHaveBeenCalledTimes(1);
		expect(childMat.dispose).toHaveBeenCalledTimes(1);
	});

	it('disposes a geometry/material shared by two nodes only once', () => {
		const sharedGeom = geom();
		const sharedMat = mat();
		const root = node({
			children: [
				node({ geometry: sharedGeom, material: sharedMat }),
				node({ geometry: sharedGeom, material: sharedMat })
			]
		});

		disposeObject3D(root);

		expect(sharedGeom.dispose).toHaveBeenCalledTimes(1);
		expect(sharedMat.dispose).toHaveBeenCalledTimes(1);
	});

	it('walks a plain stub tree (no traverse) via children recursion', () => {
		const g = geom();
		const m = mat({ map: tex() });
		const childGeom = geom();
		const childMat = mat();
		// No traverse function → forces the manual children walk.
		const root: StubNode = {
			geometry: g,
			material: m,
			children: [{ geometry: childGeom, material: childMat }]
		};

		disposeObject3D(root);

		expect(g.dispose).toHaveBeenCalledTimes(1);
		expect(m.dispose).toHaveBeenCalledTimes(1);
		expect(childGeom.dispose).toHaveBeenCalledTimes(1);
		expect(childMat.dispose).toHaveBeenCalledTimes(1);
	});

	it('is a no-op on null/undefined', () => {
		expect(() => disposeObject3D(null)).not.toThrow();
		expect(() => disposeObject3D(undefined)).not.toThrow();
	});

	it('tolerates nodes with no geometry/material', () => {
		const root = node({ children: [node(), node()] });
		expect(() => disposeObject3D(root)).not.toThrow();
		// requireAssertions: a positive assertion that the empty walk is safe.
		expect(root.children?.length).toBe(2);
	});

	it('ignores map slots that are not disposable', () => {
		// A material whose `map` is null / a plain value must not throw.
		const m = mat({ map: null, normalMap: 42 });
		expect(() => disposeObject3D(node({ material: m }))).not.toThrow();
		expect(m.dispose).toHaveBeenCalledTimes(1);
	});
});
