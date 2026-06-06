<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import {
		DISEASE_CLASSES,
		SEG_CLASSES,
		toothLabel,
		diseaseById,
		PEARL_FINDING_TAXONOMY
	} from '$lib/constants';
	import { diseaseShortLabel, detectionTagText } from '$lib/diseaseLabel';
	import type { InferenceResponse, UserEdits, BBox, AddedDetection } from '$lib/types';
	import { normalizeUserEdits, effectiveDetections } from '$lib/detections';
	import {
		rectFromDrag,
		boundsOf,
		isMeaningfulBox,
		pointInBox,
		boxArea,
		handleAt,
		handlePoints,
		applyHandleResize,
		normalizeBox,
		hideAi,
		addDetection,
		removeAdded,
		resizeAi,
		resizeAdded,
		withinHoverKeepMargin,
		clampPickerPos
	} from '$lib/detectEdit';
	import { hexToRgb, decodeCocoRle } from '$lib/image';
	import { screenToImage } from '$lib/transform';
	import type { RleMask } from '$lib/types';

	interface LayerToggles {
		bboxes: boolean;
		toothNumbers: boolean;
		anatomy: boolean;
		diseaseSeg: boolean;
		measurements: boolean;
		visibleClasses: Set<number>;
	}

	interface Props {
		imageUrl: string;
		/** The EFFECTIVE inference (AI composited with the user's edits) — what the overlay
		 *  draws, so hidden boxes vanish + added/resized ones show. */
		inference: InferenceResponse | null;
		/** The RAW AI inference (pre-edit) — the editor needs it to map a clicked box back
		 *  to its AI index for hide/resize. Optional: omit to disable editing. */
		rawInference?: InferenceResponse | null;
		/** The current per-study edits (hide/add/resize). */
		edits?: UserEdits | null;
		layers: LayerToggles;
		fdi?: boolean;
		confThreshold?: number;
		toolMode?: 'pan' | 'magnify';
		/** The current clinician's initials — shown on a user-ADDED detection's tag in place
		 *  of a (fabricated) confidence %. See $lib/initials + detectionTagText. */
		userInitials?: string;
		// Stable per-study identity (the study id). Per-study view state (orientation,
		// adjustments, editor) clears when THIS changes — not when imageUrl alone changes
		// (file-token re-bakes re-issue the URL for the same study, which must NOT reset it).
		studyKey?: string;
		/** Persist a new edits object (the canvas calls this after a hide/add/resize).
		 *  Omit to make the canvas read-only (no editor). */
		onEditsChange?: (edits: UserEdits) => void;
	}

	let {
		imageUrl,
		inference,
		rawInference = null,
		edits = null,
		layers,
		fdi = false,
		confThreshold = 0,
		toolMode = $bindable('pan'),
		userInitials = '',
		studyKey,
		onEditsChange
	}: Props = $props();

	// Image manipulation state
	let rotation = $state(0);
	let brightness = $state(1);
	let contrast = $state(1);
	let saturate = $state(1);
	let sharpness = $state(0);
	let invert = $state(false);
	let flipH = $state(false);
	let flipV = $state(false);

	let containerEl = $state<HTMLDivElement | null>(null);
	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let overlayEl = $state<HTMLCanvasElement | null>(null);
	let img = $state<HTMLImageElement | null>(null);
	let imgNatural = $state<{ w: number; h: number } | null>(null);
	let imgLoadError = $state(false); // the bitmap failed to load (404 / expired token / network)
	let retryNonce = $state(0); // bump to re-attempt a failed image load

	// Pan/zoom state
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let initialScale = $state(1);
	let isDragging = $state(false);
	let dragStart = { x: 0, y: 0, tx: 0, ty: 0 };

	// Magnifier state
	let magnifyPos = $state<{ x: number; y: number } | null>(null);

	// Findings highlight: a set of disease-detection indices to emphasise (the rest are
	// dimmed). null = no highlight (normal rendering). Set via setHighlight() when the
	// user hovers/selects a finding (or tooth) in the findings panel.
	let highlight = $state<Set<number> | null>(null);

	// ── Detection editor ──────────────────────────────────────────────────────
	// editMode 'off' = normal viewer. 'rect'/'free' = drawing a new detection (then the
	// disease picker opens). The editor reads `rawInference` + `edits` (props) and emits
	// a NEW edits object via onEditsChange. All geometry/transition logic is the pure
	// $lib/detectEdit helpers; this just wires pointer events + rendering to them.
	let editMode = $state<'off' | 'rect' | 'free'>('off');
	let drawStart: [number, number] | null = null; // rect drag start (image px)
	let drawNow: [number, number] | null = null; // rect drag current
	let freePoints = $state<[number, number][]>([]); // freeform outline in progress
	let drawing = $state(false);
	// A finished draw awaiting a disease choice: its box/points + screen anchor for the picker.
	let pendingAdd = $state<{ box: BBox; kind: 'rect' | 'free'; points?: [number, number][] } | null>(
		null
	);
	// Hover state over an existing detection (for the hide/resize affordances). `kind`
	// distinguishes a user-added freeform (drawn as an outline, NOT a box) so we don't
	// offer bbox-resize on it — dragging a handle would move the box while the drawn
	// outline stayed put. A freeform is hide/remove-only.
	let hoverDet = $state<{
		box: BBox;
		editable: boolean;
		ai?: number;
		addedId?: string;
		kind?: 'rect' | 'free';
	} | null>(null);
	// A detection is bbox-resizable only if it's editable AND not a freeform outline.
	function isResizable(d: { editable: boolean; kind?: 'rect' | 'free' } | null): boolean {
		return !!d && d.editable && d.kind !== 'free';
	}
	let resizing = $state<{ handle: number; ai?: number; addedId?: string; box: BBox } | null>(null);
	// True while the pointer is over the hover toolbar itself (it floats just OUTSIDE the
	// box). The hover hit-test reads this to avoid clearing `hoverDet` as the cursor moves
	// onto the hide/remove button — otherwise the button vanished the instant you reached it.
	let toolbarHovered = $state(false);
	const HANDLE_HIT = 8; // screen-px radius for grabbing a resize handle (÷scale → image px)
	// Screen-px margins for KEEPING a box hovered when the cursor steps just outside it, so
	// the affordances that live in that margin stay usable: HOVER_KEEP_PX covers the resize
	// handles straddling every edge (slightly > HANDLE_HIT so any grabbable handle keeps the
	// hover); TOOLBAR_REACH_PX is the taller strip ABOVE the box that the hover toolbar
	// floats in, so moving up to it doesn't clear the hover first. (÷scale → image px.)
	const HOVER_KEEP_PX = 12;
	const TOOLBAR_REACH_PX = 40;

	function curEdits(): UserEdits {
		return normalizeUserEdits(edits);
	}
	// A stable id for a newly-added detection. Crypto.randomUUID is available in the
	// browser; a counter fallback keeps it deterministic-enough if not.
	let editIdSeq = 0;
	function genEditId(): string {
		try {
			return crypto.randomUUID();
		} catch {
			return `u${++editIdSeq}`;
		}
	}
	// Screen-space anchor (container px) for the hover toolbar — top-left of the box.
	const hoverToolbarPos = $derived.by(() => {
		if (!hoverDet) return null;
		const [x1, y1] = hoverDet.box;
		return { x: x1 * scale + tx, y: Math.max(0, y1 * scale + ty - 26) };
	});
	// Disease-picker dimensions (must track the .edit-picker CSS: 12rem wide, and title +
	// the 13rem-max list + cancel ≈ 18rem tall). Used to keep the picker fully inside the
	// overflow-hidden canvas so a detection drawn near the bottom/edge is still classifiable.
	const PICKER_W = 192;
	const PICKER_H = 290;
	const pickerPos = $derived.by(() => {
		if (!pendingAdd || !containerEl) return null;
		return clampPickerPos(
			pendingAdd.box,
			scale,
			tx,
			ty,
			containerEl.clientWidth,
			containerEl.clientHeight,
			PICKER_W,
			PICKER_H
		);
	});

	let lastStudyKey: string | undefined; // non-reactive guard

	$effect(() => {
		// Each study opens fresh: when the STUDY changes (navigating between studies)
		// reset ALL per-image view state — orientation AND adjustments — so nothing leaks
		// onto the next study. Done here in the canvas (not the parent) because the
		// parent's canvasRef can be transiently null during SPA navigation, which silently
		// skipped the reset. NOT triggered by a same-study imageUrl re-bake (file-token
		// refresh) — that must preserve the user's current zoom/pan/orientation.
		const key = studyKey ?? imageUrl;
		if (key !== lastStudyKey) {
			lastStudyKey = key;
			rotation = 0;
			flipH = false;
			flipV = false;
			invert = false;
			brightness = 1;
			contrast = 1;
			saturate = 1;
			sharpness = 0;
			// Editor state is per-study too: a pending disease-pick, an in-progress draw, a
			// hover, or an active resize must NOT carry onto the next study. The critical
			// one is `pendingAdd` — confirming a lingering pick would persist a box drawn on
			// the PREVIOUS image onto THIS study's userEdits (cross-study contamination).
			editMode = 'off';
			drawStart = drawNow = null;
			freePoints = [];
			drawing = false;
			pendingAdd = null;
			hoverDet = null;
			resizing = null;
			toolbarHovered = false;
			if (img) redraw();
		}
	});

	let loadedKey: string | undefined; // non-reactive: which study's bitmap is loaded

	$effect(() => {
		// Load the bitmap for a study once. A file-token re-bake re-issues imageUrl
		// for the SAME study — but the bitmap is already in memory, so re-loading +
		// re-fitting would only flicker and snap the user's zoom/pan back to fit.
		// So skip when the study is unchanged and already loaded; reload (and refit)
		// only for a new study or a not-yet-loaded one (covers initial load + retry
		// if the first token URL failed).
		void imageUrl; // track URL so a retry fires if the URL changes before load
		void retryNonce; // manual Retry re-runs this effect
		const key = studyKey ?? imageUrl;
		if (key === loadedKey && img) return;
		// LOCAL-FIRST: imageUrl is resolved lazily (ensurePatientImages / freshFileUrl), so it's
		// '' on the initial mount. An empty src is NOT a load failure — setting img.src = ''
		// would fire onerror and flash the error panel. Treat it as "not ready": leave a neutral
		// blank state; the effect re-runs (it tracks imageUrl above) once the URL arrives.
		if (!imageUrl) {
			imgLoadError = false;
			return;
		}
		imgLoadError = false; // new load attempt
		const loadImg = new Image();
		loadImg.crossOrigin = 'anonymous';
		// Surface a load failure (404 / expired token / network) instead of leaving a
		// silent blank canvas. The stale-guard mirrors onload (ignore a superseded load).
		loadImg.onerror = () => {
			if ((studyKey ?? imageUrl) !== key) return;
			imgLoadError = true;
		};
		loadImg.onload = () => {
			// A study switch may have happened while this bitmap was loading. Ignore a
			// stale load whose study is no longer current — otherwise an out-of-order
			// completion (the previous study's slower load finishing after the new
			// one's) overwrites the current study's image, showing the WRONG X-ray
			// (and it persists, since the load effect won't re-run for an unchanged key).
			if ((studyKey ?? imageUrl) !== key) return;
			img = loadImg;
			imgNatural = { w: loadImg.naturalWidth, h: loadImg.naturalHeight };
			loadedKey = key;
			imgLoadError = false;
			fitImage();
			redraw();
		};
		loadImg.src = imageUrl;
	});

	$effect(() => {
		void layers;
		void inference;
		void fdi;
		void confThreshold;
		void $locale; // bbox labels are i18n'd via $lib/diseaseLabel
		if (img) redraw();
	});

	function fitImage() {
		if (!containerEl || !imgNatural) return;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		const ratio = Math.min(cw / imgNatural.w, ch / imgNatural.h) * 0.95;
		scale = ratio;
		initialScale = ratio;
		tx = (cw - imgNatural.w * ratio) / 2;
		ty = (ch - imgNatural.h * ratio) / 2;
	}

	function applyTransform(ctx: CanvasRenderingContext2D) {
		if (!imgNatural) return;
		ctx.translate(tx, ty);
		ctx.scale(scale, scale);
		// Flip — translate to center, scale, translate back
		if (flipH || flipV) {
			ctx.translate(imgNatural.w / 2, imgNatural.h / 2);
			ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
			ctx.translate(-imgNatural.w / 2, -imgNatural.h / 2);
		}
		if (rotation !== 0) {
			ctx.translate(imgNatural.w / 2, imgNatural.h / 2);
			ctx.rotate((rotation * Math.PI) / 180);
			ctx.translate(-imgNatural.w / 2, -imgNatural.h / 2);
		}
	}

	// Draw an overlay label at image point (ax, ay) but cancel the flip/rotation
	// from applyTransform so the text stays screen-upright and unmirrored. The
	// uniform `scale` is preserved, so callers keep sizing fonts in `/scale` units.
	// Must be called while the context already has applyTransform() applied.
	function withUprightAnchor(
		ctx: CanvasRenderingContext2D,
		ax: number,
		ay: number,
		draw: () => void
	) {
		ctx.save();
		ctx.translate(ax, ay);
		if (rotation !== 0) ctx.rotate((-rotation * Math.PI) / 180);
		if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
		draw();
		ctx.restore();
	}

	function redraw() {
		if (!canvasEl || !overlayEl || !containerEl || !img || !imgNatural) return;
		const dpr = window.devicePixelRatio || 1;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		[canvasEl, overlayEl].forEach((c) => {
			c.width = cw * dpr;
			c.height = ch * dpr;
			c.style.width = cw + 'px';
			c.style.height = ch + 'px';
		});

		const ctx = canvasEl.getContext('2d');
		const octx = overlayEl.getContext('2d');
		if (!ctx || !octx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		octx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cw, ch);
		octx.clearRect(0, 0, cw, ch);

		ctx.save();
		const filters: string[] = [];
		if (brightness !== 1) filters.push(`brightness(${brightness})`);
		if (contrast !== 1) filters.push(`contrast(${contrast})`);
		if (saturate !== 1) filters.push(`saturate(${saturate})`);
		if (sharpness > 0) filters.push(`url(#sharpen)`);
		if (invert) filters.push('invert(1)');
		ctx.filter = filters.length ? filters.join(' ') : 'none';
		applyTransform(ctx);
		ctx.drawImage(img, 0, 0);
		ctx.filter = 'none';
		ctx.restore();

		if (inference) drawOverlays(octx, cw, ch);
		if (toolMode === 'magnify' && magnifyPos) drawMagnifier(octx);
	}

	function drawOverlays(ctx: CanvasRenderingContext2D, _cw: number, _ch: number) {
		if (!imgNatural) return;
		ctx.save();
		applyTransform(ctx);

		if (inference) {
			if (layers.anatomy) drawAnatomy(ctx);
			if (layers.bboxes) drawDiseases(ctx);
			if (layers.toothNumbers) drawToothNumbers(ctx);
		}
		if (onEditsChange) drawEditor(ctx);

		ctx.restore();
	}

	// Editor visuals: the in-progress draw, the hovered detection's resize handles, and
	// a subtle outline around user-added boxes. (The hover toolbar + disease picker are
	// HTML, positioned over the canvas, not drawn here.)
	function drawEditor(ctx: CanvasRenderingContext2D) {
		const lw = Math.max(1.5, 1.6 / scale);
		// In-progress rectangle.
		if (drawing && editMode === 'rect' && drawStart && drawNow) {
			const b = rectFromDrag(drawStart[0], drawStart[1], drawNow[0], drawNow[1]);
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = lw;
			ctx.setLineDash([6 / scale, 4 / scale]);
			ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
			ctx.setLineDash([]);
		}
		// In-progress freeform outline.
		if (drawing && editMode === 'free' && freePoints.length > 1) {
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = lw;
			ctx.beginPath();
			ctx.moveTo(freePoints[0]![0], freePoints[0]![1]);
			for (const [x, y] of freePoints) ctx.lineTo(x, y);
			ctx.stroke();
		}
		// A pending (drawn, awaiting label) region — keep it visible under the picker.
		// Draw the freeform outline as-is; a rectangle as a box.
		if (pendingAdd) {
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = lw;
			if (pendingAdd.kind === 'free' && pendingAdd.points && pendingAdd.points.length > 1) {
				ctx.beginPath();
				ctx.moveTo(pendingAdd.points[0]![0], pendingAdd.points[0]![1]);
				for (const [x, y] of pendingAdd.points) ctx.lineTo(x, y);
				ctx.closePath();
				ctx.stroke();
			} else {
				const b = pendingAdd.box;
				ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
			}
		}
		// Hover: resize handles on the hovered detection — bbox-resizable ones only (a
		// freeform is drawn as an outline, so handles would mislead).
		if (hoverDet && isResizable(hoverDet) && editMode === 'off' && !resizing) {
			const hs = handlePoints(hoverDet.box);
			const r = Math.max(3, 4 / scale);
			ctx.fillStyle = '#38bdf8';
			for (const [x, y] of hs) {
				ctx.fillRect(x - r, y - r, r * 2, r * 2);
			}
		}
		// Active resize preview.
		if (resizing) {
			const b = normalizeBox(resizing.box);
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = lw;
			ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
		}
	}

	// Pixel-level segmentation masks (COCO-RLE from the AI) are decoded + tinted into an
	// offscreen canvas once per (study + visible-classes + threshold) combo, then drawn
	// (scaled to the image) each frame. Decoding ~megapixel masks on every pan/zoom redraw
	// would be far too slow, so we cache and only rebuild when those inputs change.
	let diseaseMaskCache: { key: string; canvas: HTMLCanvasElement | null } = {
		key: '',
		canvas: null
	};
	let anatomyMaskCache: { key: string; canvas: HTMLCanvasElement | null } = {
		key: '',
		canvas: null
	};

	/** Paint the RLE masks for which `show(i)` is true into one offscreen canvas, each
	 *  tinted with its class colour at `alpha`. Returns null if nothing was painted. */
	function buildMaskCanvas(
		masks: (RleMask | null)[] | undefined,
		show: (i: number) => boolean,
		colorHex: (i: number) => string,
		alpha: number
	): HTMLCanvasElement | null {
		if (!masks?.length) return null;
		const sized = masks.find((m) => m && Array.isArray(m.size) && m.size.length === 2);
		if (!sized?.size) return null;
		const [h, w] = sized.size;
		if (!(h > 0 && w > 0) || h * w > 64_000_000) return null; // sanity + perf guard
		const cnv = document.createElement('canvas');
		cnv.width = w;
		cnv.height = h;
		const cctx = cnv.getContext('2d');
		if (!cctx) return null;
		const img = cctx.createImageData(w, h);
		const data = img.data;
		const a = Math.max(0, Math.min(255, Math.round(255 * alpha)));
		let painted = false;
		for (let i = 0; i < masks.length; i++) {
			const m = masks[i];
			if (!m?.counts || !m.size || m.size[0] !== h || m.size[1] !== w) continue;
			if (!show(i)) continue;
			let bin: Uint8Array;
			try {
				bin = decodeCocoRle(m.counts, h, w);
			} catch {
				continue;
			}
			const [r, g, b] = hexToRgb(colorHex(i));
			for (let pi = 0; pi < bin.length; pi++) {
				if (bin[pi]) {
					const o = pi * 4;
					data[o] = r;
					data[o + 1] = g;
					data[o + 2] = b;
					data[o + 3] = a;
					painted = true;
				}
			}
		}
		if (!painted) return null;
		cctx.putImageData(img, 0, 0);
		return cnv;
	}

	function drawDiseases(ctx: CanvasRenderingContext2D) {
		if (!inference || !imgNatural) return;
		// Tolerate a partial/malformed inference (e.g. a truncated AI response) instead of
		// throwing — a missing disease_result.result would otherwise crash the whole viewer.
		const dz = inference.extra?.disease_result?.result;
		if (!dz?.labels || !dz.bboxes || !dz.scores) return;
		const show = (i: number) =>
			layers.visibleClasses.has(dz.labels[i]!) && (dz.scores[i] ?? 0) >= confThreshold;

		// The AI ships pixel-level COCO-RLE segmentation masks — paint those (tinted per
		// class) rather than bounding rectangles. Decoded+tinted once, cached, then drawn
		// scaled to the image's natural size so it lines up with the (image-pixel-space) boxes.
		if (dz.masks?.length) {
			const key = `${studyKey ?? imageUrl}|d|${[...layers.visibleClasses]
				.sort((a, b) => a - b)
				.join(',')}|${confThreshold}`;
			if (diseaseMaskCache.key !== key) {
				diseaseMaskCache = {
					key,
					canvas: buildMaskCanvas(dz.masks, show, (i) => diseaseById(dz.labels[i]!).color, 0.45)
				};
			}
			if (diseaseMaskCache.canvas)
				ctx.drawImage(diseaseMaskCache.canvas, 0, 0, imgNatural.w, imgNatural.h);
		}

		const lineWidth = Math.max(1.2, 1.2 / scale);
		ctx.font = `${Math.max(10, 11 / scale)}px Inter, sans-serif`;
		for (let i = 0; i < dz.labels.length; i++) {
			const label = dz.labels[i]!;
			if (!show(i)) continue;
			const bb = dz.bboxes[i]!;
			const cls = diseaseById(label);
			const color = cls.color;
			const [x1, y1, x2, y2] = bb;

			// "By tooth" highlight: when a tooth is selected, its detections render at full
			// strength with a thicker outline; everything else dims so the selection pops.
			const isHi = highlight ? highlight.has(i) : true;
			ctx.globalAlpha = highlight && !isHi ? 0.25 : 1;
			ctx.lineWidth = isHi && highlight ? Math.max(2.2, 2.4 / scale) : lineWidth;

			// A user-drawn FREEFORM detection carries its actual outline — draw that
			// (closed polygon) so a circle/oval/curve renders as drawn, not as its box.
			const freeform = dz.freeforms?.[i];
			if (freeform && freeform.length >= 2) {
				const [r, g, b] = hexToRgb(color);
				ctx.beginPath();
				ctx.moveTo(freeform[0]![0], freeform[0]![1]);
				for (let k = 1; k < freeform.length; k++) ctx.lineTo(freeform[k]![0], freeform[k]![1]);
				ctx.closePath();
				ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
				ctx.fill();
				ctx.strokeStyle = color;
				ctx.stroke();
			} else if (!dz.masks?.[i]?.counts) {
				// Fall back to the bbox rectangle only when this detection has NO pixel mask
				// and is not a freeform (otherwise the rectangle is what the mask replaces).
				const [r, g, b] = hexToRgb(color);
				ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
				ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
				ctx.strokeStyle = color;
				ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
			}

			const score = dz.scores[i] ?? 0;
			// A clinician-added detection has no model confidence — show the author's INITIALS,
			// not a fabricated "100%" (the synthetic score:1 only exists to survive the filter).
			const text = detectionTagText(
				diseaseShortLabel(label, $_),
				score,
				dz.sources?.[i] === 'user',
				userInitials
			);
			const tm = ctx.measureText(text);
			const padding = Math.max(4, 4 / scale);
			const tagH = Math.max(14, 14 / scale);
			withUprightAnchor(ctx, x1, y1, () => {
				ctx.fillStyle = color;
				ctx.fillRect(0, -tagH - 2, tm.width + padding * 2, tagH);
				ctx.fillStyle = '#0a0a0a';
				ctx.textBaseline = 'middle';
				ctx.fillText(text, padding, -tagH / 2 - 2);
				ctx.textBaseline = 'alphabetic';
			});
		}
		ctx.globalAlpha = 1; // reset so the highlight dim doesn't leak into later layers
	}

	function drawToothNumbers(ctx: CanvasRenderingContext2D) {
		if (!inference) return;
		const tn = inference.extra?.number_result?.result;
		if (!tn?.labels || !tn.bboxes) return;
		ctx.font = `600 ${Math.max(11, 12 / scale)}px Inter, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		for (let i = 0; i < tn.labels.length; i++) {
			const bb = tn.bboxes[i]!;
			const num = toothLabel(tn.labels[i]!, fdi);
			const cx = (bb[0] + bb[2]) / 2;
			const cy = (bb[1] + bb[3]) / 2;
			const r = Math.max(11, 12 / scale);
			ctx.fillStyle = 'rgba(35, 35, 38, 0.85)';
			ctx.beginPath();
			ctx.arc(cx, cy, r, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
			ctx.lineWidth = Math.max(0.8, 0.8 / scale);
			ctx.stroke();
			withUprightAnchor(ctx, cx, cy, () => {
				ctx.fillStyle = '#ffffff';
				ctx.fillText(num, 0, 0);
			});
		}
		ctx.textAlign = 'start';
		ctx.textBaseline = 'alphabetic';
	}

	function drawAnatomy(ctx: CanvasRenderingContext2D) {
		if (!inference || !imgNatural) return;
		const an = inference.extra?.anatomy_result?.result;
		if (!an?.labels || !an.bboxes) return;
		const show = (i: number) => (SEG_CLASSES[an.labels[i]!]?.id ?? 6) !== 6;

		// Pixel-level anatomy masks (COCO-RLE), tinted per segmentation class — same
		// approach as the disease masks. Cached per study (anatomy has no per-class toggle).
		if (an.masks?.length) {
			const key = `${studyKey ?? imageUrl}|a`;
			if (anatomyMaskCache.key !== key) {
				anatomyMaskCache = {
					key,
					canvas: buildMaskCanvas(
						an.masks,
						show,
						(i) => (SEG_CLASSES[an.labels[i]!] ?? SEG_CLASSES[6]).color,
						0.4
					)
				};
			}
			if (anatomyMaskCache.canvas)
				ctx.drawImage(anatomyMaskCache.canvas, 0, 0, imgNatural.w, imgNatural.h);
		}

		// Fall back to a filled box for any anatomy region without a pixel mask.
		ctx.lineWidth = Math.max(1, 1 / scale);
		for (let i = 0; i < an.labels.length; i++) {
			const segCls = SEG_CLASSES[an.labels[i]!] ?? SEG_CLASSES[6];
			if (!segCls || segCls.id === 6) continue;
			if (an.masks?.[i]?.counts) continue; // already painted as a pixel mask
			const bb = an.bboxes[i]!;
			ctx.fillStyle = segCls.color + '20';
			const [x1, y1, x2, y2] = bb;
			ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
		}
	}

	function drawMagnifier(ctx: CanvasRenderingContext2D) {
		if (!magnifyPos || !img || !imgNatural) return;
		const { x, y } = magnifyPos;
		const r = 70;
		const zoom = 2.5;
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.clip();
		// Re-draw image with scaled-up filter
		ctx.translate(x, y);
		ctx.scale(zoom, zoom);
		ctx.translate(-x, -y);
		ctx.translate(tx, ty);
		ctx.scale(scale, scale);
		if (flipH || flipV) {
			ctx.translate(imgNatural.w / 2, imgNatural.h / 2);
			ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
			ctx.translate(-imgNatural.w / 2, -imgNatural.h / 2);
		}
		if (rotation !== 0) {
			ctx.translate(imgNatural.w / 2, imgNatural.h / 2);
			ctx.rotate((rotation * Math.PI) / 180);
			ctx.translate(-imgNatural.w / 2, -imgNatural.h / 2);
		}
		const filters: string[] = [];
		if (brightness !== 1) filters.push(`brightness(${brightness})`);
		if (contrast !== 1) filters.push(`contrast(${contrast})`);
		if (invert) filters.push('invert(1)');
		ctx.filter = filters.length ? filters.join(' ') : 'none';
		ctx.drawImage(img, 0, 0);
		ctx.restore();
		// Ring around magnifier
		ctx.save();
		ctx.beginPath();
		ctx.arc(x, y, r, 0, Math.PI * 2);
		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgba(255,255,255,0.7)';
		ctx.stroke();
		ctx.restore();
	}

	function clientToImage(clientX: number, clientY: number): [number, number] | null {
		if (!containerEl || !imgNatural) return null;
		const rect = containerEl.getBoundingClientRect();
		// Inverse of applyTransform (translate → scale → flip → rotate). Extracted to
		// $lib/transform.screenToImage so the ordering is unit-tested (flip+rotate
		// don't commute — a prior bug undid rotate before flip and mis-mapped clicks).
		return screenToImage(clientX - rect.left, clientY - rect.top, {
			scale,
			tx,
			ty,
			flipH,
			flipV,
			rotation,
			imgW: imgNatural.w,
			imgH: imgNatural.h
		});
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const delta = -e.deltaY * 0.001;
		const factor = Math.exp(delta);
		const newScale = Math.max(initialScale * 0.5, Math.min(initialScale * 10, scale * factor));
		if (!containerEl) return;
		const rect = containerEl.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const imgX = (mx - tx) / scale;
		const imgY = (my - ty) / scale;
		tx = mx - imgX * newScale;
		ty = my - imgY * newScale;
		scale = newScale;
		redraw();
	}

	function onMouseDown(e: MouseEvent) {
		if (e.button !== 0) return;
		// Editor: drawing a new rect/freeform region.
		if (editMode === 'rect' || editMode === 'free') {
			const p = clientToImage(e.clientX, e.clientY);
			if (!p) return;
			drawing = true;
			if (editMode === 'rect') {
				drawStart = p;
				drawNow = p;
			} else {
				freePoints = [p];
			}
			redraw();
			return;
		}
		// Editor: grab a resize handle of the hovered detection (bbox-resizable only — a
		// freeform outline isn't resized via its bounding box).
		if (onEditsChange && isResizable(hoverDet) && hoverDet) {
			const p = clientToImage(e.clientX, e.clientY);
			if (p) {
				const h = handleAt(hoverDet.box, p[0], p[1], HANDLE_HIT / scale);
				if (h >= 0) {
					resizing = { handle: h, ai: hoverDet.ai, addedId: hoverDet.addedId, box: hoverDet.box };
					redraw();
					return;
				}
			}
		}
		isDragging = true;
		dragStart = { x: e.clientX, y: e.clientY, tx, ty };
	}

	function onMouseMove(e: MouseEvent) {
		// Editor: extend the in-progress draw.
		if (drawing && editMode === 'rect') {
			const p = clientToImage(e.clientX, e.clientY);
			if (p) {
				drawNow = p;
				redraw();
			}
			return;
		}
		if (drawing && editMode === 'free') {
			const p = clientToImage(e.clientX, e.clientY);
			if (p) {
				freePoints = [...freePoints, p];
				redraw();
			}
			return;
		}
		// Editor: dragging a resize handle.
		if (resizing) {
			const p = clientToImage(e.clientX, e.clientY);
			if (p) {
				resizing.box = applyHandleResize(resizing.box, resizing.handle, p[0], p[1]);
				redraw();
			}
			return;
		}
		if (toolMode === 'magnify' && containerEl) {
			const rect = containerEl.getBoundingClientRect();
			magnifyPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			redraw();
			return;
		}
		// Editor: hover hit-test (smallest editable box under the cursor) so the hover
		// toolbar + resize handles can show. Only when not panning/drawing.
		if (onEditsChange && editMode === 'off' && !isDragging) {
			updateHover(e.clientX, e.clientY);
		}
		if (!isDragging) return;
		tx = dragStart.tx + (e.clientX - dragStart.x);
		ty = dragStart.ty + (e.clientY - dragStart.y);
		redraw();
	}

	// Find the detection under the cursor (smallest box wins so a small lesion inside a
	// big box is reachable). Sets hoverDet for the toolbar/handles, or null.
	function updateHover(clientX: number, clientY: number) {
		// While the pointer is on the hover toolbar (which sits outside the box), keep the
		// current hover — clearing it here is exactly what made the hide/remove button
		// disappear as the cursor approached it. Also require an active hoverDet so a stale
		// `toolbarHovered` (element removed on click without a mouseleave) can't freeze the
		// hover system.
		if (toolbarHovered && hoverDet) return;
		const p = clientToImage(clientX, clientY);
		if (!p || !rawInference) {
			if (hoverDet) {
				hoverDet = null;
				redraw();
			}
			return;
		}
		const dets = effectiveDetections(rawInference, curEdits(), confThreshold);
		let best: typeof hoverDet = null;
		let bestArea = Infinity;
		for (const d of dets) {
			if (!pointInBox(p[0], p[1], d.box)) continue;
			const a = boxArea(d.box);
			if (a < bestArea) {
				bestArea = a;
				best = {
					box: d.box,
					editable: d.editable,
					ai: d.aiIndex,
					addedId: d.addedId,
					kind: d.kind
				};
			}
		}
		// No box strictly under the cursor, but if it's still within the affordance margin
		// of the box we're already hovering, KEEP it: the resize handles straddle the edges
		// and the toolbar floats above, so both live just outside the box. Clearing here is
		// what made handles un-grabbable (the cursor leaves the box to reach the handle) and
		// the toolbar unreachable. Margins are screen-px ÷ the current zoom scale → image px.
		if (!best && hoverDet) {
			const keep = withinHoverKeepMargin(
				hoverDet.box,
				p[0],
				p[1],
				HOVER_KEEP_PX / scale,
				TOOLBAR_REACH_PX / scale
			);
			if (keep) return;
		}
		const changed = JSON.stringify(best) !== JSON.stringify(hoverDet);
		hoverDet = best;
		if (changed) redraw();
	}

	function onMouseUp() {
		// Editor: finish a rect/freeform draw → stage it for the disease picker.
		if (drawing && editMode === 'rect') {
			drawing = false;
			if (drawStart && drawNow) {
				const box = rectFromDrag(drawStart[0], drawStart[1], drawNow[0], drawNow[1]);
				if (isMeaningfulBox(box)) pendingAdd = { box, kind: 'rect' };
			}
			drawStart = drawNow = null;
			redraw();
			return;
		}
		if (drawing && editMode === 'free') {
			drawing = false;
			if (freePoints.length >= 3) {
				const box = boundsOf(freePoints);
				if (isMeaningfulBox(box)) pendingAdd = { box, kind: 'free', points: freePoints };
			}
			freePoints = [];
			redraw();
			return;
		}
		// Editor: commit a resize.
		if (resizing) {
			const box = normalizeBox(resizing.box);
			if (onEditsChange && isMeaningfulBox(box)) {
				if (resizing.ai != null) onEditsChange(resizeAi(curEdits(), resizing.ai, box));
				else if (resizing.addedId) onEditsChange(resizeAdded(curEdits(), resizing.addedId, box));
			}
			resizing = null;
			hoverDet = null;
			redraw();
			return;
		}
		isDragging = false;
	}

	function onMouseLeave() {
		if (toolMode === 'magnify') {
			magnifyPos = null;
			redraw();
		}
		// Don't clear the hover toolbar while the cursor is over IT (it sits outside the
		// box) — only when genuinely leaving the canvas and not mid-resize. `toolbarHovered`
		// guards the case where the toolbar overhangs the container edge, so moving onto the
		// button doesn't read as leaving the canvas.
		if (hoverDet && !resizing && !drawing && !toolbarHovered) {
			hoverDet = null;
			redraw();
		}
	}

	// ── Editor API (driven by the viewer's edit toolbar) ──────────────────────
	/** Enter/leave a draw mode ('rect'|'free'), or 'off' to stop editing. */
	export function setEditMode(m: 'off' | 'rect' | 'free') {
		editMode = m;
		drawStart = drawNow = null;
		freePoints = [];
		drawing = false;
		pendingAdd = null;
		hoverDet = null;
		toolbarHovered = false;
		redraw();
	}
	export function getEditMode() {
		return editMode;
	}
	/** Resolve a pending freshly-drawn region into a saved detection with the chosen
	 *  disease label (called by the viewer's picker). genId supplies the stable id. */
	export function confirmAdd(label: number, genId: string) {
		if (!pendingAdd || !onEditsChange) {
			pendingAdd = null;
			return;
		}
		const det: AddedDetection = {
			id: genId,
			label,
			box: pendingAdd.box,
			kind: pendingAdd.kind,
			...(pendingAdd.points ? { points: pendingAdd.points } : {})
		};
		onEditsChange(addDetection(curEdits(), det));
		pendingAdd = null;
		redraw();
	}
	export function cancelAdd() {
		pendingAdd = null;
		redraw();
	}
	/** The screen-space anchor (container px) for positioning the disease picker. */
	export function pendingAnchor(): { x: number; y: number } | null {
		if (!pendingAdd || !containerEl) return null;
		const [x1, y1] = pendingAdd.box;
		const sx = x1 * scale + tx;
		const sy = y1 * scale + ty;
		return { x: sx, y: sy };
	}

	// Hide / restore / remove a detection (called from the hover toolbar buttons).
	function hideHovered() {
		if (!hoverDet || !onEditsChange) return;
		if (hoverDet.ai != null) onEditsChange(hideAi(curEdits(), hoverDet.ai));
		else if (hoverDet.addedId) onEditsChange(removeAdded(curEdits(), hoverDet.addedId));
		hoverDet = null;
		// The toolbar element is removed with the hover, so its mouseleave may not fire —
		// reset the flag explicitly so the hover system isn't left frozen on `true`.
		toolbarHovered = false;
	}

	export function reset() {
		fitImage();
		redraw();
	}

	// Composite the base-image canvas + the overlay canvas (AI finding boxes, tooth
	// numbers) into one PNG data URL. The two are separate stacked <canvas>
	// elements, so a printout/export that grabs only the first canvas would omit
	// everything the clinician annotated — this captures the full WYSIWYG view.
	export function getCompositeDataUrl(): string | null {
		if (!canvasEl || !overlayEl) return null;
		const tmp = document.createElement('canvas');
		tmp.width = canvasEl.width;
		tmp.height = canvasEl.height;
		const c = tmp.getContext('2d');
		if (!c) return null;
		c.drawImage(canvasEl, 0, 0);
		c.drawImage(overlayEl, 0, 0);
		return tmp.toDataURL('image/png');
	}

	/** The base image WITHOUT the overlay layer (no boxes/numbers) — for the report PDF's
	 *  "Original X-Ray" thumbnail. Rendered at the natural image size (not the zoomed view)
	 *  so the thumbnail is the whole, upright radiograph regardless of the current pan/zoom. */
	export function getBaseImageDataUrl(): string | null {
		if (!img || !imgNatural) return null;
		const tmp = document.createElement('canvas');
		tmp.width = imgNatural.w;
		tmp.height = imgNatural.h;
		const c = tmp.getContext('2d');
		if (!c) return null;
		c.drawImage(img, 0, 0, imgNatural.w, imgNatural.h);
		return tmp.toDataURL('image/png');
	}

	export function zoom(factor: number) {
		if (!containerEl) return;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		const mx = cw / 2;
		const my = ch / 2;
		const newScale = Math.max(initialScale * 0.5, Math.min(initialScale * 10, scale * factor));
		const imgX = (mx - tx) / scale;
		const imgY = (my - ty) / scale;
		tx = mx - imgX * newScale;
		ty = my - imgY * newScale;
		scale = newScale;
		redraw();
	}

	export function actualSize() {
		if (!containerEl || !imgNatural) return;
		const cw = containerEl.clientWidth;
		const ch = containerEl.clientHeight;
		scale = 1;
		tx = (cw - imgNatural.w) / 2;
		ty = (ch - imgNatural.h) / 2;
		redraw();
	}

	export function rotateBy(deg: number) {
		rotation = (rotation + deg + 360) % 360;
		redraw();
	}

	export function toggleFlipH() {
		flipH = !flipH;
		redraw();
	}
	export function toggleFlipV() {
		flipV = !flipV;
		redraw();
	}

	export function setBrightness(b: number) {
		brightness = b;
		redraw();
	}

	export function setContrast(c: number) {
		contrast = c;
		redraw();
	}

	export function setSaturate(s: number) {
		saturate = s;
		redraw();
	}

	export function setSharpness(s: number) {
		sharpness = s;
		const fe = document.getElementById('sharpen-matrix') as SVGFEConvolveMatrixElement | null;
		if (fe) {
			// Sharpening kernel: identity + Laplacian * s
			const k = s;
			fe.setAttribute('kernelMatrix', `0 -${k} 0  -${k} ${1 + 4 * k} -${k}  0 -${k} 0`);
		}
		redraw();
	}

	export function toggleInvert() {
		invert = !invert;
		redraw();
	}

	export function resetAdjustments() {
		brightness = 1;
		contrast = 1;
		saturate = 1;
		sharpness = 0;
		invert = false;
		rotation = 0;
		flipH = false;
		flipV = false;
		redraw();
	}

	export function getState() {
		return { brightness, contrast, saturate, sharpness, invert, flipH, flipV, rotation };
	}

	/** Emphasise a set of disease-detection indices on the overlay (e.g. the findings of
	 *  one tooth), dimming the rest; pass null to clear. Drives the findings panel's
	 *  "by tooth" click-to-highlight. */
	export function setHighlight(indices: number[] | null) {
		highlight = indices && indices.length ? new Set(indices) : null;
		redraw();
	}

	let resizeObserver: ResizeObserver | null = null;
	onMount(() => {
		if (!containerEl) return;
		resizeObserver = new ResizeObserver(() => {
			fitImage();
			redraw();
		});
		resizeObserver.observe(containerEl);
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('mouseup', onMouseUp);
	});
	onDestroy(() => {
		resizeObserver?.disconnect();
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		}
	});

	void DISEASE_CLASSES;
	void hexToRgb;
</script>

<svg width="0" height="0" style="position:absolute;left:-1px;top:-1px;">
	<defs>
		<filter id="sharpen">
			<feConvolveMatrix
				id="sharpen-matrix"
				order="3"
				kernelMatrix="0 0 0  0 1 0  0 0 0"
				preserveAlpha="true"
			></feConvolveMatrix>
		</filter>
	</defs>
</svg>

<div
	bind:this={containerEl}
	class="relative h-full w-full overflow-hidden bg-black"
	class:cursor-magnify={toolMode === 'magnify'}
	class:cursor-crosshair={editMode !== 'off'}
	onwheel={onWheel}
	onmouseleave={onMouseLeave}
	role="img"
	aria-label={$_('viewer.canvasLabel')}
>
	<canvas
		bind:this={canvasEl}
		class="absolute inset-0 cursor-grab"
		class:dragging={isDragging}
		onmousedown={onMouseDown}
	></canvas>
	<canvas bind:this={overlayEl} class="pointer-events-none absolute inset-0"></canvas>

	<!-- Hover toolbar: a small "hide" affordance over a detection (editor only, not while
	     drawing/resizing). Resize is via the on-canvas handles. -->
	{#if onEditsChange && hoverDet && editMode === 'off' && !resizing && hoverToolbarPos}
		<!-- onmouseenter/leave keep the hover alive while the pointer is on the toolbar, even
		     when a wide button on a narrow box overhangs the geometric keep-margin. -->
		<div
			class="edit-hovertoolbar"
			style:left="{hoverToolbarPos.x}px"
			style:top="{hoverToolbarPos.y}px"
			onmouseenter={() => (toolbarHovered = true)}
			onmouseleave={() => (toolbarHovered = false)}
			role="presentation"
		>
			<button
				type="button"
				class="edit-hidebtn"
				data-testid="detect-hide"
				title={hoverDet.ai != null ? $_('detect.hide') : $_('detect.remove')}
				onclick={hideHovered}
			>
				{hoverDet.ai != null ? $_('detect.hide') : $_('detect.remove')}
			</button>
		</div>
	{/if}

	<!-- Disease picker: after drawing a region, choose the disease it represents. -->
	{#if pendingAdd && pickerPos}
		<div class="edit-picker" style:left="{pickerPos.x}px" style:top="{pickerPos.y}px">
			<div class="edit-picker-title">{$_('detect.pickDisease')}</div>
			<div class="edit-picker-list">
				{#each PEARL_FINDING_TAXONOMY as row (row.key)}
					<button
						type="button"
						class="edit-picker-item"
						data-testid="detect-pick-{row.key}"
						onclick={() => confirmAdd(row.ids[0] ?? 0, genEditId())}
					>
						<span class="dot" style:background={row.color}></span>
						{$_('taxonomy.' + row.key)}
					</button>
				{/each}
			</div>
			<button type="button" class="edit-picker-cancel" onclick={cancelAdd}
				>{$_('common.cancel')}</button
			>
		</div>
	{/if}
	{#if imgLoadError}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
			<div class="text-sm text-fg-1">{$_('viewer.imgLoadError')}</div>
			<div class="text-xs text-fg-3">{$_('viewer.imgLoadErrorDesc')}</div>
			<button
				type="button"
				class="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary-hover"
				onclick={() => retryNonce++}
			>
				{$_('common.retry')}
			</button>
		</div>
	{/if}
</div>

<style>
	canvas.dragging {
		cursor: grabbing !important;
	}
	.cursor-magnify canvas {
		cursor: zoom-in !important;
	}
	.cursor-crosshair canvas {
		cursor: crosshair !important;
	}
	.edit-hovertoolbar {
		position: absolute;
		z-index: 25;
		transform: translateX(-2px);
	}
	.edit-hidebtn {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-size: 0.68rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 0.35rem;
		cursor: pointer;
		box-shadow: var(--shadow-card);
	}
	.edit-hidebtn:hover {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.edit-picker {
		position: absolute;
		z-index: 30;
		/* `left` is the already-clamped top-left from clampPickerPos (PICKER_W = 12rem) — no
		   translateX centering, so the panel can be held fully inside the overflow-hidden canvas. */
		width: 12rem;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		box-shadow: var(--shadow-card);
		padding: 0.4rem;
	}
	.edit-picker-title {
		font-size: 0.66rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-fg-2);
		padding: 0.1rem 0.25rem 0.3rem;
	}
	.edit-picker-list {
		display: flex;
		flex-direction: column;
		max-height: 13rem;
		overflow-y: auto;
	}
	.edit-picker-item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		background: transparent;
		border: none;
		color: var(--color-fg-1);
		font-size: 0.74rem;
		text-align: left;
		padding: 0.3rem 0.35rem;
		border-radius: 0.3rem;
		cursor: pointer;
	}
	.edit-picker-item:hover {
		background: var(--color-bg-2);
	}
	.edit-picker-item .dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.edit-picker-cancel {
		width: 100%;
		margin-top: 0.3rem;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-2);
		font-size: 0.7rem;
		padding: 0.25rem;
		border-radius: 0.3rem;
		cursor: pointer;
	}
</style>
