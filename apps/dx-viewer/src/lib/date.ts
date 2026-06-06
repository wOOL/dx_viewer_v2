// Capture-date bucketing / label helpers.
//
// `capturedAt` is a real timestamp and is displayed in LOCAL time everywhere (study
// tiles use `new Date(capturedAt).toLocaleDateString()`). The patient-page capture-date
// FILTER must therefore bucket AND label by the same LOCAL calendar date — otherwise
// its labels drift a day for clinicians west of UTC (the #53 timezone vein, invisible
// on the UTC dev/prod box):
//   - bucketing by the UTC date (`toISOString().slice(0,10)`) groups studies by a day
//     that differs from the local day a tile shows; and
//   - labelling a `YYYY-MM-DD` key with `new Date('YYYY-MM-DD')` parses it as UTC
//     midnight, which renders as the PREVIOUS day west of UTC.
// (Contrast #53's DOB fix, which forces UTC — DOB is a UTC-midnight *calendar date*,
// whereas capturedAt is an *instant* shown locally.)

/** Local calendar-date key (`YYYY-MM-DD`) of a timestamp; `''` if missing/invalid. */
export function localDateKey(iso: string | undefined | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '';
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Today's LOCAL calendar date as `YYYY-MM-DD` — the cap for a DOB picker.
 *
 *  Built from local date components (`getFullYear`/`getMonth`+1/`getDate`,
 *  zero-padded), NOT `toISOString().slice(0,10)` which is UTC and hands clinics
 *  west of UTC *tomorrow's* date late in the day (e.g. 9pm Pacific → the next
 *  day). This matches the upload page's inline `todayISO` IIFE that caps its DOB
 *  `<input max>`, so every DOB entry point (new-study upload + quick-assign
 *  rename) blocks future dates identically. */
export function todayLocalISO(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Lower bound (`min`) for a date-of-birth date input + {@link validateDobISO}.
 *  A typed/pasted DOB below this (e.g. `0001-01-01`) is almost certainly a
 *  fat-finger and would otherwise flow into the chart + printout unchecked —
 *  only the UPPER bound (today) was guarded before. */
export const MIN_DOB_ISO = '1900-01-01';

/** Validate a `YYYY-MM-DD` date-of-birth against BOTH bounds. DOB is optional,
 *  so empty/undefined/null → `'ok'`. Mirrors the upper bound enforced by
 *  `max={todayLocalISO()}` and adds a lower floor at {@link MIN_DOB_ISO}
 *  (YYYY-MM-DD compares chronologically as a string).
 *  @param dob the `YYYY-MM-DD` string from the date input (may be empty)
 *  @returns `'ok'` (valid/empty) / `'future'` (after today, local) / `'tooOld'`. */
export function validateDobISO(dob: string | undefined | null): 'ok' | 'future' | 'tooOld' {
	if (!dob) return 'ok';
	if (dob > todayLocalISO()) return 'future';
	if (dob < MIN_DOB_ISO) return 'tooOld';
	return 'ok';
}

/** Bucket a list of timestamps by local calendar date → count, in one pass.
 *  Keys are localDateKey()s; missing/invalid timestamps are skipped. Lets a caller
 *  derive both the distinct dates (map keys) and the per-date counts without
 *  re-filtering the whole study list per date (the patient-page date menu did). */
export function countByLocalDate(isos: (string | undefined | null)[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const iso of isos) {
		const k = localDateKey(iso);
		if (k) m.set(k, (m.get(k) ?? 0) + 1);
	}
	return m;
}

/** Format a local `YYYY-MM-DD` key as "Mon DD, YYYY", parsed as a LOCAL date (NOT
 *  `new Date('YYYY-MM-DD')`, which is UTC midnight and shifts a day west of UTC).
 *
 *  `locale` defaults to undefined → browser default, but callers in Svelte
 *  components should pass `$locale ?? undefined` so dates follow the language
 *  the user picked in Settings (the en-US bug: a French user saw "May 22" not
 *  "22 mai"). */
export function formatDateKey(key: string, locale?: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? '');
	if (!m) return key ?? '';
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	if (isNaN(d.getTime())) return key;
	return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: '2-digit' });
}

/** Default short-date options for {@link formatDisplayDate}. */
const DEFAULT_DISPLAY_OPTS: Intl.DateTimeFormatOptions = {
	year: 'numeric',
	month: 'short',
	day: '2-digit'
};

/**
 * Format a timestamp (ISO string or epoch ms) for DISPLAY in the active locale, guarding
 * a missing/malformed value to a localized dash. `new Date('bad'|''|undefined)` →
 * "Invalid Date", and `toLocaleDateString` would render that literal string into the UI
 * (the #75 vein). This is the SINGLE shared display formatter — several components had
 * their own inline `fmtDate`, and the isNaN guard had been added to some (viewer/cbct/ios)
 * but NOT others (the patient page, PhotoGallery, billing), so a malformed `capturedAt`
 * leaked "Invalid Date" on those surfaces. Routing every consumer here can't drift again.
 */
export function formatDisplayDate(
	iso: string | number | null | undefined,
	locale?: string,
	opts: Intl.DateTimeFormatOptions = DEFAULT_DISPLAY_OPTS
): string {
	if (iso == null || iso === '') return '—';
	const d = new Date(iso);
	if (isNaN(d.getTime())) return '—';
	return d.toLocaleDateString(locale, opts);
}
