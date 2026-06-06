/**
 * Escape the five HTML metacharacters so untrusted text — patient names,
 * clinician notes, AI finding labels — is safe to interpolate into the print /
 * export HTML we build by hand and feed to `document.write` in a popup window.
 *
 * This is the SINGLE source for that escaping: every print/export flow imports
 * it, so one path can't silently drift into an XSS hole (an injected
 * `</title><script>…` in a patient name would otherwise run with access to the
 * session JWT + PHI). Covered by `html.test.ts`.
 */
export function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
}
