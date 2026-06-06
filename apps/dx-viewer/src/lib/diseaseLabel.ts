// Localised short label for an AI disease/finding class id.
//
// XrayCanvas draws bbox labels like "Caries G1 87%" — the score is locale-aware
// elsewhere, but the cls.short fallback in $lib/constants.ts is hardcoded English.
// `diseaseShortLabel(id, t)` returns the locale's short form (en/fr/de/es ship a
// `diseaseShort.<id>` catalog) and falls back to the English constant if a key
// is missing so a new model class id still renders something instead of "[id]".

import { DISEASE_CLASSES } from './constants';

export function diseaseShortLabel(
	id: number,
	t: (key: string, opts?: { values?: Record<string, string | number> }) => string
): string {
	const key = `diseaseShort.${id}`;
	const localised = t(key);
	// svelte-i18n returns the key itself if not found — fall back to the English
	// constants in that case (a new class id ships with no translation yet).
	if (localised && localised !== key) return localised;
	const cls = DISEASE_CLASSES.find((c) => c.id === id);
	return cls?.short ?? cls?.name ?? `[${id}]`;
}

/**
 * The bbox tag for a 2D detection. An AI detection shows its model confidence
 * ("Caries G1 87%"); a CLINICIAN-ADDED one shows the AUTHOR'S INITIALS ("Caries G1· JD")
 * because it has NO model confidence — `withEffectiveDetections` gives a user-added
 * detection score:1 only so it survives the confidence filter, and rendering that as
 * "100%" would fabricate an AI certainty the model never produced. Writing the user's
 * initials instead attributes the finding to the clinician who drew it (the requested
 * behaviour). `isUser` comes from the merged result's index-aligned `sources`; `initials`
 * is the current user's initials (see $lib/initials) — omitted/empty falls back to just
 * the class. (The % needs no locale formatting: an integer 0–100 has no decimal/grouping.)
 */
export function detectionTagText(
	shortLabel: string,
	score: number,
	isUser: boolean,
	initials?: string
): string {
	if (isUser) return initials ? `${shortLabel} · ${initials}` : shortLabel;
	return `${shortLabel} ${(score * 100).toFixed(0)}%`;
}
