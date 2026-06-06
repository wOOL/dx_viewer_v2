// Pure helpers for the one-click "drop a file → analysis" flow. Kept free of
// store/AI/DOM imports so it unit-tests cleanly; the orchestration (patient
// auto-create, find_xray crop, inference, navigate) lives in GlobalDropZone.

export type QuickModality = 'image' | 'cbct' | 'ios';

/** The action a quick drop/paste should take given how many files arrived. */
export type QuickDropDecision = 'analyze' | 'tooMany' | 'none';

/**
 * Decide what a quick drop/paste should do based on the number of files.
 *
 * Quick-analyze auto-creates a patient and navigates into a viewer per file, so
 * a multi-file drop (e.g. a 16-film FMX) must NOT silently spawn N patients +
 * N navigations, nor silently analyze only the first and discard the rest — the
 * caller surfaces a notice to use the New Study page for batches instead.
 *
 * - 0 files  → 'none'    (nothing analyzable, e.g. a folder drop)
 * - 1 file   → 'analyze'
 * - 2+ files → 'tooMany' (don't analyze; point the user at New Study)
 */
export function quickDropDecision(fileCount: number): QuickDropDecision {
	if (fileCount <= 0) return 'none';
	if (fileCount === 1) return 'analyze';
	return 'tooMany';
}

// Modality is inferred purely from the file. Image vs CBCT vs IOS extensions are
// non-overlapping, so the suffix is authoritative; for images we also accept the
// MIME type (drag-and-drop sometimes omits a clean extension). X-ray vs panoramic
// is NOT distinguished — they hit the same 2D inference backend.
export function detectModality(file: { name: string; type?: string }): QuickModality | null {
	const n = (file.name || '').toLowerCase();
	if (/\.(nii|nrrd|mha|gipl)$/.test(n) || n.endsWith('.nii.gz') || n.endsWith('.gz')) return 'cbct';
	if (/\.(obj|stl|ply)$/.test(n)) return 'ios';
	if ((file.type ?? '').startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/.test(n))
		return 'image';
	return null;
}

// Auto patient name for a quick scan: the file stem, tidied. Falls back to a
// translatable label so a study always attaches to *some* patient (the one-
// click flow never asks the user to name one). The fallback defaults to
// English so existing call sites without an i18n context keep working.
export function quickPatientName(file: { name: string }, fallback = 'Quick scan'): string {
	const stem = (file.name || '')
		// Strip the extension. Handle the compound medical/archive ones (.nii.gz,
		// .tar.gz) as a unit, else the single trailing extension — otherwise
		// "scan.nii.gz" left a stray "nii" in the auto-generated patient name.
		.replace(/\.(?:nii\.gz|tar\.gz|[^./\\]+)$/i, '')
		.replace(/[._-]+/g, ' ')
		.trim();
	return stem || fallback;
}

// The 2D inference request metadata used for one-click image analysis — mirrors
// the New-Study form's settings so results are identical.
export const QUICK_INFERENCE_META = {
	ensure_dim: true,
	disease_segment: true,
	anatomy_meta_data: { conf_thres: 0.3 },
	number_meta_data: { conf_thres: 0.1, fdi_number: false },
	disease_meta_data: { conf_thres: 0.1 },
	rule_meta_data: { segment_conf_thres: 0.3, limit_dim: 720 }
} as const;
