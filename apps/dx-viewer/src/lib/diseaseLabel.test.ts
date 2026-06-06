import { describe, it, expect } from 'vitest';
import { diseaseShortLabel, detectionTagText } from './diseaseLabel';

// #61 — the short label drawn on each AI bbox over the X-ray. Localised via a
// `diseaseShort.<id>` catalog, falling back to the English constant (then the
// full name, then "[id]") so a new model class still renders something.
describe('diseaseShortLabel', () => {
	it('returns the localised string when the catalog has the key', () => {
		// svelte-i18n returns a value distinct from the key when found.
		expect(diseaseShortLabel(5, () => 'Perte osseuse S1')).toBe('Perte osseuse S1');
	});

	it('falls back to the English DISEASE_CLASSES short when the key is missing', () => {
		// A `t` that echoes the key = "not found" → use the constant's short.
		expect(diseaseShortLabel(5, (k) => k)).toBe('BL S1');
	});

	it('falls back to the full class name when there is no short', () => {
		// id 9 (Calculus) has a name but no `short`.
		expect(diseaseShortLabel(9, (k) => k)).toBe('Calculus');
	});

	it('falls back to "[id]" for an unknown class id', () => {
		expect(diseaseShortLabel(999, (k) => k)).toBe('[999]');
	});

	// The bbox label is a SIBLING render path to the findings panel (taxonomy.*) — both
	// must speak the model's true class names. Class 16 is "Missing Coronal Restoration",
	// NOT a "Missing Crown" (a crown is a restoration the model can't even detect). The
	// short form must not reintroduce the "crown" mislabel via the English fallback.
	it('class 16 bbox label is not the mislabeled "Missing Crown"', () => {
		const fallback = diseaseShortLabel(16, (k) => k); // key-echo → constants short
		expect(fallback).not.toMatch(/crown/i);
		expect(fallback).toBe('Missing Restoration');
	});
});

// A clinician-added detection has NO model confidence (withEffectiveDetections gives it a
// synthetic score:1 only so it survives the filter). Rendering that as "100%" fabricates an
// AI certainty — the 2D sibling of the CBCT missing-tooth confidence fix.
describe('detectionTagText', () => {
	it('shows an AI detection with its rounded model confidence', () => {
		expect(detectionTagText('Caries G1', 0.873, false)).toBe('Caries G1 87%');
		expect(detectionTagText('Periapical', 0.5, false)).toBe('Periapical 50%');
	});

	it('shows a user-added detection with NO percentage (no fabricated confidence)', () => {
		// score is the synthetic 1 — must NOT surface as "100%".
		expect(detectionTagText('Periapical', 1, true)).toBe('Periapical');
		expect(detectionTagText('Periapical', 1, true)).not.toMatch(/%/);
	});

	it('tags a user-added detection with the author initials when provided', () => {
		// Requested: write the user's initials (not "100%") on a clinician-added annotation.
		expect(detectionTagText('Caries G1', 1, true, 'JD')).toBe('Caries G1 · JD');
		expect(detectionTagText('Caries G1', 1, true, 'JD')).not.toMatch(/%/);
		// Initials are ignored for an AI detection (it keeps its confidence).
		expect(detectionTagText('Caries G1', 0.9, false, 'JD')).toBe('Caries G1 90%');
	});

	it('rounds AI scores to a whole percent (no decimal → locale-safe)', () => {
		expect(detectionTagText('X', 0.876, false)).toBe('X 88%'); // rounds up
		expect(detectionTagText('X', 0.231, false)).toBe('X 23%'); // rounds down
		expect(detectionTagText('X', 1, false)).toBe('X 100%');
	});
});
