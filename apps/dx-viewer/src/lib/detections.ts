// The single place that composites the AI's read-only disease detections with the
// clinician's edits (hide / add / resize) into one EFFECTIVE detection list. Every
// consumer — the canvas overlay, the findings-panel counts, the by-tooth grouping, the
// printout, and the severity/count derivation — reads from here, so "AI minus hidden
// plus added, with resizes applied" is defined exactly once and they can never drift.
//
// Pure + framework-free so the merge is exhaustively unit-testable without a canvas.

import type { BBox, DetectionResult, InferenceResponse, UserEdits } from './types';

/** A normalised detection from EITHER the AI or a user edit, as the rest of the app
 *  should see it. `source` + `aiIndex`/`addedId` let a consumer trace it back (e.g. to
 *  draw an AI box vs. a user box differently, or to know what a hide/resize targets). */
export interface EffectiveDetection {
	label: number;
	box: BBox;
	score: number;
	/** The AI's pixel mask for this detection, if any (user-added detections never have
	 *  one). Consumers use its presence to decide mask-vs-bbox rendering + resizability. */
	mask?: DetectionResult['masks'] extends (infer M)[] | undefined ? M : never;
	source: 'ai' | 'user';
	/** Original index into the AI arrays — present only for source==='ai'. The stable id
	 *  a hide/resize edit targets. */
	aiIndex?: number;
	/** The added-detection id — present only for source==='user'. */
	addedId?: string;
	/** For a user-added detection, whether it was drawn as a rectangle or a freeform
	 *  outline. A freeform detection carries its `points` (the actual trajectory) so the
	 *  overlay draws the real shape (circle/oval/curve), not its bounding rectangle. */
	kind?: 'rect' | 'free';
	/** The freeform outline (image-pixel [x,y] pairs), present only for kind==='free'. */
	points?: [number, number][];
	/** Whether this detection can be resized/removed by the user: AI detections backed by
	 *  a pixel mask cannot (only their bbox-only siblings + user-added boxes can). */
	editable: boolean;
}

const EMPTY_EDITS: UserEdits = { hidden: [], added: [], resized: {} };

/** Normalise a possibly-partial/legacy persisted value into a full UserEdits. */
export function normalizeUserEdits(raw: unknown): UserEdits {
	if (!raw || typeof raw !== 'object') return { hidden: [], added: [], resized: {} };
	const r = raw as Partial<UserEdits>;
	return {
		hidden: Array.isArray(r.hidden) ? r.hidden.filter((n) => Number.isInteger(n)) : [],
		added: Array.isArray(r.added) ? r.added : [],
		resized: r.resized && typeof r.resized === 'object' ? r.resized : {}
	};
}

/**
 * Composite the AI disease detections with the user's edits.
 *
 *   - an AI detection whose index is in `hidden` is DROPPED;
 *   - an AI detection whose index has a `resized` box uses that box instead;
 *   - every `added` detection is appended (source 'user');
 *   - `confThreshold` filters AI detections by score (user-added are always kept — the
 *     clinician placed them deliberately, they have no model score);
 *   - `editable` is false for an AI detection that still has its pixel mask (you can't
 *     drag a mask), true otherwise.
 *
 * Order: surviving AI detections first (in their original order), then user-added — so a
 * consumer can keep stable indices for the AI ones.
 */
export function effectiveDetections(
	inference: InferenceResponse | null | undefined,
	edits: UserEdits | null | undefined,
	confThreshold = 0
): EffectiveDetection[] {
	const e = edits ? normalizeUserEdits(edits) : EMPTY_EDITS;
	const hidden = new Set(e.hidden);
	const out: EffectiveDetection[] = [];

	const dz = inference?.extra?.disease_result?.result;
	if (dz?.bboxes && dz.labels) {
		for (let i = 0; i < dz.bboxes.length; i++) {
			if (hidden.has(i)) continue;
			const score = dz.scores?.[i] ?? 0;
			if (score < confThreshold) continue;
			const mask = dz.masks?.[i] ?? undefined;
			const box = e.resized[i] ?? dz.bboxes[i]!;
			out.push({
				label: dz.labels[i]!,
				box,
				score,
				mask: mask as EffectiveDetection['mask'],
				source: 'ai',
				aiIndex: i,
				// A masked detection can't be resized; a resized one has already been turned
				// into a plain bbox by the user, so it's editable.
				editable: !mask || e.resized[i] != null
			});
		}
	}

	for (const a of e.added) {
		out.push({
			label: a.label,
			box: a.box,
			score: 1, // user-placed: full confidence, never threshold-filtered
			source: 'user',
			addedId: a.id,
			kind: a.kind,
			// Carry the freeform trajectory so the overlay draws the real outline, not the box.
			...(a.kind === 'free' && a.points ? { points: a.points } : {}),
			editable: true
		});
	}

	return out;
}

/** Per-class counts of the EFFECTIVE detections (used by the findings panel + the
 *  finding-count derivation so user edits flow into the numbers). Keyed by label id. */
export function effectiveCountsByLabel(dets: EffectiveDetection[]): Map<number, number> {
	const c = new Map<number, number>();
	for (const d of dets) c.set(d.label, (c.get(d.label) ?? 0) + 1);
	return c;
}

/**
 * Build an InferenceResponse whose `disease_result.result` is the EFFECTIVE detection
 * list (AI − hidden + added, resizes applied) — everything else (tooth numbers, anatomy,
 * report) is passed through untouched. This lets every existing read-only consumer (the
 * canvas overlay, the findings-panel counts/by-tooth, countFindings, the printout) reflect
 * the clinician's edits with NO change to their internals — they already read this shape.
 *
 * NOTE: this is the DISPLAY/derived view. The editor itself works against the raw
 * inference + userEdits (it needs the source/editable distinction); read-only consumers
 * use this. Confidence filtering is left to each consumer (they already apply it), so
 * `confThreshold` here is 0 — we only merge, not filter.
 */
export function withEffectiveDetections(
	inference: InferenceResponse | null | undefined,
	edits: UserEdits | null | undefined
): InferenceResponse | null {
	if (!inference) return null;
	if (!edits) return inference;
	const e = normalizeUserEdits(edits);
	if (e.hidden.length === 0 && e.added.length === 0 && Object.keys(e.resized).length === 0) {
		return inference;
	}
	const dets = effectiveDetections(inference, e, 0);
	const dz = inference.extra?.disease_result;
	return {
		...inference,
		extra: {
			...inference.extra,
			disease_result: {
				...dz,
				result: {
					bboxes: dets.map((d) => d.box),
					labels: dets.map((d) => d.label),
					scores: dets.map((d) => d.score),
					masks: dets.map((d) => d.mask ?? null),
					// Index-aligned freeform outlines so the overlay can draw the real shape.
					freeforms: dets.map((d) => (d.kind === 'free' && d.points ? d.points : null)),
					// Index-aligned source so the overlay can omit the fabricated "100%" tag on
					// a user-added detection (it has no model confidence — see detectionTagText).
					sources: dets.map((d) => d.source)
				},
				extra: dz?.extra ?? { class_probs: [], bboxes_var: [] }
			}
		}
	};
}
