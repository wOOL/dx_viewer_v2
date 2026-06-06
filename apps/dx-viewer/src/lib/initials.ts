// Initials for the logged-in clinician, shown on a CLINICIAN-ADDED 2D annotation in
// place of a confidence % (a user-drawn detection has no model confidence — rendering
// "100%" would fabricate an AI certainty the model never produced; the clinician's
// initials attribute the finding to its author instead). Pure + unit-tested.
//
// Prefers the display name (first letters of up to three words), else the email's
// local part (first two alphanumerics). Uppercased; falls back to '—' when neither is
// available so the tag never shows an empty author.
export function userInitials(user: { name?: string; email?: string } | null | undefined): string {
	const name = (user?.name ?? '').trim();
	if (name) {
		const letters = name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 3)
			.map((p) => p[0])
			.join('');
		if (letters) return letters.toUpperCase();
	}
	const email = (user?.email ?? '').trim();
	if (email) {
		const local = (email.split('@')[0] ?? '').replace(/[^a-zA-Z0-9]/g, '');
		if (local) return local.slice(0, 2).toUpperCase();
	}
	return '—';
}
