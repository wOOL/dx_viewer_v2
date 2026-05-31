/**
 * COCO compressed-RLE decoder, ported from pycocotools' `rleFrString`
 * (maskApi.c). Each char encodes 5 bits of a run length, the high bit
 * (0x20) is "more bytes follow", and 0x10 is the sign bit on the final
 * byte. Run lengths after the second are delta-encoded against run[n-2].
 *
 * COCO masks are column-major (Fortran order): pixel (row, col) lives at
 * index `col * h + row` in the decoded mask array. We convert to row-major
 * when painting to a canvas.
 */

import type { Mask } from '@be-certain/core/types';

function decodeCounts(counts: string): number[] {
	const out: number[] = [];
	let p = 0;
	const len = counts.length;
	while (p < len) {
		let x = 0;
		let k = 0;
		let more = 1;
		while (more) {
			const c = counts.charCodeAt(p) - 48;
			x |= (c & 0x1f) << (5 * k);
			more = c & 0x20;
			p++;
			k++;
			if (!more && c & 0x10) x |= ~0 << (5 * k);
		}
		if (out.length > 2) x += out[out.length - 2]!;
		out.push(x);
	}
	return out;
}

/** Column-major binary mask. Length = h * w. */
export function decodeMask(mask: Mask): Uint8Array {
	const [h, w] = mask.size;
	const runs = decodeCounts(mask.counts);
	const out = new Uint8Array(h * w);
	let pos = 0;
	let val = 0;
	for (const run of runs) {
		if (val) out.fill(1, pos, pos + run);
		pos += run;
		val = 1 - val;
	}
	return out;
}

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const v = parseInt(h, 16);
	return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/**
 * Rasterise a decoded mask into a data-URL PNG of the natural mask size.
 * Caller renders this as an SVG <image> at the bbox coords — the browser
 * scales it with the rest of the scene.
 */
export function maskToDataUrl(mask: Mask, color: string, alpha = 0.35): string | null {
	if (typeof document === 'undefined') return null;
	const [h, w] = mask.size;
	if (!h || !w) return null;
	const binary = decodeMask(mask);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const img = ctx.createImageData(w, h);
	const [r, g, b] = hexToRgb(color);
	const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
	const data = img.data;
	for (let row = 0; row < h; row++) {
		for (let col = 0; col < w; col++) {
			if (binary[col * h + row]) {
				const i = (row * w + col) * 4;
				data[i] = r;
				data[i + 1] = g;
				data[i + 2] = b;
				data[i + 3] = a;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas.toDataURL('image/png');
}
