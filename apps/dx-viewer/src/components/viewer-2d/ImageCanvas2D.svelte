<script lang="ts" module>
	export type BBox = [number, number, number, number];

	export interface ImageCanvas2DApi {
		/** Animate the viewport so `bbox` (in image-pixel coords) fills ~60% of the visible area. */
		zoomToBBox(bbox: BBox, opts?: { padding?: number; durationMs?: number }): void;
		/** Reset to fit-to-view, centred. */
		reset(durationMs?: number): void;
		/** Current natural image dimensions, or null until the image has loaded. */
		readonly imageNatural: { width: number; height: number } | null;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	export type ChromeContext = {
		scale: number;
		tx: number;
		ty: number;
		imageWidth: number;
		imageHeight: number;
	};

	type Props = {
		imageSrc: string | null;
		interactive?: boolean;
		imageFilter?: string;
		overlay?: Snippet<[{ imageWidth: number; imageHeight: number; scale: number }]>;
		chrome?: Snippet<[ChromeContext]>;
		api?: ImageCanvas2DApi | undefined;
	};
	let {
		imageSrc,
		interactive = true,
		imageFilter,
		overlay,
		chrome,
		api = $bindable()
	}: Props = $props();

	let viewportEl: HTMLDivElement | undefined = $state();
	let imgEl: HTMLImageElement | undefined = $state();

	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let natural = $state({ width: 0, height: 0 });
	let viewport = $state({ width: 0, height: 0 });

	// Drag/pinch tracking via Pointer Events — one path for mouse/touch/pen.
	const pointers = new Map<number, { x: number; y: number }>();
	let dragId: number | null = null;
	let dragLast = { x: 0, y: 0 };
	let dragMoved = false;
	let pinch: { startDist: number; startScale: number; startMid: { x: number; y: number }; startTx: number; startTy: number } | null = null;

	let animHandle: number | null = null;
	function cancelAnim() {
		if (animHandle !== null) cancelAnimationFrame(animHandle);
		animHandle = null;
	}

	const fitScale = $derived(
		natural.width && viewport.width
			? Math.min(viewport.width / natural.width, viewport.height / natural.height)
			: 1
	);
	// Initial framing inset — the loaded image takes 80% of the viewport so it
	// reads as "almost filling" with a comfortable margin on every side, rather
	// than touching the canvas edges. Used by fitToView()/reset(); minScale and
	// maxScale still derive from pure fitScale so the zoom range is unchanged.
	const FIT_INSET = 0.8;
	const minScale = $derived(Math.max(0.05, fitScale * 0.5));
	const maxScale = $derived(Math.max(fitScale * 20, 20));
	const pixelated = $derived(scale > fitScale * 4);

	function clampScale(s: number) {
		return Math.max(minScale, Math.min(maxScale, s));
	}

	/**
	 * Pan bounds: image can poke past the viewport edge by up to `slack` pixels
	 * (rubber feel) but can never be entirely off-screen.
	 *   iw ≥ vw → image must cover the viewport (with slack on each side).
	 *   iw < vw → image must stay inside the viewport (with slack).
	 */
	function bounds1D(vw: number, iw: number): [number, number] {
		const slack = Math.min(vw, iw) * 0.25;
		if (iw >= vw) return [vw - iw - slack, slack];
		return [-slack, vw - iw + slack];
	}

	function clampPan(s: number, x: number, y: number) {
		const [xMin, xMax] = bounds1D(viewport.width, natural.width * s);
		const [yMin, yMax] = bounds1D(viewport.height, natural.height * s);
		return {
			x: Math.max(xMin, Math.min(xMax, x)),
			y: Math.max(yMin, Math.min(yMax, y))
		};
	}

	function setView(nextScale: number, nextTx: number, nextTy: number) {
		const s = clampScale(nextScale);
		const p = clampPan(s, nextTx, nextTy);
		scale = s;
		tx = p.x;
		ty = p.y;
	}

	function fitToView() {
		if (!natural.width || !viewport.width) return;
		const s = fitScale * FIT_INSET;
		const cx = (viewport.width - natural.width * s) / 2;
		const cy = (viewport.height - natural.height * s) / 2;
		setView(s, cx, cy);
	}

	function animateTo(target: { s: number; tx: number; ty: number }, durationMs: number) {
		cancelAnim();
		const from = { s: scale, tx, ty };
		const start = performance.now();
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / durationMs);
			const k = 1 - Math.pow(1 - t, 3); // cubicOut
			setView(
				from.s + (target.s - from.s) * k,
				from.tx + (target.tx - from.tx) * k,
				from.ty + (target.ty - from.ty) * k
			);
			animHandle = t < 1 ? requestAnimationFrame(tick) : null;
		};
		animHandle = requestAnimationFrame(tick);
	}

	function zoomAt(cx: number, cy: number, factor: number) {
		const nextScale = clampScale(scale * factor);
		const effective = nextScale / scale;
		// Keep the image point under (cx, cy) anchored.
		const nextTx = cx - (cx - tx) * effective;
		const nextTy = cy - (cy - ty) * effective;
		setView(nextScale, nextTx, nextTy);
	}

	function onImgLoad() {
		if (!imgEl) return;
		natural = { width: imgEl.naturalWidth, height: imgEl.naturalHeight };
		fitToView();
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────────

	$effect(() => {
		if (!viewportEl) return;
		const ro = new ResizeObserver((entries) => {
			const r = entries[0]?.contentRect;
			if (!r) return;
			const prev = viewport;
			viewport = { width: r.width, height: r.height };
			// On first sizing, fit. On subsequent resizes, clamp current pan.
			if (!prev.width && natural.width) fitToView();
			else if (natural.width) setView(scale, tx, ty);
		});
		ro.observe(viewportEl);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!viewportEl) return;
		const el = viewportEl;
		const onWheel = (e: WheelEvent) => {
			if (!interactive || !natural.width) return;
			e.preventDefault();
			cancelAnim();
			const rect = el.getBoundingClientRect();
			// Browser-faked ctrlKey signals a trackpad pinch; metaKey lets mouse-wheel
			// users hold Cmd to zoom. Everything else (two-finger trackpad swipe, plain
			// wheel) pans — matches Figma / Google Maps conventions.
			if (e.ctrlKey || e.metaKey) {
				const cx = e.clientX - rect.left;
				const cy = e.clientY - rect.top;
				const intensity = e.ctrlKey && !e.metaKey ? 1.02 : 1.0015;
				zoomAt(cx, cy, Math.pow(intensity, -e.deltaY));
			} else {
				// Normalise across deltaMode (0=px, 1=line, 2=page).
				const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.height : 1;
				setView(scale, tx - e.deltaX * k, ty - e.deltaY * k);
			}
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	$effect(() => {
		return () => cancelAnim();
	});

	// Expose imperative API to the parent.
	$effect(() => {
		api = {
			zoomToBBox: (bbox, opts) => {
				if (!natural.width || !viewport.width) return;
				// `fill` = fraction of the viewport the bbox should occupy. Smaller
				// value → more surrounding context (the tooth the finding sits on
				// stays visible). Tiny disease bboxes (~40px in a 1500px X-ray)
				// would otherwise pin to the max scale and crop away the tooth.
				const fill = opts?.padding ?? 0.35;
				const [x1, y1, x2, y2] = bbox;
				const bw = Math.max(1, x2 - x1);
				const bh = Math.max(1, y2 - y1);
				const fitToBBox = Math.min(
					(viewport.width * fill) / bw,
					(viewport.height * fill) / bh
				);
				// Absolute cap: never zoom past 5× fit-to-view, no matter how
				// small the bbox is. Keeps the worst case bounded.
				const maxRelative = fitScale * 5;
				const targetS = clampScale(Math.min(fitToBBox, maxRelative));
				const ccx = (x1 + x2) / 2;
				const ccy = (y1 + y2) / 2;
				const targetTx = viewport.width / 2 - ccx * targetS;
				const targetTy = viewport.height / 2 - ccy * targetS;
				const p = clampPan(targetS, targetTx, targetTy);
				animateTo({ s: targetS, tx: p.x, ty: p.y }, opts?.durationMs ?? 450);
			},
			reset: (durationMs = 450) => {
				if (!natural.width || !viewport.width) return;
				const s = fitScale * FIT_INSET;
				animateTo(
					{
						s,
						tx: (viewport.width - natural.width * s) / 2,
						ty: (viewport.height - natural.height * s) / 2
					},
					durationMs
				);
			},
			get imageNatural() {
				return natural.width ? { width: natural.width, height: natural.height } : null;
			}
		};
	});

	// ─── Pointer interactions ──────────────────────────────────────────────

	type PointerPos = { x: number; y: number };
	function twoPointers(): { a: PointerPos; b: PointerPos } | null {
		const vals = [...pointers.values()];
		if (vals.length < 2 || !vals[0] || !vals[1]) return null;
		return { a: vals[0], b: vals[1] };
	}

	function onPointerDown(e: PointerEvent) {
		if (!interactive || !natural.width) return;
		// Ignore pointerdowns that originated inside an interactive overlay element
		// (e.g. a detection rect) — the overlay calls stopPropagation, but defence-in-depth.
		if (e.defaultPrevented) return;
		cancelAnim();
		viewportEl?.setPointerCapture(e.pointerId);
		const rect = viewportEl!.getBoundingClientRect();
		pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

		if (pointers.size === 1) {
			dragId = e.pointerId;
			dragLast = { x: e.clientX - rect.left, y: e.clientY - rect.top };
			dragMoved = false;
		} else if (pointers.size === 2) {
			dragId = null;
			const two = twoPointers();
			if (!two) return;
			const { a, b } = two;
			const dist = Math.hypot(b.x - a.x, b.y - a.y);
			pinch = {
				startDist: dist,
				startScale: scale,
				startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
				startTx: tx,
				startTy: ty
			};
		}
	}

	function onPointerMove(e: PointerEvent) {
		if (!viewportEl || !pointers.has(e.pointerId)) return;
		const rect = viewportEl.getBoundingClientRect();
		const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		pointers.set(e.pointerId, pt);

		if (pinch && pointers.size === 2) {
			const two = twoPointers();
			if (!two) return;
			const { a, b } = two;
			const dist = Math.hypot(b.x - a.x, b.y - a.y);
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			const ratio = dist / pinch.startDist;
			const nextScale = clampScale(pinch.startScale * ratio);
			// Zoom around pinch midpoint and pan by midpoint delta.
			const eff = nextScale / pinch.startScale;
			const baseTx = pinch.startMid.x - (pinch.startMid.x - pinch.startTx) * eff;
			const baseTy = pinch.startMid.y - (pinch.startMid.y - pinch.startTy) * eff;
			setView(nextScale, baseTx + (mid.x - pinch.startMid.x), baseTy + (mid.y - pinch.startMid.y));
		} else if (dragId === e.pointerId) {
			const dx = pt.x - dragLast.x;
			const dy = pt.y - dragLast.y;
			if (Math.hypot(dx, dy) > 1) dragMoved = true;
			setView(scale, tx + dx, ty + dy);
			dragLast = pt;
		}
	}

	function onPointerUp(e: PointerEvent) {
		pointers.delete(e.pointerId);
		viewportEl?.releasePointerCapture?.(e.pointerId);
		if (pointers.size < 2) pinch = null;
		if (pointers.size === 0) {
			dragId = null;
			dragMoved = false;
		}
	}

	function onDoubleClick(e: MouseEvent) {
		if (!interactive || !natural.width) return;
		// Don't intercept double-clicks that started on an overlay element.
		if (e.defaultPrevented) return;
		api?.reset();
	}
</script>

<div
	class="viewport"
	class:interactive
	bind:this={viewportEl}
	role="presentation"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	ondblclick={onDoubleClick}
>
	{#if imageSrc}
		<div
			class="scene"
			style:transform="matrix({scale}, 0, 0, {scale}, {tx}, {ty})"
			style:width="{natural.width || 0}px"
			style:height="{natural.height || 0}px"
		>
			<img
				bind:this={imgEl}
				class="img"
				class:pixelated
				class:loaded={natural.width > 0}
				src={imageSrc}
				alt=""
				draggable="false"
				style:filter={imageFilter}
				onload={onImgLoad}
			/>
			{#if natural.width > 0}
				<svg
					class="overlay-svg"
					viewBox="0 0 {natural.width} {natural.height}"
					preserveAspectRatio="none"
					style:width="{natural.width}px"
					style:height="{natural.height}px"
				>
					{@render overlay?.({ imageWidth: natural.width, imageHeight: natural.height, scale })}
				</svg>
			{/if}
		</div>
	{/if}
	{@render chrome?.({
		scale,
		tx,
		ty,
		imageWidth: natural.width,
		imageHeight: natural.height
	})}
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 480px;
		overflow: hidden;
		border-radius: var(--radius-lg);
		background-color: var(--bg);
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.viewport.interactive {
		cursor: grab;
	}
	.viewport.interactive:active {
		cursor: grabbing;
	}
	.scene {
		position: absolute;
		top: 0;
		left: 0;
		transform-origin: 0 0;
		will-change: transform;
	}
	.img {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: auto;
		opacity: 0;
		transition: opacity 220ms ease-out;
		pointer-events: none;
	}
	.img.loaded {
		opacity: 1;
	}
	.img.pixelated {
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}
	.overlay-svg {
		position: absolute;
		inset: 0;
		display: block;
		overflow: visible;
		pointer-events: none;
	}
</style>
