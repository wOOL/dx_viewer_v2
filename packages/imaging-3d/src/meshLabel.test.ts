import { describe, expect, it, afterEach } from 'vitest';
import { meshDisplayName } from './meshLabel';
import { prefs } from '@be-certain/core/stores/prefs';

const fakeT = (table: Record<string, string>) => (key: string) => table[key] ?? key;

describe('meshDisplayName', () => {
	// meshDisplayName → toothDisplay now reads the reactive `prefs.toothNumbering`
	// rune (S2-#3), not localStorage. Drive the shared store and restore the default.
	afterEach(() => prefs.setToothNumbering('universal'));

	const fr = fakeT({
		'cbct.tooth': 'Dent',
		'cbct.jaw': 'Mâchoire',
		'cbct.canal': 'Canal',
		'cbct.mesh': 'Maillage'
	});
	const en = fakeT({
		'cbct.tooth': 'Tooth',
		'cbct.jaw': 'Jaw',
		'cbct.canal': 'Canal',
		'cbct.mesh': 'Mesh'
	});

	// Pin the numbering preference to FDI so the tooth NUMBER is preserved — this
	// isolates the locale/prefix routing from the numbering conversion tested below.
	const useFdiNumbering = () => prefs.setToothNumbering('fdi');

	describe('with FDI numbering selected', () => {
		it('translates the "Tooth" word to the active locale, keeping the FDI number', () => {
			useFdiNumbering();
			expect(meshDisplayName('Tooth 18', fr)).toBe('Dent 18');
			expect(meshDisplayName('Tooth 11', fr)).toBe('Dent 11');
			expect(meshDisplayName('Tooth 11', en)).toBe('Tooth 11');
		});

		it('translates "Mesh N", "Jaw", "Canal"', () => {
			useFdiNumbering();
			expect(meshDisplayName('Mesh 3', fr)).toBe('Maillage 3');
			expect(meshDisplayName('Jaw', fr)).toBe('Mâchoire');
			expect(meshDisplayName('Canal', fr)).toBe('Canal');
		});

		it('is case-insensitive for the recognised prefixes', () => {
			useFdiNumbering();
			expect(meshDisplayName('tooth 25', fr)).toBe('Dent 25');
			expect(meshDisplayName('JAW', fr)).toBe('Mâchoire');
		});
	});

	it('renders the tooth number in the active numbering preference (default Universal)', () => {
		// Universal preference → the Layers panel matches the chart / overlays / report
		// instead of showing raw FDI. Set it explicitly: the `prefs` rune is a shared
		// module singleton, so a prior test (even in another file in this worker) could
		// have left it on 'fdi'; don't rely on residual state.
		prefs.setToothNumbering('universal');
		expect(meshDisplayName('Tooth 18', en)).toBe('Tooth 1'); // FDI 18 = Universal 1
		expect(meshDisplayName('Tooth 11', fr)).toBe('Dent 8'); // FDI 11 = Universal 8
		// "Mesh N" carries an index, not an FDI — it must never be renumbered.
		expect(meshDisplayName('Mesh 3', en)).toBe('Mesh 3');
		expect(meshDisplayName('Jaw', en)).toBe('Jaw');
	});

	it('passes unknown mesh names through unchanged (AI-stable identity)', () => {
		expect(meshDisplayName('Something Weird', fr)).toBe('Something Weird');
		expect(meshDisplayName('', fr)).toBe('');
	});
});
