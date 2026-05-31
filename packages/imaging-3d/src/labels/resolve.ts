import type { LabelSchema, ResolvedLabel } from '../types/index.js';

/**
 * Single chokepoint for "what colour and label does id N get?".
 * Unknown ids resolve to a synthetic `Unmapped label N` under the `other`
 * group — viewer + UI never have to branch for the unknown case.
 */
export function resolveLabel(schema: LabelSchema, id: number): ResolvedLabel {
	const entry = schema.labels[id];
	if (entry) {
		const group = schema.groups[entry.group] ?? schema.groups['other']!;
		return {
			id,
			name: entry.name,
			groupKey: entry.group,
			group: group.name,
			color: group.color
		};
	}
	const other = schema.groups['other']!;
	return {
		id,
		name: `Unmapped label ${id}`,
		groupKey: 'other',
		group: other.name,
		color: other.color
	};
}
