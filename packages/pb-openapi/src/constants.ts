/**
 * Label taxonomies returned by the AI service (PB_Backend.md §7).
 *
 * Source of truth lives in the AI service repo (`src/constants.py`). These are
 * duplicated here so the frontend can render raw `extra.*_result.labels`
 * arrays without a round-trip. Coordinate updates with the AI service team
 * when class lists change.
 */

// ─── Disease ─────────────────────────────────────────────────────────────────

export const DISEASE_LABELS = {
	0: 'Dental Caries (Grade 1: Outer Enamel)',
	1: 'Dental Caries (Grade 2: Inner Enamel)',
	2: 'Dental Caries (Grade 3: Outer Dentin)',
	3: 'Dental Caries (Grade 4: Middle Dentin)',
	4: 'Dental Caries (Grade 5: Inner Dentin)',
	5: 'Bone Loss (Stage 1: <15%)',
	6: 'Bone Loss (Stage 2: Coronal Third)',
	7: 'Bone Loss (Stage 3: Mid Third)',
	8: 'Bone Loss (Stage 4: Apical Third)',
	9: 'Calculus',
	10: 'Periapical Radiolucency',
	11: 'Internal Resorption',
	12: 'External Resorption',
	13: 'Restoration Radiolucency (Adhesive/Liner)',
	14: 'Open Margin',
	15: 'Remaining Root',
	16: 'Missing Coronal Restoration',
	17: 'Unsure',
	18: 'Overhang',
	19: 'Other'
} as const;

export type DiseaseLabel = keyof typeof DISEASE_LABELS;
export type DiseaseName = (typeof DISEASE_LABELS)[DiseaseLabel];

// ─── Tooth numbering ─────────────────────────────────────────────────────────

/** Universal numbering: label IDs 0–31 map to tooth numbers '1'–'32'. */
export const UNI_TOOTH_NUMBER_CLASSES = Array.from({ length: 32 }, (_, i) => String(i + 1)) as readonly string[];

/** FDI numbering. Label IDs 0–31 → quadrant-encoded tooth numbers. */
export const FDI_TOOTH_NUMBER_CLASSES = [
	// Upper right (label 0–7)
	'18', '17', '16', '15', '14', '13', '12', '11',
	// Upper left (label 8–15)
	'21', '22', '23', '24', '25', '26', '27', '28',
	// Lower left (label 16–23)
	'38', '37', '36', '35', '34', '33', '32', '31',
	// Lower right (label 24–31)
	'41', '42', '43', '44', '45', '46', '47', '48'
] as const;

/** First/second/third molars per quadrant. Universal numbers (1-indexed). */
export const MOLAR_CLASS_IDX = [1, 2, 3, 14, 15, 16, 17, 18, 19, 30, 31, 32] as const;

/** Subtract 1 to convert Universal tooth numbers → label IDs. */
export const MOLAR_LABEL_IDS = MOLAR_CLASS_IDX.map((n) => n - 1) as readonly number[];

// ─── Anatomy segmentation ────────────────────────────────────────────────────

export const SEG_CLS2ID = {
	Enamel: 0,
	Dentin: 1,
	'Root Dentin': 2,
	Pulp: 3,
	Bone: 4,
	Restoration: 5,
	Background: 6
} as const;

export const SEG_ID2CLS = {
	0: 'Enamel',
	1: 'Dentin',
	2: 'Root Dentin',
	3: 'Pulp',
	4: 'Bone',
	5: 'Restoration',
	6: 'Background'
} as const;

export type AnatomyClass = keyof typeof SEG_CLS2ID;
export type AnatomyClassId = keyof typeof SEG_ID2CLS;

// ─── X-ray subtype + ROI (not currently surfaced) ────────────────────────────

export const XRAY_CLASSES = ['Bitewing', 'Panoramic', 'Periapical'] as const;
export const ROI_CLASSES = ['background', 'X-ray'] as const;

// ─── Watermark strings (match server-rendered overlays) ──────────────────────

export const ANOMALY_TEXT = 'This image does not\ncontain an X-ray';
export const NO_SEGMENT_TEXT = 'No enamel/dentin/root dentin segmented\nPossible anomaly';

// ─── Paywall message matchers ────────────────────────────────────────────────

export const PAYWALL_MESSAGES = {
	NO_SUBSCRIPTION: 'No Subscription',
	INACTIVE_SUBSCRIPTION: 'Inactive Subscription',
	EXPIRED_SUBSCRIPTION: 'Subscription Expired (Renewal Pending)'
} as const;
