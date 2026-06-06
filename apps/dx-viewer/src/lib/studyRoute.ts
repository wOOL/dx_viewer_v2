import { resolve } from '$app/paths';
import type { Modality } from './modality';

/**
 * The viewer route a study should open in, by modality. Single source of truth
 * for the modality → viewer-route mapping.
 *
 * Mirrors exactly what the patient page's `openStudy()` produces (it resolves
 * `/(app)/cbct/[patientId]/[studyId]`, `/(app)/ios/...`, `/(app)/viewer/...`;
 * SvelteKit's `resolve()` strips the `(app)` route-group parens, so the live
 * URLs are `/cbct/{patientId}/{studyId}` etc.):
 *   - cbct → `/cbct/{patientId}/{studyId}`   (3D volume viewer)
 *   - ios  → `/ios/{patientId}/{studyId}`    (3D mesh viewer)
 *   - everything else (2D raster: xray / panoramic / photo)
 *          → `/viewer/{patientId}/{studyId}` (2D image viewer)
 *
 * Param order is always `patientId` then `studyId`.
 *
 * NOTE: `openStudy()` in the patient page could later be refactored to call this
 * helper so the mapping lives in exactly one place.
 */
export function studyRoutePath(
	modality: Modality | string | undefined | null,
	patientId: string,
	studyId: string
): string {
	// Built through SvelteKit's resolve() (typed routes; strips the (app) group parens)
	// so every consumer's navigation is genuinely resolve()-backed.
	const params = { patientId, studyId };
	if (modality === 'cbct') return resolve('/(app)/cbct/[patientId]/[studyId]', params);
	if (modality === 'ios') return resolve('/(app)/ios/[patientId]/[studyId]', params);
	return resolve('/(app)/viewer/[patientId]/[studyId]', params);
}

/**
 * The viewer routes that can host a study. Each maps to exactly one set of
 * modalities (see {@link routeKindFor}); a study on the wrong route should be
 * redirected to its real home via {@link studyRoutePath}.
 */
export type ViewerRouteKind = 'cbct' | 'ios' | 'viewer';

/**
 * The viewer route a modality belongs on. `cbct` → CBCT viewer, `ios` → IOS
 * viewer, everything else (the 2D raster modalities xray/panoramic/photo, plus
 * unknown/missing) → the 2D viewer. Kept consistent with {@link studyRoutePath}.
 */
export function routeKindFor(modality: Modality | string | undefined | null): ViewerRouteKind {
	if (modality === 'cbct') return 'cbct';
	if (modality === 'ios') return 'ios';
	return 'viewer';
}

/**
 * True when a study of the given modality is at home on the given viewer route.
 * Used by the route pages to detect a wrong-modality landing (e.g. a 2D X-ray
 * opened on `/cbct`, or a CBCT opened on `/ios`) and redirect it to its real
 * home. Exact by construction, so it can never trigger a redirect loop: the
 * route a study redirects to (via {@link studyRoutePath}) is the one where this
 * returns true.
 */
export function studyBelongsOnRoute(
	modality: Modality | string | undefined | null,
	route: ViewerRouteKind
): boolean {
	return routeKindFor(modality) === route;
}
