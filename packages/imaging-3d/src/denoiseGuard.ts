// Size guard for the Reduce-noise (drop-small-components) cleanup in Volume3D.
//
// `dropSmallComponents` runs a synchronous, un-yielded union-find over every
// triangle of a mesh. A full-resolution CBCT jaw mesh can carry hundreds of
// thousands to millions of triangles, and on that input the union-find hard-
// freezes the tab when the Reduce-noise toggle is flipped — no spinner, no way
// out. (The sibling `voxelRemesh` already has an analogous `nx*ny*nz` perf
// guard.) Above a threshold we skip the cleanup and surface a brief "mesh too
// large to denoise" note instead of freezing.
//
// Pure + tiny so the threshold decision is unit-tested independently of the
// (WebGL-bound, hard-to-test) component.

/** Max triangles we'll run the synchronous union-find denoise over. Beyond this
 *  the O(tris) passes (+ the per-triangle Map work) block the main thread long
 *  enough to look like a freeze, so we skip rather than hang the tab. */
export const DENOISE_MAX_TRIANGLES = 500_000;

/**
 * Decide whether `dropSmallComponents` may run on a mesh with `triangleCount`
 * triangles. Returns false (skip — too large) above DENOISE_MAX_TRIANGLES, true
 * (proceed) at/below it. A non-finite or negative count is treated as "can't
 * size it" → skip, so a degenerate mesh can't slip past the guard.
 */
export function canDenoiseMesh(
	triangleCount: number,
	max: number = DENOISE_MAX_TRIANGLES
): boolean {
	if (!Number.isFinite(triangleCount) || triangleCount < 0) return false;
	return triangleCount <= max;
}
