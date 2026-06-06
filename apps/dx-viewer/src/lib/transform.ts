// 2D X-ray view transform math, extracted from XrayCanvas so the inverse mapping
// is unit-testable. applyTransform() composes, in canvas order,
//   translate(tx,ty) → scale(s) → flip(about image centre) → rotate(about centre)
// so a drawn image point p maps to screen as  T·S·F·R·p. screenToImage() inverts
// that to turn a pointer position back into image-pixel coords (for the ruler /
// click-to-select). Flip and rotation DON'T commute — a prior bug undid rotation
// before flip and mis-mapped clicks whenever both were active; the round-trip test
// guards that ordering.

export interface ViewTransform {
	scale: number;
	tx: number;
	ty: number;
	flipH: boolean;
	flipV: boolean;
	rotation: number; // degrees
	imgW: number;
	imgH: number;
}

/** Container-relative screen point (cx,cy) → image-pixel coords. Inverse of
 *  applyTransform: undo translate, then scale, then flip, then rotation. */
export function screenToImage(cx: number, cy: number, t: ViewTransform): [number, number] {
	let ix = (cx - t.tx) / t.scale;
	let iy = (cy - t.ty) / t.scale;
	if (t.flipH) ix = t.imgW - ix;
	if (t.flipV) iy = t.imgH - iy;
	if (t.rotation !== 0) {
		const rad = (-t.rotation * Math.PI) / 180;
		const dx = ix - t.imgW / 2;
		const dy = iy - t.imgH / 2;
		ix = t.imgW / 2 + dx * Math.cos(rad) - dy * Math.sin(rad);
		iy = t.imgH / 2 + dx * Math.sin(rad) + dy * Math.cos(rad);
	}
	return [ix, iy];
}

/** Image-pixel point (ix,iy) → container-relative screen point. The forward
 *  transform (rotate about centre, then flip, then scale, then translate) — i.e.
 *  T·S·F·R applied to p. Exists so tests can assert screenToImage is its inverse. */
export function imageToScreen(ix: number, iy: number, t: ViewTransform): [number, number] {
	let x = ix;
	let y = iy;
	if (t.rotation !== 0) {
		const rad = (t.rotation * Math.PI) / 180;
		const dx = x - t.imgW / 2;
		const dy = y - t.imgH / 2;
		x = t.imgW / 2 + dx * Math.cos(rad) - dy * Math.sin(rad);
		y = t.imgH / 2 + dx * Math.sin(rad) + dy * Math.cos(rad);
	}
	if (t.flipH) x = t.imgW - x;
	if (t.flipV) y = t.imgH - y;
	return [x * t.scale + t.tx, y * t.scale + t.ty];
}
