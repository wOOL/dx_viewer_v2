export type BBox = [number, number, number, number];

/**
 * A pixel-level segmentation mask in pycocotools compressed-RLE form, as returned
 * by the AI service. `counts` is the LEB128-ish run-length string (column-major),
 * `size` is [height, width] of the full mask (matches the analysed image).
 */
export interface RleMask {
	counts: string;
	size: [number, number];
}

export interface DetectionResult {
	bboxes: BBox[];
	labels: number[];
	scores: number[];
	masks?: (RleMask | null)[];
	/** Index-aligned freeform outlines for user-drawn detections (image-pixel [x,y]
	 *  pairs), or null for a box/mask detection. Only the composited "effective"
	 *  detection result (withEffectiveDetections) carries this — the raw AI result never
	 *  does. Lets the overlay draw a clinician's actual trajectory (circle/oval/curve)
	 *  instead of its bounding rectangle. */
	freeforms?: ([number, number][] | null)[];
	/** Index-aligned detection source: 'user' for a clinician-added detection (which has
	 *  NO model confidence — its score is a synthetic 1 only so it survives the confidence
	 *  filter), 'ai' otherwise. Only the composited "effective" result carries this; the
	 *  raw AI result never does (treat absent as all-'ai'). Lets the overlay omit the
	 *  fabricated "100%" tag on a user-added box. */
	sources?: ('ai' | 'user')[];
}

/**
 * Clinician edits to the AI's 2D disease detections, stored per-study SEPARATELY from
 * the (read-only) AI inference so the model's original output is never mutated and a
 * "disagree" is always recoverable. The viewer composites inference + userEdits into
 * the effective detection list every consumer reads (canvas, counts, by-tooth, report).
 */
export interface AddedDetection {
	/** Stable client id (so a row can be referenced/removed before it round-trips). */
	id: string;
	/** Disease class id (a DISEASE_CLASSES id). */
	label: number;
	/** Axis-aligned bounds in image-pixel space — for a freeform region this is the
	 *  bounding box of `points` (kept so all consumers can treat it like a bbox). */
	box: BBox;
	kind: 'rect' | 'free';
	/** Freeform outline (image-pixel [x,y] pairs); present only when kind === 'free'. */
	points?: [number, number][];
}

export interface UserEdits {
	/** AI detection indices the clinician HID (disagreed with) — recoverable. */
	hidden: number[];
	/** Detections the clinician ADDED. */
	added: AddedDetection[];
	/** AI detection index → the clinician's adjusted box (resize). Bbox-only detections;
	 *  a detection backed by a pixel mask isn't resizable. */
	resized: Record<number, BBox>;
}

export interface InferenceResponse {
	detection: string;
	tooth_numbers: string;
	segmentation: string;
	report: string;
	extra: {
		disease_result: {
			result: DetectionResult;
			extra: {
				class_probs: number[][];
				bboxes_var: number[][];
			};
		};
		number_result: {
			result: {
				bboxes: BBox[];
				labels: number[];
				scores: number[];
			};
		};
		anatomy_result: {
			result: {
				masks?: (RleMask | null)[];
				bboxes: BBox[];
				labels: number[];
				scores: number[];
			};
			extra: { anomaly: boolean };
		};
	};
}

export interface InferenceRequest {
	image_data: string;
	meta_data?: {
		ensure_dim?: boolean;
		disease_segment?: boolean;
		anatomy_meta_data?: { conf_thres?: number };
		number_meta_data?: { conf_thres?: number; fdi_number?: boolean };
		disease_meta_data?: { conf_thres?: number };
		rule_meta_data?: { segment_conf_thres?: number; limit_dim?: number };
	};
}

export interface FindXrayResponse {
	result: { x1: number; y1: number; x2: number; y2: number } | null;
	extra: {
		xrayfound: boolean;
		score: number;
		width: number;
		height: number;
	};
}

export interface StoredStudy {
	id: string;
	patientId: string;
	patientName: string;
	dob?: string;
	capturedAt: string;
	/** PB record `created` (when the study was uploaded/analyzed) — distinct from
	 *  `capturedAt` (the radiograph's own capture date, often historical). Used for the
	 *  dashboard "Analyses this week" metric. */
	created?: string;
	/** Row `updated` stamp — the cache key for carrying lazily-loaded inference across a
	 *  refresh(): equal stamps ⇒ the study's content (incl. inference/userEdits, whose
	 *  writers bump the row) is unchanged, so the loaded values can be reused without a
	 *  blank-then-refetch flicker. */
	updated?: string;
	modality: 'xray' | 'panoramic' | 'cbct' | 'ios' | 'photo';
	imageDataUrl?: string;
	originalFilename?: string;
	inference?: InferenceResponse;
	/** Clinician edits to the 2D AI detections (lazy-loaded with `inference`); undefined
	 *  = not yet loaded, null/absent = no edits. Composited with `inference` for display. */
	userEdits?: UserEdits | null;
	segmentationUrl?: string;
	severityScore?: number;
	findingCounts?: Record<string, number>;
	fmxSlot?: string;
}

export interface StoredPatient {
	id: string;
	name: string;
	initials: string;
	dob?: string;
	studies: StoredStudy[];
	lastCapture: string;
	totalToothCount: number;
	ringColors: [string, string, string?];
	// True for a throwaway patient auto-created by the one-click quick-analyze flow
	// (drag / paste / screen-capture). The UI offers to name it or merge it into an
	// existing patient; clearing the flag (or merging) makes it a normal patient.
	quick?: boolean;
}

// Short aliases used widely in workspace components. They reference the same
// shape; the long names exist for back-compat with older code that talks about
// "stored" entities in localStorage.
export type Patient = StoredPatient;
export type Study = StoredStudy;

/** Site adapter for the browser extension — describes how to inject the
 *  analysis overlay into a third-party dental platform page. (Ported from the
 *  old core during the Phase B extraction; the extension is its only consumer.) */
export interface SiteAdapter {
	/** Human-readable name of the adapted site */
	name: string;
	/** URL pattern(s) to match this adapter against */
	matchPatterns: string[];
	/** Element ID for the <img> tag to replace with the AI detection overlay */
	imageId: string;
	/** Element ID for a notes textarea/input to fill with the report */
	notesId?: string;
	/** Element ID for a file upload <input type="file"> to attach result JSON */
	fileUploadId?: string;
}
