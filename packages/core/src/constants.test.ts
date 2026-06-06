import { describe, it, expect, afterEach } from 'vitest';
import {
	diseaseById,
	segById,
	FDI_TOOTH,
	UNIVERSAL_TOOTH,
	DISEASE_CLASSES,
	PEARL_FINDING_TAXONOMY,
	DIAGNOSTIC_GROUPS,
	toothLabel,
	toothDisplay
} from './constants';
import { prefs } from './stores/prefs.svelte';

describe('DIAGNOSTIC_GROUPS (Diagnostic Results grouping)', () => {
	it('groups ONLY caries + bone loss; every other disease keeps its own row', () => {
		// Caries (0–4) and Bone Loss (5–8) are the only multi-class groups.
		expect(DIAGNOSTIC_GROUPS[0]!.classIds).toEqual([0, 1, 2, 3, 4]);
		expect(DIAGNOSTIC_GROUPS[0]!.labelKey).toBe('findings.group.dentalCaries');
		expect(DIAGNOSTIC_GROUPS[1]!.classIds).toEqual([5, 6, 7, 8]);
		expect(DIAGNOSTIC_GROUPS[1]!.labelKey).toBe('findings.group.boneLoss');
		// The rest are single-class rows (named from the class itself, not a group key).
		const rest = DIAGNOSTIC_GROUPS.slice(2);
		expect(
			rest.every((g) => g.classIds.length === 1 && g.labelClassId === g.classIds[0] && !g.labelKey)
		).toBe(true);
		// …in model-id order: Calculus, Periapical, Int/Ext Resorption, Restoration
		// Radiolucency, Open Margin, Remaining Root, Missing Coronal Restoration, Overhang.
		expect(rest.map((g) => g.classIds[0])).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 18]);
	});
	it('partitions every taxonomy class into exactly one group (no overlap, no loss, no Other catch-all)', () => {
		const taxonomy = [...new Set(PEARL_FINDING_TAXONOMY.flatMap((r) => r.ids))].sort(
			(a, b) => a - b
		);
		const grouped = DIAGNOSTIC_GROUPS.flatMap((g) => g.classIds);
		expect(grouped.length).toBe(new Set(grouped).size);
		expect([...grouped].sort((a, b) => a - b)).toEqual(taxonomy);
		// no "otherFindings" bucket anymore
		expect(DIAGNOSTIC_GROUPS.some((g) => g.key === 'otherFindings')).toBe(false);
	});
});

describe('diseaseById (#21 unmapped classes)', () => {
	it('returns the mapped class for a known id', () => {
		const knownId = Number(Object.keys(DISEASE_CLASSES)[0]);
		const c = diseaseById(knownId);
		expect(c.id).toBe(knownId);
		expect(c.name).not.toMatch(/^Class /); // a real, named class
	});

	it('falls back gracefully for an unmapped id (no crash, neutral "other")', () => {
		expect(diseaseById(99999)).toMatchObject({ id: 99999, name: 'Class 99999', group: 'other' });
	});
});

describe('segById', () => {
	it('falls back for an unmapped id', () => {
		expect(segById(99999)).toMatchObject({ id: 99999, name: 'Class 99999' });
	});
});

describe('PEARL_FINDING_TAXONOMY — no fabricated rows (the "Non-Pathology" bug)', () => {
	const validIds = new Set(DISEASE_CLASSES.map((c) => c.id));

	it('every taxonomy row maps to at least one model class (no inert fake toggles)', () => {
		// The model (DISEASE_CLASSES, 20 finding classes) cannot detect intact
		// restorations — crown/bridge/implant/root-canal/impaction are NOT findings.
		// A row with `ids: []` is a fabricated control that lies about AI capability.
		const fake = PEARL_FINDING_TAXONOMY.filter((r) => r.ids.length === 0).map((r) => r.key);
		expect(fake, `taxonomy rows with no model class: ${fake.join(', ')}`).toEqual([]);
	});

	it('every taxonomy id is a real DISEASE_CLASSES id', () => {
		const orphan = PEARL_FINDING_TAXONOMY.flatMap((r) => r.ids).filter((id) => !validIds.has(id));
		expect(orphan, `taxonomy ids not in DISEASE_CLASSES: ${orphan.join(', ')}`).toEqual([]);
	});

	it('does not resurrect the mislabeled Filling/Missing-Crown rows; class 13/16 use their true keys', () => {
		const keys = PEARL_FINDING_TAXONOMY.map((r) => r.key);
		// The 5 fabricated keys + the 2 mislabeled keys must be gone.
		for (const dead of [
			'bridge',
			'crown',
			'filling',
			'impaction',
			'implant',
			'rootCanal',
			'missingCrown'
		]) {
			expect(keys, `fabricated/mislabeled taxonomy key resurfaced: ${dead}`).not.toContain(dead);
		}
		// Class 13 (Restoration Radiolucency) + 16 (Missing Coronal Restoration) are
		// real findings and must still be reachable under their correct keys.
		const byId = (id: number) => PEARL_FINDING_TAXONOMY.find((r) => r.ids.includes(id))?.key;
		expect(byId(13)).toBe('restorationRadiolucency');
		expect(byId(16)).toBe('missingCoronalRestoration');
	});

	it('covers every real finding class except the Unsure/Other catch-alls', () => {
		// The taxonomy is the single source of truth for BOTH the in-viewer findings
		// panel and the printout pathology toggles (the printout derives its rows from
		// it). So every detectable disease class — all of DISEASE_CLASSES except 17
		// (Unsure) and 19 (Other), which are intentionally not shown — must appear in
		// some taxonomy row, or a real finding (e.g. Bone Loss) would be untoggleable.
		const covered = new Set(PEARL_FINDING_TAXONOMY.flatMap((r) => r.ids));
		const missing = DISEASE_CLASSES.map((c) => c.id)
			.filter((id) => id !== 17 && id !== 19)
			.filter((id) => !covered.has(id));
		expect(missing, `model classes absent from the taxonomy: ${missing.join(', ')}`).toEqual([]);
	});
});

describe('FDI / Universal tooth tables', () => {
	it('both list all 32 teeth', () => {
		expect(FDI_TOOTH).toHaveLength(32);
		expect(UNIVERSAL_TOOTH).toHaveLength(32);
	});
});

describe('toothLabel (index → numbering-system label)', () => {
	it('maps a 0-based index to Universal by default, FDI when asked', () => {
		expect(toothLabel(0)).toBe('1'); // Universal tooth 1
		expect(toothLabel(7)).toBe('8');
		expect(toothLabel(0, true)).toBe('18'); // FDI upper-right 3rd molar
		expect(toothLabel(7, true)).toBe('11'); // FDI upper-right central incisor
	});
	it('falls back to the raw index for out-of-range', () => {
		expect(toothLabel(99)).toBe('99');
	});
});

describe('toothDisplay (FDI number → shown label per preference)', () => {
	// toothDisplay now reads the reactive `prefs.toothNumbering` rune (S2-#3), not
	// localStorage directly. Drive the store and restore the default afterwards.
	afterEach(() => {
		prefs.setToothNumbering('universal');
	});

	it('defaults to Universal: FDI 18→1, 11→8, 21→9', () => {
		expect(toothDisplay(18)).toBe('1');
		expect(toothDisplay(11)).toBe('8');
		expect(toothDisplay(21)).toBe('9');
	});
	it('passes an unknown FDI number through unchanged', () => {
		expect(toothDisplay(99)).toBe('99');
	});
	it('shows the raw FDI number when the preference is "fdi"', () => {
		prefs.setToothNumbering('fdi');
		expect(toothDisplay(11)).toBe('11');
		expect(toothDisplay(18)).toBe('18');
	});
});
