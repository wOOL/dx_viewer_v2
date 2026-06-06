import type { StoredPatient } from '$lib/types';

// Strip diacritics so "andre" matches "André", "muller" matches "Müller" —
// shared across the upload-form suggestions, the quick-assign card, and the
// dashboard search filter (studies/+page.svelte has its own copy for tree-
// shaking; keep them in sync).
export function foldDiacritics(s: string): string {
	return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Patients eligible as a merge target for a quick/temporary patient: everyone
 * except the patient itself and other still-temporary (quick) records. Pure so it
 * can be unit-tested and reused by the assign UI.
 */
export function assignablePatients(patients: StoredPatient[], selfId: string): StoredPatient[] {
	return patients.filter((p) => p.id !== selfId && !p.quick);
}

/**
 * Existing patients whose name contains `query` (case + diacritic-insensitive)
 * — for the New Study form's "add to an existing patient" suggestions. Returns
 * [] for queries under 2 chars so the dropdown only appears once there's
 * something to match. Pure so it's unit-tested and shared. Picking a result
 * attaches the study by patient id (no name/DOB re-match → no accidental
 * duplicate patient).
 */
export function matchPatientsByName(
	patients: StoredPatient[],
	query: string,
	limit = 6
): StoredPatient[] {
	const q = foldDiacritics(query.trim());
	if (q.length < 2) return [];
	return patients.filter((p) => foldDiacritics(p.name).includes(q)).slice(0, limit);
}
