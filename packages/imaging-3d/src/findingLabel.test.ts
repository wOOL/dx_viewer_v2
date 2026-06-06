import { describe, expect, it } from 'vitest';
import { findingTypeLabel } from './findingLabel';

const fakeT = (table: Record<string, string>) => (key: string) => table[key] ?? key;

describe('findingTypeLabel', () => {
	const en = fakeT({ 'cbct.synthMissingTooth': 'Missing tooth (segmentation gap)' });
	const fr = fakeT({ 'cbct.synthMissingTooth': 'Dent manquante (lacune de segmentation)' });

	it('translates the synthesized "Missing tooth" string', () => {
		expect(findingTypeLabel('Missing tooth (segmentation gap)', fr)).toBe(
			'Dent manquante (lacune de segmentation)'
		);
		expect(findingTypeLabel('Missing tooth (segmentation gap)', en)).toBe(
			'Missing tooth (segmentation gap)'
		);
	});

	it('passes unknown (real AI-emitted) finding types through unchanged', () => {
		// The AI is English-only for now — real findings like these aren't
		// translated, they just render as-is in every locale.
		expect(findingTypeLabel('Caries D2', fr)).toBe('Caries D2');
		expect(findingTypeLabel('Periapical lesion', fr)).toBe('Periapical lesion');
	});
});
