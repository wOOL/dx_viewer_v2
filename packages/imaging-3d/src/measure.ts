// Guard for the 2-click 3D surface-measurement tool (Volume3D, used by both CBCT and IOS).
//
// Without this, a fat-finger double-click in measure mode raycasts to ~the same world point
// twice and commits a persisted 0 mm segment — useless clutter that is then saved
// (dxv:cbct:markups:* / dxv:ios:measure:*) and replayed on reload. The 2D MprPane ruler
// already rejects a bare click (`Math.hypot(dx,dy) > 1`); this gives the 3D sibling the
// same protection, scaled to the model so it works for both small IOS meshes (~tens of mm)
// and large CBCT volumes (~hundreds of mm).

/** A second measurement point closer than this fraction of the model's scale hint is treated
 * as a degenerate fat-finger and dropped. ~0.3 of the hint ≈ twice the pending marker radius
 * (the marker is `scaleHint * 0.14`), so anything inside the visible marker is rejected. */
export const MEASURE_MIN_SEP_FRACTION = 0.3;

/** True when a 2nd click is too close to the pending 1st point to be a real measurement.
 * `!(d >= minSep)` (rather than `d < minSep`) also rejects a NaN distance defensively. */
export function isDegenerateMeasure(distanceWorld: number, modelScaleHint: number): boolean {
	const minSep = modelScaleHint * MEASURE_MIN_SEP_FRACTION;
	return !(distanceWorld >= minSep);
}
