import { describe, it, expect } from 'vitest';
import { decodeCocoRle, decodeRLE, initials, ringColors, hexToRgb, dataUrlToBase64 } from './image';

// A REAL disease mask captured from prod inference (study zkuljakfxgqpc73). A
// correct pycocotools column-major→row-major decode yields exactly these set
// pixels, every one inside the detection bbox. A transposed / row-col-swapped
// decode (the exact bug class #92 fixed) would scatter pixels outside the bbox.
const REAL_MASK = {
	counts: '`Rg05[^1a0C9H8I6J8H6J8I3L4L4L3L5L3M3M3M2N3M3N1O1O2N1O001O10O1O002N1N3L6K;Cd0lNchZ[1',
	h: 1496,
	w: 1000,
	bbox: [2.68, 1122.97, 72.43, 1273.07], // x1, y1, x2, y2
	expectedSetPixels: 2895
};

describe('decodeCocoRle (#92 pixel masks, not rectangles)', () => {
	it('decodes a real mask to the exact pixel count, all inside the bbox', () => {
		const out = decodeCocoRle(REAL_MASK.counts, REAL_MASK.h, REAL_MASK.w);
		expect(out.length).toBe(REAL_MASK.h * REAL_MASK.w);

		const [x1, y1, x2, y2] = REAL_MASK.bbox;
		let set = 0;
		let outside = 0;
		for (let i = 0; i < out.length; i++) {
			if (!out[i]) continue;
			set++;
			const row = Math.floor(i / REAL_MASK.w);
			const col = i % REAL_MASK.w;
			if (col < x1 - 1 || col > x2 + 1 || row < y1 - 1 || row > y2 + 1) outside++;
		}
		expect(set).toBe(REAL_MASK.expectedSetPixels);
		expect(outside).toBe(0);
		// It's an irregular pixel mask, not a filled bounding rectangle.
		const bboxArea = (x2 - x1) * (y2 - y1);
		expect(set / bboxArea).toBeLessThan(0.6);
	});

	it('guards empty / invalid input with an all-zero mask', () => {
		expect(decodeCocoRle('', 4, 4).every((v) => v === 0)).toBe(true);
		expect(decodeCocoRle('abc', 0, 4).length).toBe(0);
		expect(decodeCocoRle('abc', 4, 0).length).toBe(0);
	});
});

describe('decodeRLE (uncompressed run lengths)', () => {
	it('expands alternating runs starting with background (0)', () => {
		// 3×3 grid, runs [3,2,4] → 3 zeros, 2 ones, 4 zeros in linear order.
		const out = decodeRLE({ size: [3, 3], counts: [3, 2, 4] }, 3, 3);
		expect(Array.from(out)).toEqual([0, 0, 0, 1, 1, 0, 0, 0, 0]);
	});
});

describe('initials', () => {
	it('handles full names, single names, and malformed input', () => {
		expect(initials('Ryan Adamson')).toBe('RA');
		expect(initials('Cher')).toBe('CH');
		expect(initials('a b c')).toBe('AC'); // first + last
		expect(initials('')).toBe('?');
		expect(initials('   ')).toBe('?');
		expect(initials(null as unknown as string)).toBe('?');
	});
});

describe('ringColors', () => {
	it('is deterministic and returns a hex palette pair', () => {
		const a = ringColors('patient-1');
		expect(ringColors('patient-1')).toEqual(a);
		expect(a).toHaveLength(2);
		expect(a[0]).toMatch(/^#[0-9a-f]{6}$/i);
	});
});

describe('hexToRgb', () => {
	it('parses 6- and 3-digit hex', () => {
		expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
		expect(hexToRgb('#00ff00')).toEqual([0, 255, 0]);
		expect(hexToRgb('#0f0')).toEqual([0, 255, 0]);
		expect(hexToRgb('ffffff')).toEqual([255, 255, 255]);
	});
});

describe('dataUrlToBase64', () => {
	it('strips the data-url prefix (and is a no-op without one)', () => {
		expect(dataUrlToBase64('data:image/png;base64,ABC123')).toBe('ABC123');
		expect(dataUrlToBase64('noprefix')).toBe('noprefix');
	});
});
