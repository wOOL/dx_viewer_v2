/**
 * PII masking helper. Patient names are never rendered raw anywhere in the
 * app — every surface routes through `maskPatient` so a clinician can share
 * their screen without having to remember to enable anything.
 *
 * The mask collapses the name to "Patient {two-letter initials}" so rows
 * remain visually distinguishable without exposing the underlying name.
 */

const INITIAL_RE = /\p{L}/u;

export function maskPatient(name: string): string {
	if (!name) return '— —';
	const parts = name.trim().split(/\s+/);
	const initials = parts
		.slice(0, 2)
		.map((p) => INITIAL_RE.exec(p)?.[0] ?? '')
		.join('')
		.toUpperCase();
	return initials ? `Patient ${initials}` : 'Patient';
}
