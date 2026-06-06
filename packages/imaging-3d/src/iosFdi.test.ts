import { describe, it, expect } from 'vitest';
import { assignFdiToGroups, UPPER_FDI, LOWER_FDI } from './iosFdi';

const seed = (key: string, x: number, y: number, z = 0) => ({
	key,
	color: [0.5, 0.5, 0.5] as [number, number, number],
	vertexCount: 100,
	center: { x, y, z }
});

describe('assignFdiToGroups', () => {
	it('returns [] for no groups', () => {
		expect(assignFdiToGroups([])).toEqual([]);
	});

	it('assigns a real FDI per group (R→L within the balanced-split arch)', () => {
		// Y is the balanced upper/lower split; X is the widest-range (left/right) axis.
		const groups = [
			seed('u-right', 0, 10),
			seed('u-mid', 5, 10),
			seed('u-left', 9, 10),
			seed('l-right', 0, 0),
			seed('l-mid', 5, 0),
			seed('l-left', 9, 0)
		];
		const out = assignFdiToGroups(groups);
		expect(out.length).toBe(6);
		for (const g of out) {
			expect([...UPPER_FDI, ...LOWER_FDI]).toContain(g.fdi);
			expect(g.displayName).toBe(`Tooth ${g.fdi}`);
		}
		// Rightmost upper tooth (lowest X) is FDI 18; the upper arch is 18,17,16.
		expect(out.slice(0, 3).map((g) => g.fdi)).toEqual([18, 17, 16]);
	});

	it('never mints duplicate FDIs / displayNames past the 16 slots per arch', () => {
		// 40 groups → at least one arch exceeds the 16 FDI slots. The OLD code clamped
		// every extra to the last FDI (e.g. 28), minting duplicate fdi + displayName —
		// and duplicate displayNames collide as `{#each (m.name)}` keys in the Layers
		// panel (a Svelte crash). Extras must be DROPPED (like the CBCT sibling), so the
		// output stays duplicate-free.
		const groups = Array.from({ length: 40 }, (_, i) => seed(`g${i}`, i, (i % 2) * 10));
		const out = assignFdiToGroups(groups);
		const fdis = out.map((g) => g.fdi);
		const names = out.map((g) => g.displayName);
		expect(new Set(fdis).size).toBe(fdis.length); // no duplicate FDI
		expect(new Set(names).size).toBe(names.length); // no duplicate display name (the each-key)
		expect(out.length).toBeLessThanOrEqual(UPPER_FDI.length + LOWER_FDI.length); // ≤ 32, extras dropped
		expect(out.length).toBeGreaterThan(16); // both arches still populated
	});

	it('handles the single-arch (heavily-skewed-on-every-axis) path without duplicates', () => {
		// A tight cluster + one far outlier skews EVERY axis (<10% minority) → the
		// best axis still has balance < 0.1 → the single-arch path. It had the same
		// clamp bug, so verify it drops extras instead of duplicating the last FDI.
		const groups = [
			...Array.from({ length: 20 }, (_, i) => seed(`c${i}`, i * 0.001, i * 0.001, i * 0.001)),
			seed('outlier', 100, 100, 100)
		];
		const out = assignFdiToGroups(groups);
		const fdis = out.map((g) => g.fdi);
		expect(new Set(fdis).size).toBe(fdis.length);
		expect(out.length).toBe(LOWER_FDI.length); // 21 groups → 16 assigned, 5 dropped
	});
});
