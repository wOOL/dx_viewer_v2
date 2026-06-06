// Locale-aware fixed-decimal formatting for small UI readouts (slider values,
// thresholds). Mirrors the mm-ruler locale fix (#59): in a French/German UI a
// decimal must read "1,20", not "1.20". `.toFixed()` always emits a dot, so any
// decimal a clinician sees should go through here with the active $locale.
export function formatDecimal(value: number, locale?: string, fractionDigits = 2): string {
	if (!Number.isFinite(value)) return '—';
	try {
		return value.toLocaleString(locale, {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits
		});
	} catch {
		// Unsupported/invalid locale — fall back to the non-localized form.
		return value.toFixed(fractionDigits);
	}
}
