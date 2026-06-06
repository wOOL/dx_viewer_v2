// Client-side validation for files queued for AI inference + upload.
//
// The New-Study form and the one-click quick-analyze flow both base64-encode
// the file, POST it to the AI service, then save it to PocketBase — a long
// round-trip. Catching an empty, wrong-type, or oversized file BEFORE that work
// lets us show the user a specific, localized reason immediately instead of a
// generic late failure (or, for an oversized CBCT, a nginx/Cloudflare 413 after
// a multi-minute upload that can never land).
//
// The pure functions here are unit-tested; the .svelte pages just call them.

import { detectModality, type QuickModality } from '$lib/quickAnalyze';

// Per-modality maximum byte sizes.
//
// 2D X-rays / photos / panos are small; CBCT volumes and IOS meshes are large.
// The CBCT/IOS cap is deliberately the documented ~100MB nginx/Cloudflare edge
// limit (NOT the 200MB PB file-field cap): an upload between 100–300MB succeeds
// on the PB side but dies at the edge with a 413, so warning at ~100MB stops the
// user from waiting through a multi-minute encode/upload that can never land.
const MB = 1024 * 1024;
export const MAX_SIZE_2D = 40 * MB;
export const MAX_SIZE_CBCT = 100 * MB;
export const MAX_SIZE_IOS = 100 * MB;

// A coarse size/type "class". The upload page's modality enum is
// (`xray`/`panoramic`/`photo`/`cbct`/`ios`); quickAnalyze's detected modality is
// (`image`/`cbct`/`ios`). Both map onto these three buckets.
export type UploadClass = 'twoD' | 'cbct' | 'ios' | 'unknown';

export function uploadClassFor(modality: string): UploadClass {
	switch (modality) {
		// upload-page modality enum (xray/panoramic/photo) + quickAnalyze's detected
		// modality ('image') — all 2D rasters. (No comments BETWEEN case labels:
		// eslint's no-fallthrough treats a comment-only case as non-empty.)
		case 'xray':
		case 'panoramic':
		case 'photo':
		case 'image':
			return 'twoD';
		case 'cbct':
			return 'cbct';
		case 'ios':
			return 'ios';
		default:
			return 'unknown';
	}
}

export function maxSizeFor(modality: string): number {
	switch (uploadClassFor(modality)) {
		case 'cbct':
			return MAX_SIZE_CBCT;
		case 'ios':
			return MAX_SIZE_IOS;
		default:
			// 2D and unknown both use the small cap; unknown is also caught by
			// the wrong-type check, so the cap is just a backstop.
			return MAX_SIZE_2D;
	}
}

// Human-readable size for the i18n {max}/{size} params, e.g. "100 MB". Locale-aware:
// a French/German UI must read "350,5 MB" (and "1.024 MB" grouping), not "350.5 MB" /
// "1,024 MB" — bare numbers + .toFixed() always emit an en-style dot + comma grouping.
// (#59 i18n-decimal vein: any number a clinician sees goes through the active $locale.)
// `maximumFractionDigits: 1` keeps up to one decimal AND drops the trailing zero, so a
// whole MB still renders as "100 MB", not "100.0 MB".
export function formatBytes(bytes: number, locale?: string): string {
	const fmt = (n: number, maxFrac: number) => {
		try {
			return n.toLocaleString(locale, { maximumFractionDigits: maxFrac });
		} catch {
			// Unsupported/invalid locale — non-localized fallback, trailing zero trimmed.
			return String(Number(n.toFixed(maxFrac)));
		}
	};
	if (bytes >= MB) return `${fmt(bytes / MB, 1)} MB`;
	return `${fmt(Math.max(1, Math.round(bytes / 1024)), 0)} KB`;
}

export type UploadValidation =
	| { ok: true }
	| {
			ok: false;
			reason: 'empty' | 'tooLarge' | 'wrongType';
			messageKey: string;
			values?: Record<string, string | number>;
	  };

// Validate a single file against the modality it will be uploaded as.
//
// `modality` is the *intended* modality (the upload page's selected modality, or
// the quick-analyze detected value). When it's omitted / blank we fall back to
// detecting from the file itself via quickAnalyze's detectModality.
//
// Order matters: an empty file is reported as `empty` even if its extension is
// also unsupported, because "this file is empty" is the more actionable message.
//
// The returned `values` map is shaped for svelte-i18n's `$_(key, { values })`.
export function validateUploadFile(
	file: File,
	modality?: string,
	locale?: string
): UploadValidation {
	if (file.size === 0) {
		return {
			ok: false,
			reason: 'empty',
			messageKey: 'upload.errEmpty',
			values: { name: file.name }
		};
	}

	const intended = modality && modality.trim() ? modality : detectModality(file);
	const klass = uploadClassFor(intended ?? '');

	// An unrecognised modality/extension means we can't route it to an AI
	// endpoint — reject before the round-trip. Report the detected modality (or a
	// generic "unknown" when detection also fails) for the message.
	if (klass === 'unknown') {
		const detected: QuickModality | null = detectModality(file);
		return {
			ok: false,
			reason: 'wrongType',
			messageKey: 'upload.errWrongType',
			values: { name: file.name, type: detected ?? 'unknown' }
		};
	}

	const max = maxSizeFor(intended ?? '');
	if (file.size > max) {
		return {
			ok: false,
			reason: 'tooLarge',
			messageKey: 'upload.errTooLarge',
			values: {
				name: file.name,
				max: formatBytes(max, locale),
				size: formatBytes(file.size, locale)
			}
		};
	}

	return { ok: true };
}

// --- Batch-summary decision logic (H3) -------------------------------------
//
// Given the per-file outcomes of a multi-file submit, decide what the user
// should see: everything saved, a partial success (some saved, some failed), or
// a total failure (nothing saved). Kept pure so the three cases are unit-tested
// without driving the Svelte loop.

export interface FileOutcome {
	name: string;
	ok: boolean;
	reason?: string;
}

export type BatchSummary =
	| { state: 'all-ok'; saved: number; failed: number }
	| {
			state: 'partial';
			saved: number;
			failed: number;
			failures: { name: string; reason?: string }[];
	  }
	| {
			state: 'all-failed';
			saved: number;
			failed: number;
			failures: { name: string; reason?: string }[];
	  };

export function summarizeBatch(outcomes: FileOutcome[]): BatchSummary {
	const saved = outcomes.filter((o) => o.ok).length;
	const failures = outcomes.filter((o) => !o.ok).map((o) => ({ name: o.name, reason: o.reason }));
	const failed = failures.length;

	if (failed === 0) return { state: 'all-ok', saved, failed };
	if (saved === 0) return { state: 'all-failed', saved, failed, failures };
	return { state: 'partial', saved, failed, failures };
}
