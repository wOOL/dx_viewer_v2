import type { XrayBoundingBox, XrayExtra } from '../types/index.js';

/**
 * Extract a single frame from a video MediaStream as a base64 PNG.
 */
export function extractFrame(videoElement: HTMLVideoElement): string {
	const canvas = document.createElement('canvas');
	canvas.width = videoElement.videoWidth;
	canvas.height = videoElement.videoHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to get canvas 2d context');
	ctx.drawImage(videoElement, 0, 0);
	return canvas.toDataURL('image/png');
}

/**
 * Extract the X-ray region from an image using the find_xray response.
 * If result is non-null, crops to the bounding box. Otherwise falls back to a center crop (80%).
 */
export async function extractXRayRegion(base64: string, result: XrayBoundingBox | null, extra: XrayExtra): Promise<string> {
	let crop: { x: number; y: number; w: number; h: number };

	if (result) {
		crop = {
			x: result.x1,
			y: result.y1,
			w: result.x2 - result.x1,
			h: result.y2 - result.y1
		};
	} else {
		crop = {
			x: extra.width * 0.1,
			y: extra.height * 0.1,
			w: extra.width * 0.8,
			h: extra.height * 0.8
		};
	}

	// Use OffscreenCanvas + createImageBitmap so this works in both
	// DOM contexts (web app) and service workers (extension background).
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

/**
 * Ensure a base64 string has the proper data URI metadata prefix.
 */
export function addBase64Metadata(base64: string, mimeType = 'image/png'): string {
	if (base64.startsWith('data:')) return base64;
	return `data:${mimeType};base64,${base64}`;
}

/**
 * Strip the data URI prefix (e.g. "data:image/jpeg;base64,") from a base64 string.
 * Returns the raw base64 data. If no prefix is present, returns the string as-is.
 */
export function stripBase64Prefix(dataUrl: string): string {
	const commaIndex = dataUrl.indexOf(',');
	if (commaIndex !== -1 && dataUrl.startsWith('data:')) {
		return dataUrl.slice(commaIndex + 1);
	}
	return dataUrl;
}
