// Spatially sort IOS vertex-colour groups into FDI tooth numbers.
//
// IOS GLBs are space-LPS with Y vertical (in our viewer); upper arch has higher Y,
// anterior has higher Z, X is right→left. The AI ships per-tooth colours but no
// identifiers, so we reverse-engineer FDI by position: auto-detect the vertical
// axis (most balanced upper/lower split), split the arches, sort each by the
// widest-range horizontal axis (R→L), and assign FDI numbers in sequence.
//
// Extracted from Volume3D so the (pure) assignment is unit-testable.

export interface ColorGroupSeed {
	key: string;
	color: [number, number, number];
	vertexCount: number;
	center: { x: number; y: number; z: number };
}

export interface FdiColorGroup extends ColorGroupSeed {
	displayName: string;
	fdi?: number;
}

// R→L within each arch (FDI 18 = upper-right 3rd molar … 28 = upper-left).
export const UPPER_FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_FDI = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

export function assignFdiToGroups(groups: ColorGroupSeed[]): FdiColorGroup[] {
	if (groups.length === 0) return [];

	// Auto-detect the vertical axis: try X/Y/Z; pick whichever gives the most
	// balanced upper/lower split. Within it, use the axis with the largest spread
	// (excluding vertical) as the left/right axis.
	const axes: Array<{ vert: 'x' | 'y' | 'z'; horiz: 'x' | 'y' | 'z'; balance: number }> = [];
	for (const vert of ['x', 'y', 'z'] as const) {
		const meanV = groups.reduce((a, g) => a + g.center[vert], 0) / groups.length;
		const upperCount = groups.filter((g) => g.center[vert] >= meanV).length;
		const lowerCount = groups.length - upperCount;
		const balance = Math.min(upperCount, lowerCount) / Math.max(upperCount, lowerCount, 1);
		const horizCandidates = (['x', 'y', 'z'] as const).filter((a) => a !== vert);
		let bestHoriz: 'x' | 'y' | 'z' = horizCandidates[0];
		let bestRange = -1;
		for (const h of horizCandidates) {
			const vals = groups.map((g) => g.center[h]);
			const range = Math.max(...vals) - Math.min(...vals);
			if (range > bestRange) {
				bestRange = range;
				bestHoriz = h;
			}
		}
		axes.push({ vert, horiz: bestHoriz, balance });
	}
	// Best vertical = highest balance ratio (most evenly split).
	axes.sort((a, b) => b.balance - a.balance);
	const { vert, horiz, balance } = axes[0];
	const result: FdiColorGroup[] = [];

	// Assign FDI numbers from `arr` in sorted order. Groups past the 16 slots in an
	// arch (rare over-segmentation) are DROPPED rather than clamped to the last slot
	// — clamping minted DUPLICATE FDIs / displayNames, which collide as `{#each}` keys
	// in the Layers panel (a Svelte crash). Dropping matches the CBCT sibling
	// (deriveToothMapping), which also stops at the slot count.
	const assignArch = (arch: ColorGroupSeed[], arr: number[]) => {
		const n = Math.min(arch.length, arr.length);
		for (let i = 0; i < n; i++) {
			const fdi = arr[i];
			result.push({ ...arch[i], displayName: `Tooth ${fdi}`, fdi });
		}
	};

	// If even the best axis is heavily skewed (<10% on the minority side), treat all
	// groups as one arch. Default to the lower arch (IOS partial scans are typically
	// lower-jaw impressions).
	if (balance < 0.1) {
		const sorted = [...groups].sort((a, b) => a.center[horiz] - b.center[horiz]);
		assignArch(sorted, LOWER_FDI);
		return result;
	}

	const meanV = groups.reduce((a, g) => a + g.center[vert], 0) / groups.length;
	const upper = groups
		.filter((g) => g.center[vert] >= meanV)
		.sort((a, b) => a.center[horiz] - b.center[horiz]);
	const lower = groups
		.filter((g) => g.center[vert] < meanV)
		.sort((a, b) => a.center[horiz] - b.center[horiz]);
	assignArch(upper, UPPER_FDI);
	assignArch(lower, LOWER_FDI);
	return result;
}
