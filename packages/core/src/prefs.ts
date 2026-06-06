import { browser } from './env';

// Saved user preferences read from localStorage. Reads are guarded against a
// corrupted/non-numeric value: a NaN confidence threshold makes every
// `score >= threshold` comparison false, so the AI overlay silently draws nothing
// and the finding counts mismatch (same poison-value class as #75's "Invalid Date").

// 0.20 — the confidence-threshold control was removed from Settings (clinician request),
// so this fixed default is what every overlay/findings filter uses now.
export const DEFAULT_CONF_THRESHOLD = 0.2;
const MIN_CONF = 0.05;
const MAX_CONF = 0.95;

/** Pure parse: a non-finite (missing / empty / non-numeric) value falls back to the
 *  default; a finite value is clamped to the slider's [0.05, 0.95] range. */
export function parseConfThreshold(raw: string | null | undefined): number {
	const v = parseFloat(raw ?? '');
	if (!Number.isFinite(v)) return DEFAULT_CONF_THRESHOLD;
	return Math.min(MAX_CONF, Math.max(MIN_CONF, v));
}

/** The saved AI confidence threshold (`dxv:confThres`), guarded + clamped. */
export function readConfThreshold(): number {
	if (!browser) return DEFAULT_CONF_THRESHOLD;
	return parseConfThreshold(localStorage.getItem('dxv:confThres'));
}
