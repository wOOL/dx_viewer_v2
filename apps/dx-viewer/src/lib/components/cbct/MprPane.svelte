<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import { sliceVolume, maxSliceIndex, type Axis } from '@be-certain/imaging-3d/volumeLoader';
	import { MAX_ANNOTATION_LENGTH, capText } from '$lib/limits';
	import type { CbctStore } from '@be-certain/imaging-3d/state';

	interface Props {
		axis: Axis;
		store: CbctStore;
		label?: string;
	}

	const { axis, store, label }: Props = $props();

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let containerEl = $state<HTMLDivElement | null>(null);
	let cw = $state(1);
	let ch = $state(1);

	let dragging = $state(false);
	let dragMode = $state<'pan' | 'wl' | 'measure' | null>(null);
	let dragStart = $state({ x: 0, y: 0, wl: { window: 0, level: 0 }, pan: { x: 0, y: 0 } });
	let pan = $state({ x: 0, y: 0 });
	let viewZoom = $state(1);
	// Plain (non-reactive) dedupe key so the fit-to-pane effect fits once per
	// volume/reset, not on every resize (which would clobber a manual zoom).
	let lastFitKey = '';
	// In-progress linear measurement (slice-pixel coords); committed ones live in store.measurements.
	let measureStart = $state<[number, number] | null>(null);
	let measureEnd = $state<[number, number] | null>(null);
	// In-progress angle: click-based collection of [vertex, rayA, rayC]; committed → store.angles.
	let anglePts = $state<[number, number][]>([]);
	let angleHover = $state<[number, number] | null>(null);
	// Pending annotation: a floating text input shown at the click point (container px),
	// committed to store.annotations on Enter/blur. p is the slice-pixel anchor.
	let pendingAnno = $state<{ p: [number, number]; x: number; y: number } | null>(null);
	let annoText = $state('');
	let annoInputEl = $state<HTMLInputElement | null>(null);

	const currentIdx = $derived(
		axis === 'axial'
			? store.slice.axial
			: axis === 'coronal'
				? store.slice.coronal
				: store.slice.sagittal
	);

	const maxIdx = $derived(store.volume ? maxSliceIndex(store.volume, axis) : 0);

	// In-plane slice dimensions (px) for this axis (mirrors sliceVolume's mapping):
	// axial = X×Y, coronal = X×Z, sagittal = Y×Z. Used to fit the slice to the pane.
	const sliceDims = $derived.by((): [number, number] => {
		const v = store.volume;
		if (!v) return [0, 0];
		const [nx, ny, nz] = v.dims;
		return axis === 'axial' ? [nx, ny] : axis === 'coronal' ? [nx, nz] : [ny, nz];
	});

	function setIdx(i: number) {
		if (!store.volume) return;
		const clamped = Math.max(0, Math.min(maxIdx, Math.round(i)));
		const s = { ...store.slice };
		if (axis === 'axial') s.axial = clamped;
		else if (axis === 'coronal') s.coronal = clamped;
		else s.sagittal = clamped;
		store.slice = s;
	}

	// Per-pane scratch RGBA buffer + matching ImageData, reused across render
	// frames. Without this, every W/L drag, slice scroll, slab change and locale
	// re-render allocated a fresh multi-MB Uint8ClampedArray (in sliceVolume) plus
	// a new ImageData — across up to 4 panes on a large CBCT, that's a lot of
	// per-pointermove garbage. We only re-allocate when the slice dimensions
	// change (axis switch or a different volume); sliceVolume rewrites every pixel
	// (incl. alpha) so there's no stale data when the buffer is reused.
	let scratch: Uint8ClampedArray<ArrayBuffer> | undefined;
	let scratchImg: ImageData | undefined;
	let scratchW = 0;
	let scratchH = 0;

	function render() {
		if (!canvasEl || !store.volume) return;
		const [w, h] = sliceDims;
		if (!scratch || scratchImg === undefined || scratchW !== w || scratchH !== h) {
			scratch = new Uint8ClampedArray(w * h * 4);
			scratchImg = new ImageData(scratch, w, h);
			scratchW = w;
			scratchH = h;
		}
		const slc = sliceVolume(
			store.volume,
			axis,
			currentIdx,
			{
				window: store.windowVal,
				level: store.levelVal,
				invert: store.invert,
				slab: store.slabThickness
			},
			scratch
		);
		canvasEl.width = slc.width;
		canvasEl.height = slc.height;
		const ctx = canvasEl.getContext('2d');
		if (!ctx) return;
		// slc.rgba is `scratch` when the sizes matched (the common case); if for any
		// reason it allocated a fresh buffer, wrap that instead so we always draw the
		// pixels we actually computed.
		const img = slc.rgba === scratch ? scratchImg : new ImageData(slc.rgba, slc.width, slc.height);
		ctx.putImageData(img, 0, 0);

		// Shared markup styling (scaled to the slice resolution).
		const dotR = Math.max(2, canvasEl.width / 200);
		const lineW = Math.max(1, canvasEl.width / 400);
		const fontPx = Math.max(10, Math.round(canvasEl.width / 28));
		ctx.lineWidth = lineW;
		ctx.font = `${fontPx}px sans-serif`;
		ctx.textBaseline = 'bottom';

		const dot = (p: [number, number]) => {
			ctx.beginPath();
			ctx.arc(p[0], p[1], dotR, 0, Math.PI * 2);
			ctx.fill();
		};

		// Linear measurements on this slice (committed + in-progress).
		const segs = store.measurements
			.filter((m) => m.axis === axis && m.slice === currentIdx)
			.map((m) => ({ a: m.a, b: m.b, mm: m.mm }));
		if (dragMode === 'measure' && measureStart && measureEnd) {
			segs.push({ a: measureStart, b: measureEnd, mm: pixelDistToMm(measureStart, measureEnd) });
		}
		ctx.strokeStyle = '#f9c54e'; // saffron brand marker (legible on the dark slice, both themes)
		ctx.fillStyle = '#f9c54e';
		for (const s of segs) {
			ctx.beginPath();
			ctx.moveTo(s.a[0], s.a[1]);
			ctx.lineTo(s.b[0], s.b[1]);
			ctx.stroke();
			dot(s.a);
			dot(s.b);
			ctx.fillText(
				`${s.mm.toLocaleString($locale ?? undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`,
				(s.a[0] + s.b[0]) / 2 + 4,
				(s.a[1] + s.b[1]) / 2 - 4
			);
		}

		// Angles on this slice. drawAngle takes vertex + (optional) rays; null rays
		// support the in-progress preview as points are collected.
		const drawAngle = (
			v: [number, number],
			a: [number, number] | null,
			c: [number, number] | null,
			deg: number | null
		) => {
			ctx.strokeStyle = '#a78bfa';
			ctx.fillStyle = '#a78bfa';
			for (const ray of [a, c]) {
				if (!ray) continue;
				ctx.beginPath();
				ctx.moveTo(v[0], v[1]);
				ctx.lineTo(ray[0], ray[1]);
				ctx.stroke();
			}
			for (const p of [v, a, c]) if (p) dot(p);
			if (deg != null) ctx.fillText(`${deg.toFixed(0)}°`, v[0] + 6, v[1] - 6);
		};
		for (const ang of store.angles.filter((a) => a.axis === axis && a.slice === currentIdx)) {
			drawAngle(ang.vertex, ang.a, ang.c, ang.deg);
		}
		if (store.tool === 'angle' && anglePts.length > 0) {
			if (anglePts.length === 1) drawAngle(anglePts[0], angleHover, null, null);
			else if (anglePts.length === 2)
				drawAngle(
					anglePts[0],
					anglePts[1],
					angleHover,
					angleHover ? angleDeg(anglePts[1], anglePts[0], angleHover) : null
				);
		}

		// Annotation pins on this slice.
		ctx.textBaseline = 'middle';
		for (const an of store.annotations.filter((a) => a.axis === axis && a.slice === currentIdx)) {
			ctx.fillStyle = '#f59e0b';
			ctx.beginPath();
			ctx.arc(an.p[0], an.p[1], dotR * 1.4, 0, Math.PI * 2);
			ctx.fill();
			const tw = ctx.measureText(an.text).width;
			ctx.fillStyle = 'rgba(0,0,0,0.6)';
			ctx.fillRect(an.p[0] + dotR * 2, an.p[1] - fontPx / 2 - 2, tw + 6, fontPx + 4);
			ctx.fillStyle = '#fbbf24';
			ctx.fillText(an.text, an.p[0] + dotR * 2 + 3, an.p[1]);
		}
	}

	// Angle (degrees) at vertex v between rays v→a and v→c, measured in mm-space
	// so anisotropic voxel spacing doesn't skew the result.
	function angleDeg(a: [number, number], v: [number, number], c: [number, number]): number {
		const [spU, spV] = inPlaneSpacing();
		const v1 = [(a[0] - v[0]) * spU, (a[1] - v[1]) * spV];
		const v2 = [(c[0] - v[0]) * spU, (c[1] - v[1]) * spV];
		const m1 = Math.hypot(v1[0], v1[1]);
		const m2 = Math.hypot(v2[0], v2[1]);
		if (m1 === 0 || m2 === 0) return 0;
		const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (m1 * m2)));
		return (Math.acos(cos) * 180) / Math.PI;
	}

	$effect(() => {
		// Re-render on dependencies
		void currentIdx;
		void store.windowVal;
		void store.levelVal;
		void store.invert;
		void store.slabThickness;
		void store.volume;
		void store.measurements;
		void store.angles;
		void store.annotations;
		void $locale; // measurement labels are formatted with the active locale's decimal mark
		render();
	});

	$effect(() => {
		// Switching away from a click-based tool discards any half-finished markup.
		// Depends only on store.tool (doesn't read the state it resets → no re-run loop).
		const tool = store.tool;
		if (tool !== 'angle') {
			anglePts = [];
			angleHover = null;
		}
		if (tool !== 'annotate') {
			pendingAnno = null;
			annoText = '';
		}
	});

	$effect(() => {
		// Fit the slice to the pane on first load and on "Reset all" (mprResetNonce).
		// Previously viewZoom was hardcoded to 1 (native voxel resolution), so small
		// volumes rendered tiny in a large pane and cw/ch were tracked but never used.
		// The key omits cw/ch so a window resize alone won't refit (and clobber a
		// manual zoom); a new volume or a Reset bumps the key and re-fits.
		const [sw, sh] = sliceDims;
		void cw;
		void ch;
		if (sw <= 0 || sh <= 0 || cw <= 1 || ch <= 1) return;
		const key = `${store.mprResetNonce}|${sw}x${sh}`;
		if (key === lastFitKey) return;
		lastFitKey = key;
		viewZoom = Math.max(0.2, Math.min(8, Math.min(cw / sw, ch / sh) * 0.92));
		pan = { x: 0, y: 0 };
	});

	onMount(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver(() => {
			if (!containerEl) return;
			cw = containerEl.clientWidth;
			ch = containerEl.clientHeight;
		});
		ro.observe(containerEl);
		cw = containerEl.clientWidth;
		ch = containerEl.clientHeight;
		return () => ro.disconnect();
	});

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			// Zoom
			const factor = e.deltaY < 0 ? 1.1 : 0.9;
			viewZoom = Math.max(0.2, Math.min(8, viewZoom * factor));
		} else {
			// Slice scroll
			setIdx(currentIdx + (e.deltaY > 0 ? 1 : -1));
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (!canvasEl || !store.volume) return;

		// Click-based tools (left button, no shift): handle and return — no drag.
		// Shift still forces crosshair; right/middle still pan (handled below).
		if (e.button === 0 && !e.shiftKey) {
			if (store.tool === 'angle') {
				addAnglePoint(toSlicePx(e));
				return;
			}
			if (store.tool === 'annotate') {
				beginAnnotation(e);
				return;
			}
		}

		(e.target as Element).setPointerCapture(e.pointerId);
		dragging = true;
		dragStart = {
			x: e.clientX,
			y: e.clientY,
			wl: { window: store.windowVal, level: store.levelVal },
			pan: { ...pan }
		};
		// Right-click or middle = pan; left = wl (radiologist default); shift+left = crosshair
		if (e.button === 2 || e.button === 1) dragMode = 'pan';
		else if (e.shiftKey || store.tool === 'crosshair') {
			updateCrosshair(e);
			dragMode = null;
		} else if (store.tool === 'pan') dragMode = 'pan';
		else if (store.tool === 'measure') {
			const p = toSlicePx(e);
			measureStart = p;
			measureEnd = p;
			dragMode = 'measure';
		} else dragMode = 'wl';
	}

	function toSlicePx(e: PointerEvent): [number, number] {
		const r = canvasEl!.getBoundingClientRect();
		const x = ((e.clientX - r.left) / r.width) * canvasEl!.width;
		const y = ((e.clientY - r.top) / r.height) * canvasEl!.height;
		// Clamp to the slice bounds. Pointer capture keeps events flowing while the
		// cursor leaves the pane, so without this a measure/angle/annotation dragged
		// past the edge records an out-of-range endpoint → inflated mm + an off-canvas
		// label (the 2D ruler already clamps via clientToImage; this matches it).
		return [Math.max(0, Math.min(canvasEl!.width, x)), Math.max(0, Math.min(canvasEl!.height, y))];
	}

	// In-plane voxel spacing [mm/px-u, mm/px-v] for this axis's slice.
	function inPlaneSpacing(): [number, number] {
		if (!store.volume) return [1, 1];
		const [sx, sy, sz] = store.volume.spacing;
		return axis === 'axial' ? [sx, sy] : axis === 'coronal' ? [sx, sz] : [sy, sz];
	}

	// Slice-pixel distance → mm, using the in-plane voxel spacing for this axis.
	function pixelDistToMm(a: [number, number], b: [number, number]): number {
		const [spU, spV] = inPlaneSpacing();
		return Math.hypot((b[0] - a[0]) * spU, (b[1] - a[1]) * spV);
	}

	function onPointerMove(e: PointerEvent) {
		// Angle preview tracks the cursor between clicks (not a drag).
		if (store.tool === 'angle' && anglePts.length > 0 && anglePts.length < 3 && store.volume) {
			angleHover = toSlicePx(e);
			render();
			return;
		}
		if (!dragging || !store.volume) return;
		const dx = e.clientX - dragStart.x;
		const dy = e.clientY - dragStart.y;
		if (dragMode === 'wl') {
			store.windowVal = Math.max(1, dragStart.wl.window + dx * 4);
			store.levelVal = dragStart.wl.level - dy * 4;
		} else if (dragMode === 'pan') {
			pan = { x: dragStart.pan.x + dx, y: dragStart.pan.y + dy };
		} else if (dragMode === 'measure') {
			measureEnd = toSlicePx(e);
			render();
		} else if (store.tool === 'crosshair' || e.shiftKey) {
			// Shift held = "force crosshair" (matches onPointerDown); track the drag,
			// not just the initial click, so shift+drag scrubs the crosshair like the
			// dedicated Crosshair tool does. dragMode is null in both these cases, so
			// the wl/pan/measure branches above never intercept a shift-drag.
			updateCrosshair(e);
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (dragMode === 'measure' && measureStart && measureEnd && store.volume) {
			const dx = measureEnd[0] - measureStart[0];
			const dy = measureEnd[1] - measureStart[1];
			if (Math.hypot(dx, dy) > 1) {
				store.addMeasurement({
					axis,
					slice: currentIdx,
					a: measureStart,
					b: measureEnd,
					mm: pixelDistToMm(measureStart, measureEnd)
				});
			}
			measureStart = null;
			measureEnd = null;
		}
		dragging = false;
		dragMode = null;
		const el = e.target as Element;
		if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
	}

	function addAnglePoint(p: [number, number]) {
		anglePts = [...anglePts, p];
		if (anglePts.length === 3 && store.volume) {
			// pts = [vertex, rayA, rayC]; angle is measured at the vertex.
			store.addAngle({
				axis,
				slice: currentIdx,
				vertex: anglePts[0],
				a: anglePts[1],
				c: anglePts[2],
				deg: angleDeg(anglePts[1], anglePts[0], anglePts[2])
			});
			anglePts = [];
			angleHover = null;
		}
		render();
	}

	async function beginAnnotation(e: PointerEvent) {
		if (!containerEl) return;
		// Commit any input still open before starting a new one.
		commitAnnotation();
		const r = containerEl.getBoundingClientRect();
		pendingAnno = { p: toSlicePx(e), x: e.clientX - r.left, y: e.clientY - r.top };
		annoText = '';
		await tick();
		// Defer focus past the current click's mouseup. Focusing during the click's
		// microtask lets the browser's click focus handling immediately blur the input
		// → onblur commits empty → the note input vanishes before you can type.
		requestAnimationFrame(() => annoInputEl?.focus());
	}

	function commitAnnotation() {
		// Cap at the commit point (not just the input maxlength) so a pasted/over-long
		// note can't bloat the per-study markup state that gets persisted.
		const text = capText(annoText, MAX_ANNOTATION_LENGTH);
		if (pendingAnno && text && store.volume) {
			store.addAnnotation({ axis, slice: currentIdx, p: pendingAnno.p, text });
		}
		pendingAnno = null;
		annoText = '';
	}

	function cancelAnnotation() {
		pendingAnno = null;
		annoText = '';
	}

	function updateCrosshair(e: PointerEvent) {
		if (!canvasEl || !store.volume) return;
		const r = canvasEl.getBoundingClientRect();
		const u = ((e.clientX - r.left) / r.width) * canvasEl.width;
		const v = ((e.clientY - r.top) / r.height) * canvasEl.height;
		const s = { ...store.slice };
		// Map (u, v) on this axis to volume indices
		const [nx, ny, nz] = store.volume.dims;
		if (axis === 'axial') {
			s.sagittal = Math.max(0, Math.min(nx - 1, Math.round(u)));
			s.coronal = Math.max(0, Math.min(ny - 1, Math.round(v)));
		} else if (axis === 'coronal') {
			s.sagittal = Math.max(0, Math.min(nx - 1, Math.round(u)));
			s.axial = Math.max(0, Math.min(nz - 1, Math.round(nz - v - 1)));
		} else {
			// sagittal — u=y, v=z
			s.coronal = Math.max(0, Math.min(ny - 1, Math.round(u)));
			s.axial = Math.max(0, Math.min(nz - 1, Math.round(nz - v - 1)));
		}
		store.slice = s;
	}

	const crosshairOnView = $derived.by(() => {
		if (!store.volume) return null;
		const [nx, ny, nz] = store.volume.dims;
		if (axis === 'axial') return { u: store.slice.sagittal / nx, v: store.slice.coronal / ny };
		if (axis === 'coronal')
			return { u: store.slice.sagittal / nx, v: (nz - store.slice.axial - 1) / nz };
		return { u: store.slice.coronal / ny, v: (nz - store.slice.axial - 1) / nz };
	});

	const sliceFraction = $derived(maxIdx > 0 ? currentIdx / maxIdx : 0);
</script>

<div
	bind:this={containerEl}
	class="mpr-pane relative h-full w-full overflow-hidden bg-black select-none"
	onwheel={onWheel}
	onmouseenter={() => (store.activeAxis = axis)}
	role="group"
	aria-label={$_('cbct.sliceAria', { values: { label: label ?? axis } })}
>
	<canvas
		bind:this={canvasEl}
		class="absolute top-1/2 left-1/2 [image-rendering:pixelated]"
		style="transform: translate(-50%, -50%) translate({pan.x}px, {pan.y}px) scale({viewZoom});"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>

	{#if pendingAnno}
		<input
			bind:this={annoInputEl}
			bind:value={annoText}
			type="text"
			maxlength={MAX_ANNOTATION_LENGTH}
			placeholder={$_('cbct.annotationNote')}
			class="absolute z-10 w-32 rounded border border-primary bg-bg-1/95 px-1.5 py-0.5 text-xs text-fg-0 shadow-lg outline-none"
			style="left: {pendingAnno.x}px; top: {pendingAnno.y}px;"
			onkeydown={(e) => {
				if (e.key === 'Enter') {
					e.preventDefault();
					commitAnnotation();
				} else if (e.key === 'Escape') {
					e.preventDefault();
					cancelAnnotation();
				}
			}}
			onblur={commitAnnotation}
		/>
	{/if}

	{#if store.crosshair && crosshairOnView}
		<div class="pointer-events-none absolute inset-0">
			<div
				class="absolute right-0 left-0 h-px bg-brand-400/70"
				style="top: {crosshairOnView.v * 100}%"
			></div>
			<div
				class="absolute top-0 bottom-0 w-px bg-brand-400/70"
				style="left: {crosshairOnView.u * 100}%"
			></div>
		</div>
	{/if}

	<div
		class="pointer-events-none absolute top-2 left-2 flex items-center gap-2 text-xs font-medium text-fg-0/90"
	>
		<span class="rounded bg-bg-1/80 px-2 py-0.5 tracking-wider uppercase">{label ?? axis}</span>
		<span class="text-fg-2">{currentIdx + 1}/{maxIdx + 1}</span>
	</div>

	<div
		class="pointer-events-none absolute top-2 right-2 flex flex-col items-end gap-1 font-mono text-[10px] text-fg-2"
	>
		<span>W: {Math.round(store.windowVal)}</span>
		<span>L: {Math.round(store.levelVal)}</span>
	</div>

	<input
		type="range"
		min="0"
		max={maxIdx}
		value={currentIdx}
		aria-label={$_('cbct.sliceIndexAria', { values: { label: label ?? axis } })}
		oninput={(e) => setIdx(+(e.currentTarget as HTMLInputElement).value)}
		class="absolute right-12 bottom-2 left-2 h-1 cursor-pointer"
	/>
	<div class="absolute right-2 bottom-1 font-mono text-[10px] text-fg-2">
		{Math.round(sliceFraction * 100)}%
	</div>
</div>

<style>
	input[type='range'] {
		accent-color: var(--color-primary);
	}
</style>
