export function fileToDataUrl(file: File | Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

export function dataUrlToBase64(dataUrl: string): string {
	const i = dataUrl.indexOf(',');
	return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export async function fileToBase64(file: File | Blob): Promise<string> {
	const dataUrl = await fileToDataUrl(file);
	return dataUrlToBase64(dataUrl);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = (e) => reject(e);
		img.src = src;
	});
}

export function initials(name: string): string {
	// Null-safe: a malformed/missing name must not throw (it's called per-patient when
	// building the studies list, so a single bad record would otherwise blank the list).
	const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
	return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const RING_PALETTES: Array<[string, string]> = [
	['#06b6d4', '#a855f7'],
	['#fb7185', '#06b6d4'],
	['#10b981', '#fbbf24'],
	['#a855f7', '#ec4899'],
	['#22d3ee', '#34d399'],
	['#fbbf24', '#f97316'],
	['#a78bfa', '#22d3ee'],
	['#f43f5e', '#a855f7']
];

export function ringColors(seed: string): [string, string] {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return RING_PALETTES[Math.abs(hash) % RING_PALETTES.length] as [string, string];
}

export interface RLEMask {
	size: [number, number];
	counts: number[] | string;
}

export function decodeRLE(rle: RLEMask, width: number, height: number): Uint8Array {
	const total = width * height;
	const out = new Uint8Array(total);
	const counts = typeof rle.counts === 'string' ? cocoUncompressRLE(rle.counts) : rle.counts;
	let idx = 0;
	let val = 0;
	for (const c of counts) {
		for (let i = 0; i < c && idx < total; i++) {
			out[idx++] = val;
		}
		val ^= 1;
	}
	return out;
}

function cocoUncompressRLE(s: string): number[] {
	const counts: number[] = [];
	let p = 0;
	while (p < s.length) {
		let x = 0;
		let k = 0;
		let more = 1;
		while (more) {
			const c = s.charCodeAt(p) - 48;
			x |= (c & 0x1f) << (5 * k);
			more = c & 0x20;
			p++;
			k++;
			if (!more && c & 0x10) x |= -1 << (5 * k);
		}
		if (counts.length > 2) x += counts[counts.length - 2]!;
		counts.push(x);
	}
	return counts;
}

export function rleToCanvas(
	rle: RLEMask | string,
	color: string,
	alpha = 0.5
): HTMLCanvasElement | null {
	if (!rle) return null;
	let mask: RLEMask;
	if (typeof rle === 'string') {
		mask = { size: [0, 0], counts: rle };
	} else {
		mask = rle;
	}
	const [h, w] = mask.size;
	if (!w || !h) return null;
	const decoded = decodeRLE(mask, w, h);
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	const img = ctx.createImageData(w, h);
	const [r, g, b] = hexToRgb(color);
	const a = Math.round(alpha * 255);
	for (let row = 0; row < h; row++) {
		for (let col = 0; col < w; col++) {
			const srcIdx = col * h + row;
			const dstIdx = (row * w + col) * 4;
			if (decoded[srcIdx]) {
				img.data[dstIdx] = r;
				img.data[dstIdx + 1] = g;
				img.data[dstIdx + 2] = b;
				img.data[dstIdx + 3] = a;
			}
		}
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

export function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	const n = parseInt(
		h.length === 3
			? h
					.split('')
					.map((c) => c + c)
					.join('')
			: h,
		16
	);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Decode a pycocotools compressed-RLE mask string into a row-major `Uint8Array`
 * of 0/1 (length h*w). This is the exact `rleFrString` + `rleDecode` algorithm:
 * the string holds delta-coded run lengths (LEB128-ish, 5 bits/char, bit 0x20 =
 * continue, bit 0x10 on the final char = negative), and the runs alternate 0/1
 * (starting with 0) in COLUMN-MAJOR order over an h×w grid.
 *
 * The AI service returns segmentation masks in this format ({counts, size:[h,w]});
 * we decode them to paint pixel-level overlays instead of bounding rectangles.
 */
export function decodeCocoRle(counts: string, h: number, w: number): Uint8Array {
	const out = new Uint8Array(h * w);
	if (!counts || !(h > 0) || !(w > 0)) return out;
	// 1) decode the string into delta-coded, then absolute, run lengths.
	const runs: number[] = [];
	let p = 0;
	let m = 0;
	while (p < counts.length) {
		let x = 0;
		let k = 0;
		let more = 1;
		while (more) {
			const c = counts.charCodeAt(p) - 48;
			x |= (c & 0x1f) << (5 * k);
			more = c & 0x20;
			p++;
			k++;
			if (!more && c & 0x10) x |= -1 << (5 * k);
		}
		if (m > 2) x += runs[m - 2]!;
		runs.push(x);
		m++;
	}
	// 2) expand the runs (column-major, alternating 0/1 starting with 0) into a
	//    row-major occupancy grid.
	let lin = 0;
	let val = 0;
	const total = h * w;
	for (let ri = 0; ri < runs.length; ri++) {
		const run = runs[ri]!;
		if (val && run > 0) {
			const end = Math.min(lin + run, total);
			for (let i = lin; i < end; i++) {
				const col = (i / h) | 0;
				const row = i - col * h;
				out[row * w + col] = 1;
			}
		}
		lin += run;
		val ^= 1;
	}
	return out;
}

/** Ensure a base64 string has the proper data-URI metadata prefix. */
export function addBase64Metadata(base64: string, mimeType = 'image/png'): string {
	if (base64.startsWith('data:')) return base64;
	return `data:${mimeType};base64,${base64}`;
}

/**
 * Crop the find_xray-detected region out of a captured data URL (falls back to a
 * centre crop when no box was found). Uses OffscreenCanvas + createImageBitmap so
 * it works in BOTH DOM contexts and extension service workers. (Ported from the
 * old core during the Phase B extraction; the extension is its only consumer.)
 */
export async function extractXRayRegion(
	base64: string,
	result: { x1: number; y1: number; x2: number; y2: number } | null,
	extra: { width: number; height: number }
): Promise<string> {
	const crop = result
		? { x: result.x1, y: result.y1, w: result.x2 - result.x1, h: result.y2 - result.y1 }
		: { x: extra.width * 0.1, y: extra.height * 0.1, w: extra.width * 0.8, h: extra.height * 0.8 };

	const res = await fetch(base64);
	const blob = await res.blob();
	const bitmap = await createImageBitmap(blob, crop.x, crop.y, crop.w, crop.h);

	const canvas = new OffscreenCanvas(crop.w, crop.h);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to get OffscreenCanvas 2d context');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();

	const outBlob = await canvas.convertToBlob({ type: 'image/png' });
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error('Failed to read cropped image'));
		reader.readAsDataURL(outBlob);
	});
}
