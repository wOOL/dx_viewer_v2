// Associate each 2D disease detection with the TOOTH it belongs to, for the viewer's
// "by tooth" findings view. The AI returns disease detections (disease_result) and
// tooth-number detections (number_result) as SEPARATE, unlinked boxes — so the link is
// purely geometric: a disease box is assigned to the tooth box it overlaps most, with a
// centre-distance fallback when nothing overlaps (e.g. a peri-apical lesion sitting just
// below the crown box). Kept framework-free so the geometry is unit-testable without a
// canvas or the inference plumbing.

import type { BBox } from './types';

/** Intersection-over-union of two [x1,y1,x2,y2] boxes (0 when disjoint or degenerate). */
export function iou(a: BBox, b: BBox): number {
	const ix1 = Math.max(a[0], b[0]);
	const iy1 = Math.max(a[1], b[1]);
	const ix2 = Math.min(a[2], b[2]);
	const iy2 = Math.min(a[3], b[3]);
	const iw = ix2 - ix1;
	const ih = iy2 - iy1;
	if (iw <= 0 || ih <= 0) return 0;
	const inter = iw * ih;
	const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
	const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
	const union = areaA + areaB - inter;
	return union > 0 ? inter / union : 0;
}

/** Fraction of box `a` that lies inside box `b` (a's-area-covered / a's-area). Better
 *  than IoU for a small disease box inside a large tooth box, where IoU is diluted by
 *  the tooth's area. 0 when disjoint or `a` is degenerate. */
export function containment(a: BBox, b: BBox): number {
	const ix1 = Math.max(a[0], b[0]);
	const iy1 = Math.max(a[1], b[1]);
	const ix2 = Math.min(a[2], b[2]);
	const iy2 = Math.min(a[3], b[3]);
	const iw = ix2 - ix1;
	const ih = iy2 - iy1;
	if (iw <= 0 || ih <= 0) return 0;
	const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
	return areaA > 0 ? (iw * ih) / areaA : 0;
}

function centre(b: BBox): [number, number] {
	return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function dist2(a: BBox, b: BBox): number {
	const [ax, ay] = centre(a);
	const [bx, by] = centre(b);
	return (ax - bx) ** 2 + (ay - by) ** 2;
}

export interface Tooth {
	/** Index into the original number_result arrays (stable id for the tooth). */
	index: number;
	/** The model's tooth label id (feed to toothLabel/toothDisplay for the shown number). */
	label: number;
	box: BBox;
}

/**
 * Pick the tooth a disease box belongs to. Preference order:
 *   1. the tooth with the highest CONTAINMENT (most of the disease box sits inside it),
 *      as long as it clears `minContainment` — handles the common small-lesion-inside-
 *      crown case where IoU would be misleadingly tiny;
 *   2. otherwise the tooth whose centre is NEAREST the disease box centre — handles a
 *      lesion that sits just outside every tooth box (apical radiolucency, calculus on
 *      the root) so it still files under the closest tooth instead of "unassigned".
 * Returns the chosen tooth's `index`, or null when there are no teeth at all.
 */
export function toothForDisease(
	diseaseBox: BBox,
	teeth: Tooth[],
	minContainment = 0.15
): number | null {
	if (teeth.length === 0) return null;

	let bestContain = -1;
	let bestContainIdx = -1;
	for (const t of teeth) {
		const c = containment(diseaseBox, t.box);
		if (c > bestContain) {
			bestContain = c;
			bestContainIdx = t.index;
		}
	}
	if (bestContain >= minContainment) return bestContainIdx;

	// Fallback: nearest tooth centre.
	let bestDist = Infinity;
	let bestIdx = teeth[0]!.index;
	for (const t of teeth) {
		const d = dist2(diseaseBox, t.box);
		if (d < bestDist) {
			bestDist = d;
			bestIdx = t.index;
		}
	}
	return bestIdx;
}

export interface DiseaseRef {
	/** Index into the disease_result arrays — the stable id of this detection. */
	index: number;
	label: number;
	box: BBox;
	score: number;
}

export interface ToothGroup {
	tooth: Tooth;
	diseases: DiseaseRef[];
}

/**
 * Group disease detections under their teeth for the "by tooth" panel. Only teeth that
 * actually have ≥1 assigned disease are returned (an unaffected tooth needs no row),
 * ordered by the tooth box's position — left-to-right, then top-to-bottom — so the list
 * reads like the mouth. Diseases that can't be placed (no teeth detected) are returned
 * separately so the UI can still show them under an "Unassigned" heading rather than
 * dropping them.
 */
export function groupDiseasesByTooth(
	diseases: DiseaseRef[],
	teeth: Tooth[],
	minContainment = 0.15
): { groups: ToothGroup[]; unassigned: DiseaseRef[] } {
	const byToothIndex = new Map<number, ToothGroup>();
	const unassigned: DiseaseRef[] = [];

	for (const d of diseases) {
		const tIdx = toothForDisease(d.box, teeth, minContainment);
		if (tIdx == null) {
			unassigned.push(d);
			continue;
		}
		let g = byToothIndex.get(tIdx);
		if (!g) {
			const tooth = teeth.find((t) => t.index === tIdx)!;
			g = { tooth, diseases: [] };
			byToothIndex.set(tIdx, g);
		}
		g.diseases.push(d);
	}

	const groups = [...byToothIndex.values()].sort((a, b) => {
		const [ax, ay] = centre(a.tooth.box);
		const [bx, by] = centre(b.tooth.box);
		// Rows of teeth: cluster by vertical band first (within ~half a tooth height),
		// then left-to-right. Using a coarse band keeps a slightly tilted arch readable.
		const bandA = Math.round(ay / 50);
		const bandB = Math.round(by / 50);
		return bandA !== bandB ? bandA - bandB : ax - bx;
	});

	return { groups, unassigned };
}
