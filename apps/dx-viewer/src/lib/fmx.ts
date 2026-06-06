// Shared FMX (full-mouth series) template + study→slot assignment. Used by both the
// patient-page FmxGrid and the 2D viewer's FmxNavigator so a study always lands in the
// SAME anatomical slot in both. Kept free of Svelte/DOM so it unit-tests cleanly.
import type { StoredStudy } from './types';

export interface FmxSlot {
	key: string;
	gridArea: string;
	/** i18n key for the label stem (fmx.teeth / fmx.tooth / fmx.bwRight / fmx.bwLeft / fmx.panoramic). */
	labelKey: string;
	/** Positional suffix appended after the stem, e.g. "1-3" → "Teeth 1-3". Empty for the pano. */
	labelArg: string;
	teeth: number[];
	modality: 'periapical' | 'bitewing' | 'panoramic';
	orientation?: 'tall' | 'wide';
}

// 18-slot template: 3 rows × 7 cols, with a wide central panoramic in row 2 (cols 3–5).
export const FMX_SLOTS: FmxSlot[] = [
	// Top row — maxillary (upper) periapicals
	{
		key: 'pa-ur-mol',
		gridArea: '1 / 1 / 2 / 2',
		labelKey: 'fmx.teeth',
		labelArg: '1-3',
		teeth: [1, 2, 3],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ur-prem',
		gridArea: '1 / 2 / 2 / 3',
		labelKey: 'fmx.teeth',
		labelArg: '4-5',
		teeth: [4, 5],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ur-can',
		gridArea: '1 / 3 / 2 / 4',
		labelKey: 'fmx.tooth',
		labelArg: '6',
		teeth: [6],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-u-ant',
		gridArea: '1 / 4 / 2 / 5',
		labelKey: 'fmx.teeth',
		labelArg: '7-10',
		teeth: [7, 8, 9, 10],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ul-can',
		gridArea: '1 / 5 / 2 / 6',
		labelKey: 'fmx.tooth',
		labelArg: '11',
		teeth: [11],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ul-prem',
		gridArea: '1 / 6 / 2 / 7',
		labelKey: 'fmx.teeth',
		labelArg: '12-13',
		teeth: [12, 13],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ul-mol',
		gridArea: '1 / 7 / 2 / 8',
		labelKey: 'fmx.teeth',
		labelArg: '14-16',
		teeth: [14, 15, 16],
		modality: 'periapical',
		orientation: 'tall'
	},
	// Middle row — bitewings + central panoramic
	{
		key: 'bw-ur-1',
		gridArea: '2 / 1 / 3 / 2',
		labelKey: 'fmx.bwRight',
		labelArg: '2-3',
		teeth: [2, 3, 30, 31],
		modality: 'bitewing',
		orientation: 'wide'
	},
	{
		key: 'bw-ur-2',
		gridArea: '2 / 2 / 3 / 3',
		labelKey: 'fmx.bwRight',
		labelArg: '4-5',
		teeth: [4, 5, 28, 29],
		modality: 'bitewing',
		orientation: 'wide'
	},
	{
		key: 'pano',
		gridArea: '2 / 3 / 3 / 6',
		labelKey: 'fmx.panoramic',
		labelArg: '',
		teeth: [],
		modality: 'panoramic',
		orientation: 'wide'
	},
	{
		key: 'bw-ul-1',
		gridArea: '2 / 6 / 3 / 7',
		labelKey: 'fmx.bwLeft',
		labelArg: '12-13',
		teeth: [12, 13, 20, 21],
		modality: 'bitewing',
		orientation: 'wide'
	},
	{
		key: 'bw-ul-2',
		gridArea: '2 / 7 / 3 / 8',
		labelKey: 'fmx.bwLeft',
		labelArg: '14-15',
		teeth: [14, 15, 18, 19],
		modality: 'bitewing',
		orientation: 'wide'
	},
	// Bottom row — mandibular (lower) periapicals
	{
		key: 'pa-lr-mol',
		gridArea: '3 / 1 / 4 / 2',
		labelKey: 'fmx.teeth',
		labelArg: '30-32',
		teeth: [30, 31, 32],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-lr-prem',
		gridArea: '3 / 2 / 4 / 3',
		labelKey: 'fmx.teeth',
		labelArg: '28-29',
		teeth: [28, 29],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-lr-can',
		gridArea: '3 / 3 / 4 / 4',
		labelKey: 'fmx.tooth',
		labelArg: '27',
		teeth: [27],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-l-ant',
		gridArea: '3 / 4 / 4 / 5',
		labelKey: 'fmx.teeth',
		labelArg: '23-26',
		teeth: [23, 24, 25, 26],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ll-can',
		gridArea: '3 / 5 / 4 / 6',
		labelKey: 'fmx.tooth',
		labelArg: '22',
		teeth: [22],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ll-prem',
		gridArea: '3 / 6 / 4 / 7',
		labelKey: 'fmx.teeth',
		labelArg: '20-21',
		teeth: [20, 21],
		modality: 'periapical',
		orientation: 'tall'
	},
	{
		key: 'pa-ll-mol',
		gridArea: '3 / 7 / 4 / 8',
		labelKey: 'fmx.teeth',
		labelArg: '17-19',
		teeth: [17, 18, 19],
		modality: 'periapical',
		orientation: 'tall'
	}
];

// Universal tooth numbers the AI detected for a study. number_result labels are
// 0-based tooth-class indices (UNIVERSAL_TOOTH[idx] === String(idx + 1)).
function detectedTeeth(s: StoredStudy): number[] {
	const labels = s.inference?.extra?.number_result?.result?.labels ?? [];
	return labels.map((l) => l + 1);
}

/**
 * Map studies onto FMX slots. Explicit `fmxSlot` tags win; the rest are auto-assigned
 * by detected-tooth overlap (a lower-molar PA lands in a lower-molar slot, not by
 * upload order), with the single panoramic taking the central slot.
 */
export function assignStudiesToSlots(studies: StoredStudy[]): Map<string, StoredStudy> {
	const map = new Map<string, StoredStudy>();

	// Explicit per-study tags first — they always win their slot.
	const tagged = new Set<string>();
	for (const s of studies) {
		if (s.fmxSlot && FMX_SLOTS.some((sl) => sl.key === s.fmxSlot) && !map.has(s.fmxSlot)) {
			map.set(s.fmxSlot, s);
			tagged.add(s.id);
		}
	}
	const untagged = studies.filter((s) => !tagged.has(s.id));

	const panoSlot = FMX_SLOTS.find((sl) => sl.modality === 'panoramic');
	const panos = untagged.filter((s) => s.modality === 'panoramic');
	if (panoSlot && !map.has(panoSlot.key) && panos[0]) map.set(panoSlot.key, panos[0]);

	const xraySlots = FMX_SLOTS.filter((sl) => sl.modality !== 'panoramic');
	const xrays = untagged.filter((s) => s.modality === 'xray');

	// Score every (study, slot) by tooth overlap (+1 tiebreak toward periapical slots,
	// since most uploads are periapicals). Assign greedily by best score.
	const scored: { study: StoredStudy; slot: FmxSlot; score: number }[] = [];
	for (const s of xrays) {
		const teeth = new Set(detectedTeeth(s));
		if (teeth.size === 0) continue;
		for (const sl of xraySlots) {
			if (map.has(sl.key)) continue;
			const overlap = sl.teeth.filter((t) => teeth.has(t)).length;
			if (overlap > 0)
				scored.push({
					study: s,
					slot: sl,
					score: overlap * 2 + (sl.modality === 'periapical' ? 1 : 0)
				});
		}
	}
	scored.sort((a, b) => b.score - a.score);
	const usedStudies = new Set<string>();
	for (const { study, slot } of scored) {
		if (usedStudies.has(study.id) || map.has(slot.key)) continue;
		map.set(slot.key, study);
		usedStudies.add(study.id);
	}
	// Studies with no usable tooth overlap → fill remaining x-ray slots in order.
	const leftoverStudies = xrays.filter((s) => !usedStudies.has(s.id));
	const leftoverSlots = xraySlots.filter((sl) => !map.has(sl.key));
	leftoverStudies.forEach((s, i) => {
		if (leftoverSlots[i]) map.set(leftoverSlots[i].key, s);
	});
	return map;
}

/** The slot a given study occupies in an assignment, or undefined if it isn't placed. */
export function slotKeyForStudy(
	assignment: Map<string, StoredStudy>,
	studyId: string
): string | undefined {
	for (const [k, s] of assignment) if (s.id === studyId) return k;
	return undefined;
}

const DOT_COLORS = {
	calculus: '#06b6d4',
	caries: '#fbbf24',
	bone_loss: '#ec4899',
	periapical: '#a78bfa'
} as const;

/** Locale-aware label for an FMX slot ("Teeth 1-3", "Tooth 6", "Panoramic", …).
 *  Same shape FmxNavigator/FmxGrid use: stem from i18n + space + labelArg.
 *  Powers per-study a11y labels in pickers/tooltips where the visual is just a thumbnail. */
export function fmxSlotLabel(
	slotKey: string | undefined,
	$_: (key: string) => string
): string | undefined {
	if (!slotKey) return undefined;
	const slot = FMX_SLOTS.find((s) => s.key === slotKey);
	if (!slot) return undefined;
	return slot.labelArg ? `${$_(slot.labelKey)} ${slot.labelArg}` : $_(slot.labelKey);
}

/** A crop of a panoramic positioned to fill one FMX slot — the panoramic itself
 *  fills the central slot, and we derive these "virtual" patches for the
 *  surrounding periapical / bitewing slots that would otherwise be empty.
 *  Clicking one opens the source panoramic (it's a zoom-in, not a separate study). */
export interface PanoramicPatch {
	/** The panoramic study these patches come from (open it on click). */
	source: StoredStudy;
	/** Image-relative crop region, 0..1 each. Pair with the source panoramic's
	 *  imageDataUrl to render: `<img src=…>` inside an `overflow:hidden` wrapper
	 *  whose width/height is the cell, scaled & shifted by these fractions. */
	rect: { x: number; y: number; w: number; h: number };
	/** Which teeth ended up inside this patch (used for tooltip / a11y). */
	teeth: number[];
}

/** From a single panoramic study, derive a crop for every FMX slot whose teeth
 *  the AI located. Cropping is computed in IMAGE-RELATIVE coordinates (0..1) so
 *  the caller can render via CSS background-position/-size (no canvas needed).
 *  Returns an empty map when the study isn't a panoramic, has no `number_result`,
 *  has no detected teeth, or imgSize is missing/zero.
 *
 *  `imgSize` is the natural width/height of the panoramic — the bboxes in
 *  number_result are absolute pixel coordinates of the source image, so we
 *  divide here to get the 0..1 fractions the patch renderer wants. */
export function panoramicPatches(
	study: StoredStudy,
	imgSize: { width: number; height: number }
): Map<string, PanoramicPatch> {
	const out = new Map<string, PanoramicPatch>();
	if (study.modality !== 'panoramic') return out;
	if (!imgSize?.width || !imgSize?.height) return out;
	const result = study.inference?.extra?.number_result?.result;
	if (!result || !Array.isArray(result.labels) || !Array.isArray(result.bboxes)) return out;
	const byTooth = new Map<number, [number, number, number, number]>();
	for (let i = 0; i < result.labels.length; i++) {
		const tooth = result.labels[i] + 1; // 0-based label → 1-based universal
		const b = result.bboxes[i] as [number, number, number, number] | undefined;
		if (b) byTooth.set(tooth, b);
	}
	if (byTooth.size === 0) return out;
	for (const slot of FMX_SLOTS) {
		// The panoramic itself fills its central slot — don't generate a "patch
		// of the whole pano" for the slot the pano study already occupies.
		if (slot.modality === 'panoramic') continue;
		const present = slot.teeth.filter((t) => byTooth.has(t));
		if (present.length === 0) continue;
		// Union bbox in pixel coords.
		let x1 = imgSize.width,
			y1 = imgSize.height,
			x2 = 0,
			y2 = 0;
		for (const t of present) {
			const [bx1, by1, bx2, by2] = byTooth.get(t)!;
			if (bx1 < x1) x1 = bx1;
			if (by1 < y1) y1 = by1;
			if (bx2 > x2) x2 = bx2;
			if (by2 > y2) y2 = by2;
		}
		// Pad ~15% on each side for context (so the tooth crowns/roots aren't
		// flush against the cell edge) and clamp to the image.
		const padX = (x2 - x1) * 0.15;
		const padY = (y2 - y1) * 0.15;
		x1 = Math.max(0, x1 - padX);
		y1 = Math.max(0, y1 - padY);
		x2 = Math.min(imgSize.width, x2 + padX);
		y2 = Math.min(imgSize.height, y2 + padY);
		// Convert to 0..1 fractions.
		const fx = x1 / imgSize.width;
		const fy = y1 / imgSize.height;
		const fw = (x2 - x1) / imgSize.width;
		const fh = (y2 - y1) / imgSize.height;
		out.set(slot.key, {
			source: study,
			rect: { x: fx, y: fy, w: fw, h: fh },
			teeth: present
		});
	}
	return out;
}

/** Up to 4 finding-category colours for a study's tile/slot corner dots. */
export function findingDots(study: StoredStudy | undefined): string[] {
	if (!study?.findingCounts) return [];
	const c = study.findingCounts;
	const dots: string[] = [];
	if ((c['dz_9'] ?? 0) > 0) dots.push(DOT_COLORS.calculus);
	if (
		(c['dz_0'] ?? 0) + (c['dz_1'] ?? 0) + (c['dz_2'] ?? 0) + (c['dz_3'] ?? 0) + (c['dz_4'] ?? 0) >
		0
	)
		dots.push(DOT_COLORS.caries);
	if ((c['dz_5'] ?? 0) + (c['dz_6'] ?? 0) + (c['dz_7'] ?? 0) + (c['dz_8'] ?? 0) > 0)
		dots.push(DOT_COLORS.bone_loss);
	if ((c['dz_10'] ?? 0) > 0) dots.push(DOT_COLORS.periapical);
	return dots;
}
