import type { BufferGeometry } from 'three';

// Memoise the expensive CBCT voxel-remesh per (segmentation blob, mesh index).
//
// The CBCT MPR layout's 4th pane and the dedicated 3D layout are separate
// `{#if}` branches, so switching between them unmounts + remounts Volume3D —
// which re-runs loadGLTF → voxelRemesh (~2.5s of CPU) on the SAME segmentation.
// CbctWorkspace hands both Volume3D instances the same gltfBlob object, so a
// blob-keyed cache lets the second mount reuse the already-remeshed geometry
// instead of recomputing it.
//
// A cache HIT returns the bit-identical geometry a re-remesh would produce, so
// rendering is unchanged — only the recompute is skipped. WeakMap keys auto-evict
// when the blob is GC'd (i.e. on study navigation), so this holds at most one
// study's geometries (the same set the live scene already references).
//
// This is module-level (shared across component instances), unlike Svelte's
// per-instance `<script>` state — hence the standalone module.

const cache = new WeakMap<Blob, BufferGeometry[]>();

export function getRemesh(blob: Blob, index: number): BufferGeometry | undefined {
	return cache.get(blob)?.[index];
}

export function setRemesh(blob: Blob, index: number, geom: BufferGeometry): void {
	let arr = cache.get(blob);
	if (!arr) {
		arr = [];
		cache.set(blob, arr);
	}
	arr[index] = geom;
}

/** All remeshed geometries currently cached for `blob` (sparse slots filtered out).
 *  Used by Volume3D's teardown to AVOID disposing geometries the cache still hands
 *  back — disposing a cached geometry would force a ~2.5s re-remesh of the same
 *  segmentation on the next load (and render a GPU-freed geometry in between). */
export function getRemeshGeoms(blob: Blob | null | undefined): BufferGeometry[] {
	if (!blob) return [];
	return (cache.get(blob) ?? []).filter((g): g is BufferGeometry => !!g);
}
