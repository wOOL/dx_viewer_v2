// Pure helpers for the 2D detection EDITOR (add / hide / resize), kept out of the
// XrayCanvas component so the geometry + the UserEdits transitions are unit-testable
// without a canvas. The component wires pointer events to these.

import type { BBox, UserEdits, AddedDetection } from './types';

/** Axis-aligned bounding box of a list of [x,y] points (for a freeform region). */
export function boundsOf(points: [number, number][]): BBox {
	let x1 = Infinity;
	let y1 = Infinity;
	let x2 = -Infinity;
	let y2 = -Infinity;
	for (const [x, y] of points) {
		if (x < x1) x1 = x;
		if (y < y1) y1 = y;
		if (x > x2) x2 = x;
		if (y > y2) y2 = y;
	}
	return [x1, y1, x2, y2];
}

/** Normalise a drag (two opposite corners) into [x1,y1,x2,y2] with x1≤x2, y1≤y2. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): BBox {
	return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

/** Is a box big enough to be a real detection (not an accidental click)? In image px. */
export function isMeaningfulBox(box: BBox, min = 5): boolean {
	return box[2] - box[0] >= min && box[3] - box[1] >= min;
}

/** Does point (px,py) fall inside box [x1,y1,x2,y2]? */
export function pointInBox(px: number, py: number, box: BBox): boolean {
	return px >= box[0] && px <= box[2] && py >= box[1] && py <= box[3];
}

/** Area of a box (for "smallest box under the cursor wins" hit-testing). */
export function boxArea(box: BBox): number {
	return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

/** The eight resize-handle anchors of a box, as [x,y] in image space. Order:
 *  nw, n, ne, e, se, s, sw, w — index is the handle id used by applyHandleResize. */
export function handlePoints(box: BBox): [number, number][] {
	const [x1, y1, x2, y2] = box;
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	return [
		[x1, y1], // 0 nw
		[mx, y1], // 1 n
		[x2, y1], // 2 ne
		[x2, my], // 3 e
		[x2, y2], // 4 se
		[mx, y2], // 5 s
		[x1, y2], // 6 sw
		[x1, my] // 7 w
	];
}

/** Which resize handle (0-7) is within `r` image-px of (px,py), or -1 if none. */
export function handleAt(box: BBox, px: number, py: number, r: number): number {
	const hs = handlePoints(box);
	for (let i = 0; i < hs.length; i++) {
		if (Math.abs(hs[i]![0] - px) <= r && Math.abs(hs[i]![1] - py) <= r) return i;
	}
	return -1;
}

/**
 * Is (px,py) inside `box`, OR within the editor's affordance margin around it — `side`
 * px on the left/right/bottom (the resize-handle grab zone) and `top` px above (where the
 * hover toolbar floats)? The hover hit-test uses this to KEEP a box "hovered" while the
 * cursor steps just outside it: the resize handles straddle the edges and the hide/remove
 * toolbar floats above, so a strict inside-only test cleared the hover the instant the
 * cursor reached either — making handles un-grabbable and the toolbar unreachable. All
 * units are IMAGE px (the caller divides its screen-px margins by the zoom scale).
 */
export function withinHoverKeepMargin(
	box: BBox,
	px: number,
	py: number,
	side: number,
	top: number
): boolean {
	return px >= box[0] - side && px <= box[2] + side && py >= box[1] - top && py <= box[3] + side;
}

/**
 * Position a floating editor panel (the disease picker) so it stays FULLY inside the
 * canvas container — which is `overflow-hidden`, so an unclamped panel anchored below a
 * box drawn near the bottom/edge gets clipped off-screen and the clinician can't classify
 * the detection (apical lesions sit at the bottom of a periapical — a common case).
 *
 * Prefers opening BELOW the box (anchored at its bottom edge); FLIPS above if that would
 * overflow the bottom; clamps horizontally (centered on the box) so the whole panel stays
 * in view. `box` is in IMAGE px; `scale`/`tx`/`ty` map it to the container's screen space;
 * `panelW`/`panelH` and the result are container px. Returns the panel's top-left.
 */
export function clampPickerPos(
	box: BBox,
	scale: number,
	tx: number,
	ty: number,
	containerW: number,
	containerH: number,
	panelW: number,
	panelH: number,
	pad = 6
): { x: number; y: number } {
	const cx = ((box[0] + box[2]) / 2) * scale + tx;
	let x = cx - panelW / 2;
	x = Math.max(pad, Math.min(x, containerW - panelW - pad));
	const below = box[3] * scale + ty + pad;
	let y = below;
	if (below + panelH > containerH - pad) {
		y = box[1] * scale + ty - panelH - pad; // would overflow the bottom → flip above the box
	}
	y = Math.max(pad, Math.min(y, containerH - panelH - pad));
	return { x, y };
}

/** Apply dragging handle `h` to (px,py), returning the new (un-normalised) box. The
 *  caller normalises with rectFromDrag-style min/max afterwards via normalizeBox. */
export function applyHandleResize(box: BBox, h: number, px: number, py: number): BBox {
	let [x1, y1, x2, y2] = box;
	// columns: handles touching the left edge (0,6,7) move x1; right edge (2,3,4) move x2.
	if (h === 0 || h === 6 || h === 7) x1 = px;
	if (h === 2 || h === 3 || h === 4) x2 = px;
	// rows: top edge (0,1,2) move y1; bottom edge (4,5,6) move y2.
	if (h === 0 || h === 1 || h === 2) y1 = py;
	if (h === 4 || h === 5 || h === 6) y2 = py;
	return [x1, y1, x2, y2];
}

/** Normalise a possibly-inverted box so x1≤x2, y1≤y2 (a resize can cross over). */
export function normalizeBox(box: BBox): BBox {
	return [
		Math.min(box[0], box[2]),
		Math.min(box[1], box[3]),
		Math.max(box[0], box[2]),
		Math.max(box[1], box[3])
	];
}

// ── UserEdits transitions (pure: return a NEW edits object) ──────────────────

function clone(e: UserEdits): UserEdits {
	return {
		hidden: [...e.hidden],
		added: e.added.map((a) => ({ ...a })),
		resized: { ...e.resized }
	};
}

/** Hide an AI detection by index (idempotent). */
export function hideAi(edits: UserEdits, aiIndex: number): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	if (!e.hidden.includes(aiIndex)) e.hidden.push(aiIndex);
	return e;
}

/** Un-hide an AI detection (restore a disagreed box). */
export function unhideAi(edits: UserEdits, aiIndex: number): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	e.hidden = e.hidden.filter((i) => i !== aiIndex);
	return e;
}

/** Restore ALL hidden AI detections (clears the hide list; added/resized untouched). The
 *  recovery path for an accidentally-hidden finding — without it, hiding an AI detection
 *  is permanent from the UI (it's dropped from the render, so it can't be hovered to
 *  un-hide, and `hidden` persists across reload). */
export function clearHidden(edits: UserEdits): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	e.hidden = [];
	return e;
}

/** Resize an AI detection (records the adjusted box; bbox-only — caller enforces). */
export function resizeAi(edits: UserEdits, aiIndex: number, box: BBox): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	e.resized[aiIndex] = normalizeBox(box);
	return e;
}

/** Add a new detection. `id` is the caller-supplied stable id (no Date/random here). */
export function addDetection(edits: UserEdits, det: AddedDetection): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	e.added.push({ ...det, box: normalizeBox(det.box) });
	return e;
}

/** Remove a user-added detection by id. */
export function removeAdded(edits: UserEdits, id: string): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	e.added = e.added.filter((a) => a.id !== id);
	return e;
}

/** Resize a user-added detection. */
export function resizeAdded(edits: UserEdits, id: string, box: BBox): UserEdits {
	const e = clone(normalizeUserEditsLocal(edits));
	const a = e.added.find((x) => x.id === id);
	if (a) a.box = normalizeBox(box);
	return e;
}

// Local copy of the normaliser to avoid a circular import with detections.ts.
function normalizeUserEditsLocal(raw: UserEdits | null | undefined): UserEdits {
	if (!raw) return { hidden: [], added: [], resized: {} };
	return {
		hidden: Array.isArray(raw.hidden) ? raw.hidden : [],
		added: Array.isArray(raw.added) ? raw.added : [],
		resized: raw.resized && typeof raw.resized === 'object' ? raw.resized : {}
	};
}
