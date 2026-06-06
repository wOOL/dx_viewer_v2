import { describe, it, expect } from 'vitest';
import {
	FMX_SLOTS,
	assignStudiesToSlots,
	slotKeyForStudy,
	findingDots,
	fmxSlotLabel,
	panoramicPatches
} from './fmx';
import type { StoredStudy } from './types';

function study(id: string, opts: Partial<StoredStudy> & { teeth?: number[] } = {}): StoredStudy {
	const { teeth, ...rest } = opts;
	const s: StoredStudy = {
		id,
		patientId: 'p',
		patientName: 'P',
		capturedAt: '2026-05-01T00:00:00Z',
		modality: 'xray',
		...rest
	};
	if (teeth) {
		// number_result labels are 0-based tooth-class indices (tooth N → label N-1).
		s.inference = {
			extra: { number_result: { result: { labels: teeth.map((t) => t - 1) } } }
		} as unknown as StoredStudy['inference'];
	}
	return s;
}

describe('fmx template + assignment', () => {
	it('has the 19-slot template with one central panoramic, 14 PAs, 4 bitewings', () => {
		expect(FMX_SLOTS.length).toBe(19);
		expect(FMX_SLOTS.filter((s) => s.modality === 'panoramic')).toHaveLength(1);
		expect(FMX_SLOTS.filter((s) => s.modality === 'periapical')).toHaveLength(14);
		expect(FMX_SLOTS.filter((s) => s.modality === 'bitewing')).toHaveLength(4);
	});

	it('places a panoramic in the central pano slot', () => {
		const m = assignStudiesToSlots([study('pano1', { modality: 'panoramic' })]);
		expect(m.get('pano')?.id).toBe('pano1');
	});

	it('auto-assigns an x-ray to the slot overlapping its detected teeth', () => {
		// Detected teeth 1-3 → slot pa-ur-mol (teeth [1,2,3]).
		const m = assignStudiesToSlots([study('x1', { teeth: [1, 2, 3] })]);
		expect(slotKeyForStudy(m, 'x1')).toBe('pa-ur-mol');
	});

	it('honours an explicit fmxSlot tag over tooth-overlap auto-assignment', () => {
		const m = assignStudiesToSlots([study('x2', { teeth: [1, 2, 3], fmxSlot: 'pa-ll-mol' })]);
		expect(slotKeyForStudy(m, 'x2')).toBe('pa-ll-mol');
	});

	it('finding dots reflect the recorded finding categories (and none when empty)', () => {
		const s = study('x3', { findingCounts: { dz_9: 2, dz_0: 1 } }); // calculus + caries
		expect(findingDots(s).length).toBe(2);
		expect(findingDots(study('x4'))).toEqual([]);
	});

	describe('fmxSlotLabel', () => {
		// Stub the svelte-i18n $_ resolver — return a stable English string per key.
		const _ = (k: string) =>
			({
				'fmx.teeth': 'Teeth',
				'fmx.tooth': 'Tooth',
				'fmx.bwRight': 'BW R',
				'fmx.bwLeft': 'BW L',
				'fmx.panoramic': 'Panoramic'
			})[k] ?? k;
		it('returns "Teeth 1-3" for the upper-right molar PA slot', () => {
			expect(fmxSlotLabel('pa-ur-mol', _)).toBe('Teeth 1-3');
		});
		it('returns "Panoramic" (no positional arg) for the pano slot', () => {
			expect(fmxSlotLabel('pano', _)).toBe('Panoramic');
		});
		it('returns undefined for unknown / missing slots', () => {
			expect(fmxSlotLabel(undefined, _)).toBeUndefined();
			expect(fmxSlotLabel('not-a-real-slot', _)).toBeUndefined();
		});
	});

	describe('panoramicPatches', () => {
		// A 1000×500 panoramic with two tooth bboxes — teeth 1 and 2 (so they
		// land in the upper-right molar slot whose teeth are [1,2,3]).
		function panoStudy(): StoredStudy {
			return {
				id: 'pano1',
				patientId: 'p',
				patientName: 'P',
				capturedAt: '2026-05-01T00:00:00Z',
				modality: 'panoramic',
				imageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
				inference: {
					extra: {
						number_result: {
							result: {
								labels: [0, 1], // teeth 1 and 2 (0-based label + 1)
								bboxes: [
									[850, 150, 940, 280],
									[760, 160, 850, 290]
								]
							}
						}
					}
				} as unknown as StoredStudy['inference']
			};
		}

		it('returns a patch for the slot whose teeth the AI located', () => {
			const m = panoramicPatches(panoStudy(), { width: 1000, height: 500 });
			expect(m.size).toBeGreaterThan(0);
			const p = m.get('pa-ur-mol'); // teeth [1, 2, 3]
			expect(p).toBeDefined();
			expect(p!.teeth.sort()).toEqual([1, 2]);
			expect(p!.rect.x).toBeLessThan(p!.rect.x + p!.rect.w);
			// Coords are 0..1 fractions.
			expect(p!.rect.x).toBeGreaterThanOrEqual(0);
			expect(p!.rect.x + p!.rect.w).toBeLessThanOrEqual(1.001);
		});

		it('skips the central pano slot (it already shows the whole panoramic)', () => {
			const m = panoramicPatches(panoStudy(), { width: 1000, height: 500 });
			expect(m.get('pano')).toBeUndefined();
		});

		it('returns empty when the study is not a panoramic, has no inference, or imgSize is zero', () => {
			const ok = { width: 1000, height: 500 };
			const xrayStudy = { ...panoStudy(), modality: 'xray' as const };
			expect(panoramicPatches(xrayStudy, ok).size).toBe(0);
			const noInf = { ...panoStudy(), inference: undefined };
			expect(panoramicPatches(noInf, ok).size).toBe(0);
			expect(panoramicPatches(panoStudy(), { width: 0, height: 500 }).size).toBe(0);
		});
	});
});
