// Pure validation for the patient edit form (name + DOB), extracted so it gets a
// real node-side unit test — the patient detail route component is hang-prone in
// jsdom, so its Save handler must delegate the decision here (single source of
// truth) rather than inline the rules.
//
// Note: the shared DOB validator (`validateDobISO`) lives in `$lib/date` and
// returns a terse code (`'ok' | 'future' | 'tooOld'`), NOT an i18n key. We map
// that code to the EXISTING upload-form message keys (`upload.errFutureDob` /
// `upload.errDobTooOld` — the same ones the upload page + QuickAssignCard
// surface) so every DOB entry point speaks with one voice. Name is required here
// (a patient must have a name); DOB stays optional.
import { validateDobISO } from './date';

/** Map a non-`ok` {@link validateDobISO} code to the localized message key the
 *  form shows. Param is the full union (not the narrowed `'future' | 'tooOld'`)
 *  so callers don't depend on TS narrowing the inferred return type; the `ok`
 *  case is unreachable here (callers only call this after checking `!== 'ok'`)
 *  but is handled defensively. */
function dobErrorKey(code: ReturnType<typeof validateDobISO>): string {
	return code === 'future' ? 'upload.errFutureDob' : 'upload.errDobTooOld';
}

export type PatientEditResult =
	| { ok: true; name: string; dob: string }
	| { ok: false; key: string };

/** Validate a patient edit. Trims the name (required → `patient.errNameRequired`
 *  when blank/whitespace), then runs the shared DOB rules (empty DOB allowed).
 *  On success returns the trimmed name + the (possibly empty) DOB to persist. */
export function validatePatientEdit(input: { name: string; dob: string }): PatientEditResult {
	const name = input.name.trim();
	if (!name) return { ok: false, key: 'patient.errNameRequired' };
	const code = validateDobISO(input.dob);
	if (code !== 'ok') return { ok: false, key: dobErrorKey(code) };
	return { ok: true, name, dob: input.dob };
}
