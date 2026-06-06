import { prefs } from './stores/prefs.svelte';

export const DISEASE_CLASSES: {
	id: number;
	name: string;
	color: string;
	group: 'caries' | 'bone-loss' | 'pathology' | 'restoration' | 'other';
	short?: string;
}[] = [
	{
		id: 0,
		name: 'Caries (G1: Outer Enamel)',
		short: 'Caries G1',
		color: '#fde047',
		group: 'caries'
	},
	{
		id: 1,
		name: 'Caries (G2: Inner Enamel)',
		short: 'Caries G2',
		color: '#fbbf24',
		group: 'caries'
	},
	{
		id: 2,
		name: 'Caries (G3: Outer Dentin)',
		short: 'Caries G3',
		color: '#f97316',
		group: 'caries'
	},
	{
		id: 3,
		name: 'Caries (G4: Middle Dentin)',
		short: 'Caries G4',
		color: '#ef4444',
		group: 'caries'
	},
	{
		id: 4,
		name: 'Caries (G5: Inner Dentin)',
		short: 'Caries G5',
		color: '#b91c1c',
		group: 'caries'
	},
	{ id: 5, name: 'Bone Loss (S1: <15%)', short: 'BL S1', color: '#fb7185', group: 'bone-loss' },
	{
		id: 6,
		name: 'Bone Loss (S2: Coronal Third)',
		short: 'BL S2',
		color: '#ec4899',
		group: 'bone-loss'
	},
	{
		id: 7,
		name: 'Bone Loss (S3: Mid Third)',
		short: 'BL S3',
		color: '#d946ef',
		group: 'bone-loss'
	},
	{
		id: 8,
		name: 'Bone Loss (S4: Apical Third)',
		short: 'BL S4',
		color: '#a855f7',
		group: 'bone-loss'
	},
	{ id: 9, name: 'Calculus', color: '#06b6d4', group: 'pathology' },
	{
		id: 10,
		name: 'Periapical Radiolucency',
		short: 'Periapical',
		color: '#a78bfa',
		group: 'pathology'
	},
	{
		id: 11,
		name: 'Internal Resorption',
		short: 'Int. Resorption',
		color: '#f43f5e',
		group: 'pathology'
	},
	{
		id: 12,
		name: 'External Resorption',
		short: 'Ext. Resorption',
		color: '#e11d48',
		group: 'pathology'
	},
	{
		id: 13,
		name: 'Restoration Radiolucency',
		short: 'Rest. Radiolucency',
		color: '#fb7185',
		group: 'restoration'
	},
	{ id: 14, name: 'Open Margin', short: 'Open Margin', color: '#fb923c', group: 'restoration' },
	{ id: 15, name: 'Remaining Root', short: 'Rem. Root', color: '#ef4444', group: 'pathology' },
	{
		id: 16,
		name: 'Missing Coronal Restoration',
		short: 'Missing Restoration',
		color: '#ec4899',
		group: 'restoration'
	},
	{ id: 17, name: 'Unsure', color: '#9ca3af', group: 'other' },
	{ id: 18, name: 'Overhang', color: '#f59e0b', group: 'restoration' },
	{ id: 19, name: 'Other', color: '#6b7280', group: 'other' }
];

/**
 * Display-friendly finding taxonomy — collapses the model's 20 DISEASE_CLASSES
 * into the rows the AI-findings panel shows (e.g. all caries grades → one "Caries -
 * Progressed" row). EVERY row maps to ≥1 REAL model class id: our model detects
 * pathology/restorative FINDINGS only, NOT the presence of intact restorations.
 *
 * Do NOT add rows for things the model cannot detect (a bare crown/bridge/implant/
 * root-canal/impaction is NOT in DISEASE_CLASSES) — a row with `ids: []` is an inert
 * fake toggle that misrepresents the AI's capability. The only model classes
 * intentionally omitted are the catch-alls 17 (Unsure) and 19 (Other).
 *
 * `key` is a stable i18n slug (translated at render via the `taxonomy.*` catalog);
 * `label` is the English fallback. `ids` are the model class IDs — DATA IDENTITY,
 * never translated/reordered. `color` matches the class's DISEASE_CLASSES overlay
 * colour so the panel dot equals the on-canvas mask.
 */
export const PEARL_FINDING_TAXONOMY: {
	key: string;
	label: string;
	ids: number[];
	color: string;
}[] = [
	{ key: 'calculus', label: 'Calculus', ids: [9], color: '#06b6d4' },
	{ key: 'cariesIncipient', label: 'Caries - Incipient', ids: [0, 1], color: '#fbbf24' },
	{ key: 'cariesProgressed', label: 'Caries - Progressed', ids: [2, 3, 4], color: '#ef4444' },
	{ key: 'notableMargin', label: 'Notable Margin', ids: [14, 18], color: '#fb923c' },
	{ key: 'periapicalRadiolucency', label: 'Periapical Radiolucency', ids: [10], color: '#a78bfa' },
	{ key: 'boneLoss', label: 'Bone Loss', ids: [5, 6, 7, 8], color: '#ec4899' },
	{ key: 'resorption', label: 'Resorption', ids: [11, 12], color: '#f43f5e' },
	{ key: 'remainingRoot', label: 'Remaining Root', ids: [15], color: '#ef4444' },
	// Class 13 = "Restoration Radiolucency (Adhesive/Liner)" — a radiolucent finding
	// AT a restoration, NOT a benign "filling present". Class 16 = "Missing Coronal
	// Restoration". Both are real findings (were previously mislabeled Filling /
	// Missing Crown under a fabricated "Non-Pathology" section).
	{
		key: 'restorationRadiolucency',
		label: 'Restoration Radiolucency',
		ids: [13],
		color: '#fb7185'
	},
	{
		key: 'missingCoronalRestoration',
		label: 'Missing Coronal Restoration',
		ids: [16],
		color: '#ec4899'
	}
];

// How the "Diagnostic Results" panel groups findings (clinician request): only the
// multi-grade families collapse into ONE row — Dental Caries (grades 1–5) and Bone Loss
// (stages 1–4). EVERY other disease keeps its own row (Calculus, Periapical Radiolucency,
// Internal/External Resorption, Restoration Radiolucency, Open Margin, Remaining Root,
// Missing Coronal Restoration, Overhang) — no "Other Findings" catch-all.
const CARIES_CLASS_IDS = [0, 1, 2, 3, 4];
const BONE_LOSS_CLASS_IDS = [5, 6, 7, 8];
// Every taxonomy class that isn't caries or bone loss, shown individually (model-id order).
const INDIVIDUAL_CLASS_IDS = [...new Set(PEARL_FINDING_TAXONOMY.flatMap((r) => r.ids))]
	.filter((id) => !CARIES_CLASS_IDS.includes(id) && !BONE_LOSS_CLASS_IDS.includes(id))
	.sort((a, b) => a - b);

export interface DiagnosticGroup {
	key: string;
	classIds: number[];
	color: string;
	/** i18n key for a grouped header (findings.group.*) — caries / bone loss only. */
	labelKey?: string;
	/** Derive the header from this single class's localized short label (individual diseases). */
	labelClassId?: number;
}
export const DIAGNOSTIC_GROUPS: DiagnosticGroup[] = [
	{
		key: 'dentalCaries',
		classIds: CARIES_CLASS_IDS,
		color: '#ef4444',
		labelKey: 'findings.group.dentalCaries'
	},
	{
		key: 'boneLoss',
		classIds: BONE_LOSS_CLASS_IDS,
		color: '#ec4899',
		labelKey: 'findings.group.boneLoss'
	},
	...INDIVIDUAL_CLASS_IDS.map(
		(id): DiagnosticGroup => ({
			key: `cls${id}`,
			classIds: [id],
			color: DISEASE_CLASSES[id]?.color ?? '#6b7280',
			labelClassId: id
		})
	)
];

export const SEG_CLASSES: { id: number; name: string; color: string }[] = [
	{ id: 0, name: 'Enamel', color: '#fde68a' },
	{ id: 1, name: 'Dentin', color: '#fdba74' },
	{ id: 2, name: 'Root Dentin', color: '#fb923c' },
	{ id: 3, name: 'Pulp', color: '#f43f5e' },
	{ id: 4, name: 'Bone', color: '#d4d4d8' },
	{ id: 5, name: 'Restoration', color: '#34d399' },
	{ id: 6, name: 'Background', color: '#1f2937' }
];

export const UNIVERSAL_TOOTH = Array.from({ length: 32 }, (_, i) => String(i + 1));

export const FDI_TOOTH = [
	'18',
	'17',
	'16',
	'15',
	'14',
	'13',
	'12',
	'11',
	'21',
	'22',
	'23',
	'24',
	'25',
	'26',
	'27',
	'28',
	'38',
	'37',
	'36',
	'35',
	'34',
	'33',
	'32',
	'31',
	'41',
	'42',
	'43',
	'44',
	'45',
	'46',
	'47',
	'48'
];

export function toothLabel(idx: number, fdi = false): string {
	const arr = fdi ? FDI_TOOTH : UNIVERSAL_TOOTH;
	return arr[idx] ?? String(idx);
}

// Map an FDI tooth number → the label to DISPLAY, honoring the user's numbering
// preference (default Universal). Data stays FDI-keyed; only the shown label changes.
// Used by every tooth-number display (chart, drill-down card, report print) so the
// same patient isn't numbered differently across views.
//
// Reads the REACTIVE `prefs.toothNumbering` rune (S2-#3): when called inside markup
// or a $derived, the consumer recomputes the moment the preference changes — so an
// already-open CBCT/IOS view can no longer show one tooth two different numbers.
// (The store is SSR-safe: `prefs.toothNumbering` defaults to 'universal' when
// `!browser`.) A plain-TS caller that runs outside a reactive context still gets the
// current value; if it needs an explicit snapshot use `currentToothNumbering()`.
export function toothDisplay(fdi: number): string {
	if (prefs.toothNumbering === 'fdi') return String(fdi);
	const idx = FDI_TOOTH.indexOf(String(fdi));
	return (idx >= 0 ? UNIVERSAL_TOOTH[idx] : undefined) ?? String(fdi);
}

export function diseaseById(id: number) {
	return DISEASE_CLASSES[id] ?? { id, name: `Class ${id}`, color: '#888', group: 'other' as const };
}

export function segById(id: number) {
	return SEG_CLASSES[id] ?? { id, name: `Class ${id}`, color: '#888' };
}
