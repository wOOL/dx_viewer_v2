/**
 * Map AI disease labels to ordered severity levels.
 *
 * The label catalogue groups caries by depth (0-4 = Grade 1-5) and bone-loss
 * by stage (5-8 = Stage 1-4) — that ordering is clinically meaningful and we
 * use it to render severity dots + drive "sort by severity".
 *
 * Other findings (calculus, restoration issues, etc.) don't carry a built-in
 * gradient — `severityFor(id)` returns null and the UI falls back to the
 * label colour alone.
 */

import type { DiseaseLabel } from '@be-certain/core/types';

export type SeverityKind = 'caries' | 'bone-loss';
export type Severity = { kind: SeverityKind; level: number; max: number };

const CARIES_LABELS: ReadonlySet<DiseaseLabel> = new Set([0, 1, 2, 3, 4]);
const BONE_LOSS_LABELS: ReadonlySet<DiseaseLabel> = new Set([5, 6, 7, 8]);

export function severityFor(id: number): Severity | null {
	const lbl = id as DiseaseLabel;
	if (CARIES_LABELS.has(lbl)) return { kind: 'caries', level: lbl + 1, max: 5 };
	if (BONE_LOSS_LABELS.has(lbl)) return { kind: 'bone-loss', level: lbl - 4, max: 4 };
	return null;
}

/**
 * Numeric severity for sort. Caries G5 = 5, bone-loss S4 = 4. Findings with
 * no inherent severity sort to 0; ties break by raw confidence elsewhere.
 */
export function severityRank(id: number): number {
	const s = severityFor(id);
	return s ? s.level : 0;
}
