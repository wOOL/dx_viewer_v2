import { describe, it, expect } from 'vitest';
import {
	boundsOf,
	rectFromDrag,
	isMeaningfulBox,
	pointInBox,
	boxArea,
	handlePoints,
	handleAt,
	withinHoverKeepMargin,
	clampPickerPos,
	applyHandleResize,
	normalizeBox,
	hideAi,
	unhideAi,
	clearHidden,
	resizeAi,
	addDetection,
	removeAdded,
	resizeAdded
} from './detectEdit';
import type { UserEdits, BBox } from './types';

describe('geometry helpers', () => {
	it('boundsOf returns the bbox of a point list', () => {
		expect(
			boundsOf([
				[5, 8],
				[1, 20],
				[12, 3]
			])
		).toEqual([1, 3, 12, 20]);
	});

	it('rectFromDrag normalises corner order', () => {
		expect(rectFromDrag(10, 10, 2, 4)).toEqual([2, 4, 10, 10]);
	});

	it('isMeaningfulBox rejects a tiny accidental click', () => {
		expect(isMeaningfulBox([0, 0, 2, 2])).toBe(false);
		expect(isMeaningfulBox([0, 0, 20, 20])).toBe(true);
	});

	it('pointInBox + boxArea', () => {
		expect(pointInBox(5, 5, [0, 0, 10, 10])).toBe(true);
		expect(pointInBox(15, 5, [0, 0, 10, 10])).toBe(false);
		expect(boxArea([0, 0, 10, 4])).toBe(40);
	});

	it('handlePoints gives 8 anchors with corners at the box corners', () => {
		const hs = handlePoints([0, 0, 10, 20]);
		expect(hs).toHaveLength(8);
		expect(hs[0]).toEqual([0, 0]); // nw
		expect(hs[4]).toEqual([10, 20]); // se
	});

	it('handleAt finds the nearest handle within radius, else -1', () => {
		const box: BBox = [0, 0, 10, 10];
		expect(handleAt(box, 0, 0, 2)).toBe(0); // nw corner
		expect(handleAt(box, 10, 5, 2)).toBe(3); // e mid
		expect(handleAt(box, 5, 5, 2)).toBe(-1); // centre — no handle
	});

	it('applyHandleResize moves the right edges for each handle', () => {
		const box: BBox = [0, 0, 10, 10];
		// dragging the SE handle (4) to (20,30) extends x2,y2.
		expect(normalizeBox(applyHandleResize(box, 4, 20, 30))).toEqual([0, 0, 20, 30]);
		// dragging the NW handle (0) to (-5,-5) extends x1,y1.
		expect(normalizeBox(applyHandleResize(box, 0, -5, -5))).toEqual([-5, -5, 10, 10]);
		// dragging the E handle (3) only moves x2.
		expect(normalizeBox(applyHandleResize(box, 3, 25, 999))).toEqual([0, 0, 25, 10]);
	});

	it('normalizeBox fixes a crossed-over resize', () => {
		expect(normalizeBox([10, 10, 2, 3])).toEqual([2, 3, 10, 10]);
	});

	// Regression for the detection-editor hover bugs: the hit-test cleared the hover the
	// instant the cursor left the box interior, so (1) resize handles straddling the edges
	// were un-grabbable and (2) the toolbar floating above was unreachable. The keep-margin
	// must hold the hover within `side` px around the box AND `top` px above it.
	it('withinHoverKeepMargin keeps the hover across the affordance margin', () => {
		const box: BBox = [100, 100, 200, 160];
		const side = 12;
		const top = 40;
		// Inside the box → kept.
		expect(withinHoverKeepMargin(box, 150, 130, side, top)).toBe(true);
		// Just OUTSIDE an edge but within the handle-grab side margin → kept (fixes resize:
		// the cursor must leave the box to reach an edge/corner handle).
		expect(withinHoverKeepMargin(box, 208, 130, side, top)).toBe(true); // 8px right of x2
		expect(withinHoverKeepMargin(box, 150, 168, side, top)).toBe(true); // 8px below y2
		expect(withinHoverKeepMargin(box, 92, 130, side, top)).toBe(true); // 8px left of x1
		// In the taller strip ABOVE the box where the toolbar floats → kept (fixes the
		// vanishing hide/remove button as the cursor moves up to it).
		expect(withinHoverKeepMargin(box, 150, 70, side, top)).toBe(true); // 30px above y1
		// Beyond the side margin / above the toolbar strip → released.
		expect(withinHoverKeepMargin(box, 220, 130, side, top)).toBe(false); // 20px right
		expect(withinHoverKeepMargin(box, 150, 50, side, top)).toBe(false); // 50px above
		expect(withinHoverKeepMargin(box, 150, 180, side, top)).toBe(false); // 20px below
		// Asymmetry: the upward reach is larger than the side margin (toolbar lives above).
		expect(withinHoverKeepMargin(box, 150, 65, side, top)).toBe(true); // 35px above → kept
		expect(withinHoverKeepMargin(box, 235, 130, side, top)).toBe(false); // 35px right → released
	});

	// Regression for the disease-picker reachability bug: the canvas is overflow-hidden,
	// so an unclamped picker anchored below a box drawn near the bottom/edge gets clipped
	// off-screen and the detection can't be classified. clampPickerPos must keep the whole
	// panel inside the container (flipping above when the bottom would overflow).
	describe('clampPickerPos keeps the disease picker fully on-screen', () => {
		const cW = 800;
		const cH = 600;
		const pW = 192;
		const pH = 290;
		const pad = 6;
		const within = (p: { x: number; y: number }) =>
			p.x >= pad && p.x + pW <= cW - pad && p.y >= pad && p.y + pH <= cH - pad;

		it('opens below + centred for a box with room beneath it', () => {
			const p = clampPickerPos([300, 100, 400, 200], 1, 0, 0, cW, cH, pW, pH, pad);
			expect(p.x).toBe(350 - pW / 2); // centred on the box
			expect(p.y).toBe(200 + pad); // just below the box
			expect(within(p)).toBe(true);
		});

		it('FLIPS above the box when opening below would overflow the bottom', () => {
			const p = clampPickerPos([300, 480, 400, 540], 1, 0, 0, cW, cH, pW, pH, pad);
			expect(p.y).toBeLessThan(480); // above the box top, not below it
			expect(within(p)).toBe(true);
		});

		it('clamps horizontally so a box at the right/left edge is not clipped', () => {
			const right = clampPickerPos([760, 100, 800, 200], 1, 0, 0, cW, cH, pW, pH, pad);
			expect(right.x + pW).toBeLessThanOrEqual(cW - pad);
			expect(within(right)).toBe(true);
			const left = clampPickerPos([0, 100, 30, 200], 1, 0, 0, cW, cH, pW, pH, pad);
			expect(left.x).toBeGreaterThanOrEqual(pad);
			expect(within(left)).toBe(true);
		});

		it('respects the zoom/pan transform (scale + translate) when anchoring', () => {
			// box bottom 100 at scale 2, ty 50 → screen bottom 250 → picker below at 256.
			const p = clampPickerPos([10, 20, 50, 100], 2, 0, 50, cW, cH, pW, pH, pad);
			expect(p.y).toBe(100 * 2 + 50 + pad);
			expect(within(p)).toBe(true);
		});
	});
});

describe('UserEdits transitions are pure + correct', () => {
	const base: UserEdits = { hidden: [], added: [], resized: {} };

	it('hideAi / unhideAi (idempotent, recoverable)', () => {
		const h = hideAi(base, 3);
		expect(h.hidden).toEqual([3]);
		expect(hideAi(h, 3).hidden).toEqual([3]); // idempotent
		expect(unhideAi(h, 3).hidden).toEqual([]); // recoverable
		expect(base.hidden).toEqual([]); // original untouched (pure)
	});

	it('clearHidden restores all hidden detections but keeps added/resized', () => {
		const e: UserEdits = {
			hidden: [0, 2, 5],
			added: [{ id: 'a', label: 9, box: [1, 1, 9, 9], kind: 'rect' }],
			resized: { 3: [0, 0, 4, 4] }
		};
		const out = clearHidden(e);
		expect(out.hidden).toEqual([]);
		expect(out.added).toHaveLength(1); // untouched
		expect(out.resized[3]).toEqual([0, 0, 4, 4]); // untouched
		expect(e.hidden).toEqual([0, 2, 5]); // input not mutated (pure)
	});

	it('resizeAi records a normalised box', () => {
		const r = resizeAi(base, 1, [10, 10, 2, 2]);
		expect(r.resized[1]).toEqual([2, 2, 10, 10]);
	});

	it('addDetection appends with a normalised box; removeAdded drops by id', () => {
		const a = addDetection(base, { id: 'x', label: 5, box: [9, 9, 1, 1], kind: 'rect' });
		expect(a.added).toHaveLength(1);
		expect(a.added[0]!.box).toEqual([1, 1, 9, 9]);
		expect(removeAdded(a, 'x').added).toEqual([]);
	});

	it('resizeAdded updates the matching added detection only', () => {
		let e = addDetection(base, { id: 'a', label: 5, box: [0, 0, 5, 5], kind: 'rect' });
		e = addDetection(e, { id: 'b', label: 9, box: [0, 0, 5, 5], kind: 'rect' });
		const out = resizeAdded(e, 'b', [10, 10, 20, 20]);
		expect(out.added.find((x) => x.id === 'b')!.box).toEqual([10, 10, 20, 20]);
		expect(out.added.find((x) => x.id === 'a')!.box).toEqual([0, 0, 5, 5]);
	});

	it('never mutates the input edits object', () => {
		const snapshot = JSON.stringify(base);
		hideAi(base, 1);
		resizeAi(base, 1, [0, 0, 1, 1]);
		addDetection(base, { id: 'z', label: 1, box: [0, 0, 9, 9], kind: 'rect' });
		expect(JSON.stringify(base)).toBe(snapshot);
	});
});
