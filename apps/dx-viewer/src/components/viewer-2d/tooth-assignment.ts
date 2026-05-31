/**
 * Spatial helpers — IoU-based assignment of disease/anatomy findings to the
 * tooth they sit on, plus FDI quadrant aggregation.
 *
 * Both the per-tooth grouped sidebar view and the QuadrantSummary card read
 * from these. Pure functions, no Svelte state — fully unit-testable.
 */

import type { AnalysisResponse } from '@be-certain/core/types';

export type Quadrant = 'UR' | 'UL' | 'LL' | 'LR';

export type ToothAssignment = {
	// Index into number_result.result.bboxes, or null if no tooth contained it.
	toothIndex: number | null;
};

function area([x1, y1, x2, y2]: number[]): number {
	return Math.max(0, x2! - x1!) * Math.max(0, y2! - y1!);
}

export function iou(a: number[], b: number[]): number {
	const ix1 = Math.max(a[0]!, b[0]!);
	const iy1 = Math.max(a[1]!, b[1]!);
	const ix2 = Math.min(a[2]!, b[2]!);
	const iy2 = Math.min(a[3]!, b[3]!);
	const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
	const union = area(a) + area(b) - inter;
	return union > 0 ? inter / union : 0;
}

/**
 * For each detection bbox, find the tooth bbox with highest IoU above a
 * threshold; fall back to "tooth whose centre is closest to the detection
 * centre" so a small caries that just touches the tooth gets attributed.
 * Returns -1 if there are no tooth bboxes at all.
 */
export function assignToTeeth(
	detectionBboxes: number[][],
	toothBboxes: number[][]
): number[] {
	if (toothBboxes.length === 0) return detectionBboxes.map(() => -1);
	return detectionBboxes.map((d) => {
		let bestI = -1;
		let bestIoU = 0;
		for (let i = 0; i < toothBboxes.length; i++) {
			const v = iou(d, toothBboxes[i]!);
			if (v > bestIoU) {
				bestIoU = v;
				bestI = i;
			}
		}
		if (bestIoU >= 0.02) return bestI;
		// Fallback: closest centre.
		const dx = (d[0]! + d[2]!) / 2;
		const dy = (d[1]! + d[3]!) / 2;
		let bestDist = Infinity;
		let closest = -1;
		for (let i = 0; i < toothBboxes.length; i++) {
			const t = toothBboxes[i]!;
			const tx = (t[0]! + t[2]!) / 2;
			const ty = (t[1]! + t[3]!) / 2;
			const dist = Math.hypot(dx - tx, dy - ty);
			if (dist < bestDist) {
				bestDist = dist;
				closest = i;
			}
		}
		return closest;
	});
}

/**
 * Tooth label id (0-31) → FDI quadrant. Independent of the user's numbering
 * preference: the label id encodes the anatomic position.
 *
 * 0-7 = upper right, 8-15 = upper left, 16-23 = lower left, 24-31 = lower right.
 */
export function quadrantOf(toothLabelId: number): Quadrant {
	if (toothLabelId < 8) return 'UR';
	if (toothLabelId < 16) return 'UL';
	if (toothLabelId < 24) return 'LL';
	return 'LR';
}

export type QuadrantCounts = Record<Quadrant, number>;

/**
 * Count disease + anatomy findings per FDI quadrant. Anatomy without a
 * tooth assignment is dropped (anatomical structures span teeth — we only
 * care about anomalies). Disease without a tooth assignment is bucketed
 * under the closest tooth's quadrant.
 */
export function quadrantCounts(
	analysis: AnalysisResponse,
	diseaseToTooth: number[]
): QuadrantCounts {
	const counts: QuadrantCounts = { UR: 0, UL: 0, LL: 0, LR: 0 };
	const toothLabels = analysis.extra.number_result.result.labels;
	for (let i = 0; i < diseaseToTooth.length; i++) {
		const toothIdx = diseaseToTooth[i]!;
		if (toothIdx < 0) continue;
		const labelId = toothLabels[toothIdx];
		if (labelId === undefined) continue;
		counts[quadrantOf(labelId)]++;
	}
	return counts;
}
