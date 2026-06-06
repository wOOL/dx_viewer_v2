// Shared input length limits + a generic trim-and-cap. Persisted/processed user
// text gets a hard ceiling so a paste of 10k+ chars can't bloat PB rows, thrash a
// filter, or break layout. The name cap (MAX_NAME_LENGTH) lives in forms.ts with the
// other profile validators; the limits here are for the non-form text inputs the
// missing-safeguard audit found uncapped (search boxes, CBCT annotation notes).

/** Search-box ceiling. Generous for any real query, short enough that a giant paste
 *  can't make the substring filter churn over the whole patient/condition list. */
export const MAX_SEARCH_LENGTH = 200;

/** CBCT/measurement annotation note ceiling. A note is a short label, not prose;
 *  this also bounds what gets persisted into the per-study markup state. */
export const MAX_ANNOTATION_LENGTH = 280;

/** CBCT report per-tooth comment ceiling. A clinical note is longer than an annotation
 *  label (prose, a sentence or two) but still bounded so a paste can't bloat the
 *  cbct_report_state row or break the report/printout layout. */
export const MAX_COMMENT_LENGTH = 2000;

/** Account contact-field ceilings (persisted on the user record). Generous for any real
 *  phone / clinic address, bounded so a paste can't bloat the user row. */
export const MAX_MOBILE_LENGTH = 32;
export const MAX_ADDRESS_LENGTH = 300;

/** Trim surrounding whitespace and hard-cap at `max`. Null/undefined → ''. Use at
 *  the persist/commit choke point (not only the `<input maxlength>`), so a value
 *  that bypasses the attribute still can't exceed the limit. */
export function capText(value: string, max: number): string {
	return (value ?? '').trim().slice(0, max);
}
