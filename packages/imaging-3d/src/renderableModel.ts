// Decide whether a just-loaded 3D model is actually renderable, or whether it's
// empty/degenerate and would draw a silent BLACK viewport.
//
// D7 — Volume3D.loadGLTF collects meshes via model.traverse(); a structurally
// valid GLTF/GLB with no isMesh nodes yields zero meshes, fits the camera to a
// zero-size box, fires onstats({count:0}) and clears the spinner — so the user
// sees a black canvas with no error and no way to tell what went wrong. loadOBJ
// already guards the empty/degenerate case (→ loadErrEmpty); this extracts the
// SAME decision so loadGLTF can mirror it, and so the (WebGL-bound, hard-to-test)
// component logic is covered by a pure unit test.
//
// "Renderable" means: at least one mesh AND a finite, non-zero-extent bounding
// box. A zero-size box (every dimension 0) or any non-finite component (NaN /
// ±Infinity coordinates, which a lenient parser can produce from junk vertices)
// means nothing visible would draw — treat as not renderable.

/** A bounding-box size (extent along each axis). */
export interface BBoxSize {
	x: number;
	y: number;
	z: number;
}

/**
 * Is a loaded model renderable (something will actually be drawn)?
 *
 *  - `meshCount` — number of THREE.Mesh nodes collected from the model.
 *  - `bboxSize`  — the model's bounding-box extent (THREE.Box3 getSize).
 *
 * Returns false when there are no meshes, or when the bbox is degenerate:
 * a non-finite component, or zero extent on every axis. Otherwise true.
 *
 * NOTE: a flat-but-real surface can legitimately have ONE zero axis (e.g. a
 * perfectly planar slice), so we only reject when ALL three are zero — matching
 * loadOBJ's existing `(size.x === 0 && size.y === 0 && size.z === 0)` guard.
 */
export function isRenderableModel(meshCount: number, bboxSize: BBoxSize): boolean {
	if (!Number.isFinite(meshCount) || meshCount <= 0) return false;
	const { x, y, z } = bboxSize;
	if (![x, y, z].every(Number.isFinite)) return false;
	if (x === 0 && y === 0 && z === 0) return false;
	return true;
}
