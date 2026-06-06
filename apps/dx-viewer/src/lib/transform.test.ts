import { describe, it, expect } from 'vitest';
import { screenToImage, imageToScreen, type ViewTransform } from './transform';

function tf(over: Partial<ViewTransform> = {}): ViewTransform {
	return {
		scale: 1,
		tx: 0,
		ty: 0,
		flipH: false,
		flipV: false,
		rotation: 0,
		imgW: 400,
		imgH: 300,
		...over
	};
}

// screenToImage MUST be the exact inverse of imageToScreen (= applyTransform) for
// every combination — the regression that prompted the extraction was flip+rotate
// together mis-mapping clicks.
const COMBOS: ViewTransform[] = [
	tf(),
	tf({ scale: 2, tx: 30, ty: -20 }),
	tf({ flipH: true }),
	tf({ flipV: true }),
	tf({ rotation: 90 }),
	tf({ rotation: -90 }),
	tf({ flipH: true, rotation: 90 }), // the historically-buggy combination
	tf({ flipH: true, flipV: true, rotation: 180 }),
	tf({ scale: 1.5, tx: 12, ty: 8, flipV: true, rotation: 90 })
];

describe('screenToImage ∘ imageToScreen round-trips for every transform combo', () => {
	const pts: [number, number][] = [
		[0, 0],
		[400, 300],
		[200, 150],
		[123, 47]
	];
	for (let i = 0; i < COMBOS.length; i++) {
		const t = COMBOS[i]!;
		it(`combo ${i} (flipH=${t.flipH} flipV=${t.flipV} rot=${t.rotation} s=${t.scale})`, () => {
			for (const [ix, iy] of pts) {
				const [sx, sy] = imageToScreen(ix, iy, t);
				const [bx, by] = screenToImage(sx, sy, t);
				expect(bx).toBeCloseTo(ix, 6);
				expect(by).toBeCloseTo(iy, 6);
			}
		});
	}
});

describe('screenToImage basics', () => {
	it('undoes pan + zoom', () => {
		const [ix, iy] = screenToImage(130, 80, tf({ scale: 2, tx: 30, ty: -20 }));
		expect(ix).toBeCloseTo(50, 6); // (130-30)/2
		expect(iy).toBeCloseTo(50, 6); // (80-(-20))/2
	});
	it('flips horizontally about the image centre', () => {
		// No pan/zoom: a point at x=120 reflects to imgW-120 = 280.
		expect(screenToImage(120, 10, tf({ flipH: true }))[0]).toBeCloseTo(280, 6);
	});
});
