// Counts of the anatomic structures the CBCT segmentation model ACTUALLY produces.
//
// CRITICAL (the (a) "fabricated/impossible AI content" class): sinus is deliberately NOT
// reported. The model has no sinus segmentation class (AI-limited, logged in
// DIAGNOCAT_3D_GAPS), so a hardcoded "Sinus: 0" row would falsely imply the sinus was
// assessed and found clear. Only teeth / jaws / canals — structures the model emits — are
// counted; the UI shows exactly these keys.
//
// At small mesh counts (≤5) the AI is segmenting anatomic CLASSES (enamel / dentin / pulp),
// not per-tooth instances, so guessing "Teeth: N" would over-call — report a generic
// structure count instead.

export interface AnatomyCounts {
	teeth: number;
	jaws: number;
	canals: number;
	/** Present ONLY for a small/class-level volume (≤5 meshes) where per-instance counts
	 *  aren't meaningful; the UI then shows "Structures: N" instead of teeth/jaws/canals. */
	structures?: number;
}

const SMALL_VOLUME_MAX = 5;

export function computeAnatomyCounts(
	meshCount: number,
	byFdiCount: number,
	jawCount: number,
	canalCount: number
): AnatomyCounts {
	if (!(meshCount > 0)) return { teeth: 0, jaws: 0, canals: 0 };
	if (meshCount <= SMALL_VOLUME_MAX) return { teeth: 0, jaws: 0, canals: 0, structures: meshCount };
	return {
		// Prefer the real FDI-mapped tooth count; fall back to an estimate (everything that
		// isn't a jaw or canal) when no tooth got an FDI label.
		teeth: byFdiCount > 0 ? byFdiCount : Math.max(0, meshCount - jawCount - canalCount),
		jaws: jawCount,
		canals: canalCount
	};
}
