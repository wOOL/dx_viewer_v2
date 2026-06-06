// Patient-list search, split so the expensive part (building localized,
// diacritic-folded haystacks per patient) runs only when the patient list or
// locale changes — NOT on every keystroke. The dashboard previously rebuilt the
// date strings (two toLocaleDateString calls each) for every patient on every
// keystroke, and re-folded the constant query once per patient inside the filter
// loop. Pure functions so the search semantics are unit-tested without rendering
// the route component.

import { foldDiacritics } from './patients';
import type { StoredPatient } from './types';

// A searchable date string matching every way the date is shown/stored, so a
// clinician typing "Aug" (card label), "august", or "1988-08" (ISO) all hit:
// raw ISO + the localized short date + the localized full month, folded.
export function searchableDate(iso: string | undefined, loc?: string): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	let out = iso.toLowerCase(); // raw ISO ("1988-08-08")
	try {
		out +=
			' ' +
			d.toLocaleDateString(loc, { year: 'numeric', month: 'short', day: '2-digit' }).toLowerCase();
		out += ' ' + d.toLocaleDateString(loc, { month: 'long' }).toLowerCase();
	} catch {
		/* malformed locale or date — ISO alone is fine */
	}
	return foldDiacritics(out);
}

export interface PatientSearchEntry {
	patient: StoredPatient;
	name: string; // folded
	dob: string; // folded searchable date
	cap: string; // folded searchable date (last capture)
}

/** Build the per-patient folded search haystacks. Depends only on the patient
 *  list + locale, so a caller recomputes it when those change — not per keystroke. */
export function buildPatientSearchIndex(
	patients: StoredPatient[],
	loc?: string
): PatientSearchEntry[] {
	return patients.map((p) => ({
		patient: p,
		name: foldDiacritics(p.name),
		dob: searchableDate(p.dob, loc),
		cap: searchableDate(p.lastCapture, loc)
	}));
}

/** Filter a prebuilt index by a raw query. Empty query → all patients (original
 *  order). Name OR DOB OR last-capture are matched INDEPENDENTLY (a query can't
 *  span two fields), preserving the dashboard's original per-field behaviour. */
export function filterPatientsByQuery(index: PatientSearchEntry[], query: string): StoredPatient[] {
	const q = foldDiacritics(query.trim());
	if (!q) return index.map((e) => e.patient);
	return index
		.filter((e) => e.name.includes(q) || e.dob.includes(q) || e.cap.includes(q))
		.map((e) => e.patient);
}
