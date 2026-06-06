// Default-tab selection for the patient page, kept pure so the once-per-patient
// (and re-decide-on-patient-change) logic is unit-testable without rendering the
// route component.

export type PatientTab = 'xrays' | 'photos' | '3d';

/** Decide which tab to surface for a patient, returning the tab to switch to, or
 *  null to leave the current tab as-is.
 *
 *  The `decidedFor` guard makes the auto-choice fire exactly once per patient — so
 *  a clinician's manual tab switch then sticks — but RE-fires when the patient id
 *  changes. That re-fire is the important part: the patient page component is
 *  reused across patient→patient navigation (same `[patientId]` route, e.g. via
 *  browser back/forward), so without re-deciding, the previous patient's tab would
 *  carry over (a patient with only X-rays could land on an empty 3D tab).
 *
 *  Default is X-rays; a patient with no 2D X-rays but with CBCT/IOS scans opens on
 *  the 3D tab. Studies must be loaded first (studyCount > 0) so the decision isn't
 *  made against an empty list during the initial async fetch. */
export function autoTabDecision(opts: {
	decidedFor: string | null;
	patientId: string | null;
	studyCount: number;
	hasXrays: boolean;
	has3d: boolean;
}): PatientTab | null {
	if (opts.patientId == null) return null; // no patient resolved yet
	if (opts.studyCount === 0) return null; // studies not loaded — wait
	if (opts.decidedFor === opts.patientId) return null; // already decided for this patient
	return !opts.hasXrays && opts.has3d ? '3d' : 'xrays';
}
