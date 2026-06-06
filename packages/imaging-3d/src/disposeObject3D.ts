// Pure-ish Three.js GPU-resource teardown helpers for the 3D viewer (Volume3D).
//
// Volume3D's route remounts per study (`{#key study.id}`), so every CBCT/IOS
// study opened-then-left used to leak ALL its GPU resources — mesh geometries,
// materials, material maps/textures, and the label/marker Sprite CanvasTextures
// — because `onDestroy` only called `renderer.dispose()`. WebGL has a hard cap
// on live contexts/VRAM, so this accumulates until the browser drops the
// context (black canvas). These helpers traverse an Object3D tree and dispose
// every disposable, so teardown reclaims everything.
//
// `keep` lets the caller protect geometries that are still referenced elsewhere
// — specifically the module-level `remeshCache` WeakMap that memoises the
// expensive voxel-remesh per blob. Disposing a cached geometry on unmount would
// force a ~2.5s re-remesh on the next load of the SAME segmentation (and render
// a GPU-freed geometry in between). Materials/textures are NOT cached, so
// they're always disposed.
//
// Duck-typed at runtime against the minimal `{ dispose() }` surface and a loose
// public signature (`Object3DLike`), so a real THREE.Object3D AND a plain stub
// tree both pass without fighting THREE's rich generic types. That also makes it
// trivially unit-testable with plain stub objects carrying dispose spies — no
// WebGL/jsdom needed.

/** Anything with a no-arg dispose() (geometry, material, texture, controls…). */
export interface Disposable {
	dispose(): void;
}

/** A loose, structurally-permissive view of a THREE.Object3D / Mesh / Sprite.
 *  Deliberately uses `unknown`/optional members so a real (richly-typed) THREE
 *  node and a hand-rolled stub both satisfy it; the runtime narrows each field. */
export interface Object3DLike {
	geometry?: unknown;
	material?: unknown;
	children?: unknown;
	/** THREE.Object3D.traverse — present on real nodes; we fall back to a manual
	 *  recursion over `children` when it's absent (e.g. plain stub trees). */
	traverse?: (cb: (o: unknown) => void) => void;
}

// Well-known THREE.Material texture-map slots. Disposing the material does not
// dispose these, so we walk them explicitly. (Listing the slots — rather than
// scanning every property — avoids disposing unrelated shared objects.)
const TEXTURE_MAP_KEYS = [
	'map',
	'alphaMap',
	'aoMap',
	'bumpMap',
	'displacementMap',
	'emissiveMap',
	'envMap',
	'lightMap',
	'metalnessMap',
	'normalMap',
	'roughnessMap',
	'specularMap',
	'gradientMap',
	'clearcoatMap',
	'clearcoatNormalMap',
	'clearcoatRoughnessMap',
	'sheenColorMap',
	'sheenRoughnessMap',
	'transmissionMap',
	'thicknessMap',
	'matcap'
] as const;

function isDisposable(v: unknown): v is Disposable {
	return !!v && typeof (v as { dispose?: unknown }).dispose === 'function';
}

/** Dispose a material plus every texture it references through a known map slot.
 *  A texture/material already in `seen` is skipped, so a resource shared across
 *  slots/nodes is disposed exactly once. */
function disposeMaterial(mat: unknown, seen: Set<unknown>): void {
	if (!mat || typeof mat !== 'object') return;
	const m = mat as Record<string, unknown>;
	for (const key of TEXTURE_MAP_KEYS) {
		const tex = m[key];
		if (isDisposable(tex) && !seen.has(tex)) {
			seen.add(tex);
			tex.dispose();
		}
	}
	if (isDisposable(mat) && !seen.has(mat)) {
		seen.add(mat);
		mat.dispose();
	}
}

/**
 * Traverse `root` and dispose every mesh/sprite geometry, material (handles a
 * material array), and each material's textures (map slots), so all GPU
 * resources are freed. Geometries present in `keep` are skipped (still
 * referenced by the remesh cache). Every resource is disposed at most once (a
 * geometry/material/texture shared by multiple nodes is tracked in a `seen` set).
 *
 * Safe on null/undefined and on partial stub trees (no `traverse`).
 */
export function disposeObject3D(root: Object3DLike | null | undefined, keep?: Set<unknown>): void {
	if (!root) return;
	const seen = new Set<unknown>();
	const visit = (o: unknown) => {
		if (!o || typeof o !== 'object') return;
		const node = o as Object3DLike;
		const geom = node.geometry;
		if (isDisposable(geom) && !seen.has(geom) && !(keep && keep.has(geom))) {
			seen.add(geom);
			geom.dispose();
		}
		const mat = node.material;
		if (Array.isArray(mat)) {
			for (const m of mat) disposeMaterial(m, seen);
		} else if (mat) {
			disposeMaterial(mat, seen);
		}
	};
	if (typeof root.traverse === 'function') {
		// THREE.Object3D.traverse already visits root + all descendants.
		root.traverse(visit);
	} else {
		// Plain stub tree: recurse over children ourselves.
		const stack: unknown[] = [root];
		while (stack.length) {
			const node = stack.pop();
			visit(node);
			const children = (node as Object3DLike | null)?.children;
			if (Array.isArray(children)) for (const c of children) stack.push(c);
		}
	}
}
