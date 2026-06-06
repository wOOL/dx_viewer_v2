<script lang="ts">
	import { Crosshair, Move, Ruler, Spline, Maximize2, Eye } from 'lucide-svelte';
	import { _, locale } from 'svelte-i18n';
	import type { CbctStore } from '@be-certain/imaging-3d/state';
	import { renderPanoramicMip } from '@be-certain/imaging-3d/volumeLoader';
	import { onMount, type Snippet } from 'svelte';

	interface Props {
		store: CbctStore;
		/** Optional overlay rendered on top of the pano (e.g. the report's category chips). */
		children?: Snippet;
	}
	const { store, children }: Props = $props();

	// Interactive panoramic. The pano is a thick-slab MIP reformat of the volume; these
	// tools make it usable: Pan / Zoom-to-fit (view transform), Ruler (mm — pano-x maps to
	// volume X = spacing[0] mm/px, pano-y to volume Z = spacing[2] mm/px), MIP-slab (re-render
	// at a new slab thickness), Crosshair (reference marker), Show-overlays (toggle markers).
	// The MIP is decoded once into an offscreen canvas (rebuilt only on volume / W-L / slab
	// change); pan / zoom / markup just re-composite — keeps the interaction cheap.
	type PanoTool = 'pan' | 'ruler' | 'crosshair';
	let panoTool = $state<PanoTool | null>(null);
	let panoShowOverlays = $state(true);
	let panoSlabHalf = $state(20);
	const SLAB_STEPS = [10, 20, 32, 48];

	let canvasEl = $state<HTMLCanvasElement | null>(null);
	let panoOffscreen: HTMLCanvasElement | null = null;
	let panoW = 0;
	let panoH = 0;
	let panoZoom = 1;
	let panoTx = 0;
	let panoTy = 0;
	let panoFitted = false;
	let panoRulers: { x1: number; y1: number; x2: number; y2: number }[] = [];
	let panoDraft: { x1: number; y1: number; x2: number; y2: number } | null = null;
	let panoCross: { x: number; y: number } | null = null;
	let panoDragging: { mode: 'pan' | 'ruler'; px: number; py: number } | null = null;

	function rebuildMip() {
		const v = store.volume;
		if (!v) {
			panoOffscreen = null;
			return;
		}
		const { rgba, width, height } = renderPanoramicMip(v, {
			window: store.windowVal,
			level: store.levelVal,
			invert: store.invert,
			slabHalf: panoSlabHalf
		});
		panoW = width;
		panoH = height;
		if (!panoOffscreen) panoOffscreen = document.createElement('canvas');
		panoOffscreen.width = width;
		panoOffscreen.height = height;
		panoOffscreen.getContext('2d')?.putImageData(new ImageData(rgba, width, height), 0, 0);
	}

	function fitPano() {
		const c = canvasEl;
		if (!c || !panoW || !panoH) return;
		const cw = c.clientWidth || c.width;
		const ch = c.clientHeight || c.height;
		const s = Math.min(cw / panoW, ch / panoH);
		panoZoom = s > 0 ? s : 1;
		panoTx = (cw - panoW * panoZoom) / 2;
		panoTy = (ch - panoH * panoZoom) / 2;
		panoFitted = true;
	}

	function drawPano() {
		const c = canvasEl;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const cw = Math.max(1, c.clientWidth || 600);
		const ch = Math.max(1, c.clientHeight || 300);
		if (c.width !== cw || c.height !== ch) {
			c.width = cw;
			c.height = ch;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, cw, ch);
		if (!panoOffscreen || !store.volume) {
			ctx.fillStyle = '#9ca3af';
			ctx.font = '14px system-ui';
			ctx.textAlign = 'center';
			ctx.fillText($_('cbct.panoLoading'), cw / 2, ch / 2);
			return;
		}
		if (!panoFitted) fitPano();
		ctx.imageSmoothingEnabled = true;
		ctx.save();
		ctx.translate(panoTx, panoTy);
		ctx.scale(panoZoom, panoZoom);
		ctx.drawImage(panoOffscreen, 0, 0);
		ctx.restore();
		if (panoShowOverlays) drawPanoOverlays(ctx);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = 'rgba(255,255,255,0.55)';
		ctx.font = '10px system-ui';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'bottom';
		ctx.fillText(
			$_('cbct.panoSlabHud', {
				values: { vox: panoSlabHalf * 2, zoom: Math.round(panoZoom * 100) }
			}),
			6,
			ch - 5
		);
	}

	function drawPanoOverlays(ctx: CanvasRenderingContext2D) {
		const v = store.volume;
		const sx = v?.spacing[0] ?? 1; // mm per pano-x pixel (volume X)
		const sy = v?.spacing[2] ?? 1; // mm per pano-y pixel (volume Z)
		ctx.save();
		ctx.translate(panoTx, panoTy);
		ctx.scale(panoZoom, panoZoom);
		const lw = 1.5 / panoZoom;
		const handle = 3 / panoZoom;
		const all = panoDraft ? [...panoRulers, panoDraft] : panoRulers;
		for (const r of all) {
			ctx.strokeStyle = '#fbbf24';
			ctx.fillStyle = '#fbbf24';
			ctx.lineWidth = lw;
			ctx.beginPath();
			ctx.moveTo(r.x1, r.y1);
			ctx.lineTo(r.x2, r.y2);
			ctx.stroke();
			for (const pt of [
				[r.x1, r.y1],
				[r.x2, r.y2]
			] as const) {
				ctx.beginPath();
				ctx.arc(pt[0], pt[1], handle, 0, Math.PI * 2);
				ctx.fill();
			}
			const mm = Math.hypot((r.x2 - r.x1) * sx, (r.y2 - r.y1) * sy);
			const midx = (r.x1 + r.x2) / 2;
			const midy = (r.y1 + r.y2) / 2;
			const label = `${mm.toLocaleString($locale ?? undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`;
			ctx.font = `${Math.max(10, 12 / panoZoom)}px system-ui`;
			ctx.textBaseline = 'bottom';
			ctx.textAlign = 'left';
			const tw = ctx.measureText(label).width;
			ctx.fillStyle = 'rgba(0,0,0,0.6)';
			ctx.fillRect(midx + 4 / panoZoom, midy - 15 / panoZoom, tw + 6 / panoZoom, 15 / panoZoom);
			ctx.fillStyle = '#fde68a';
			ctx.fillText(label, midx + 6 / panoZoom, midy - 3 / panoZoom);
		}
		if (panoCross) {
			ctx.strokeStyle = '#38bdf8';
			ctx.lineWidth = lw;
			const r = 10 / panoZoom;
			ctx.beginPath();
			ctx.moveTo(panoCross.x - r, panoCross.y);
			ctx.lineTo(panoCross.x + r, panoCross.y);
			ctx.moveTo(panoCross.x, panoCross.y - r);
			ctx.lineTo(panoCross.x, panoCross.y + r);
			ctx.stroke();
		}
		ctx.restore();
	}

	function panoPt(e: PointerEvent): { x: number; y: number } {
		const c = canvasEl!;
		const rect = c.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left - panoTx) / panoZoom,
			y: (e.clientY - rect.top - panoTy) / panoZoom
		};
	}

	function panoPointerDown(e: PointerEvent) {
		if (!panoOffscreen) return;
		const p = panoPt(e);
		if (panoTool === 'ruler') {
			panoDraft = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
			panoDragging = { mode: 'ruler', px: e.clientX, py: e.clientY };
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} else if (panoTool === 'crosshair') {
			panoCross = { x: p.x, y: p.y };
			drawPano();
		} else {
			panoDragging = { mode: 'pan', px: e.clientX, py: e.clientY };
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		}
	}

	function panoPointerMove(e: PointerEvent) {
		if (!panoDragging) return;
		if (panoDragging.mode === 'pan') {
			panoTx += e.clientX - panoDragging.px;
			panoTy += e.clientY - panoDragging.py;
			panoDragging.px = e.clientX;
			panoDragging.py = e.clientY;
			drawPano();
		} else if (panoDraft) {
			const p = panoPt(e);
			panoDraft = { ...panoDraft, x2: p.x, y2: p.y };
			drawPano();
		}
	}

	function panoPointerUp() {
		if (panoDragging?.mode === 'ruler' && panoDraft) {
			if (Math.hypot(panoDraft.x2 - panoDraft.x1, panoDraft.y2 - panoDraft.y1) > 2)
				panoRulers = [...panoRulers, panoDraft];
			panoDraft = null;
			drawPano();
		}
		panoDragging = null;
	}

	function panoWheel(e: WheelEvent) {
		if (!panoOffscreen) return;
		e.preventDefault();
		const rect = canvasEl!.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const px = (sx - panoTx) / panoZoom;
		const py = (sy - panoTy) / panoZoom;
		panoZoom = Math.max(0.1, Math.min(20, panoZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
		panoTx = sx - px * panoZoom;
		panoTy = sy - py * panoZoom;
		drawPano();
	}

	function cyclePanoSlab() {
		const i = SLAB_STEPS.indexOf(panoSlabHalf);
		panoSlabHalf = SLAB_STEPS[(i + 1) % SLAB_STEPS.length]; // effect rebuilds the MIP
	}
	function clearPanoMarkup() {
		panoRulers = [];
		panoDraft = null;
		panoCross = null;
		drawPano();
	}
	function setPanoTool(t: PanoTool) {
		panoTool = panoTool === t ? null : t;
	}
	function togglePanoOverlays() {
		panoShowOverlays = !panoShowOverlays;
		drawPano();
	}
	function zoomFitPano() {
		fitPano();
		drawPano();
	}

	// Rebuild the MIP + redraw when the volume / window-level / slab thickness changes.
	$effect(() => {
		void store.volume;
		void store.windowVal;
		void store.levelVal;
		void store.invert;
		void panoSlabHalf;
		void $locale; // ruler labels are formatted with the active locale's decimal mark
		rebuildMip();
		drawPano();
	});

	onMount(() => {
		rebuildMip();
		fitPano();
		drawPano();
		const c = canvasEl;
		let ro: ResizeObserver | null = null;
		if (c && typeof ResizeObserver !== 'undefined') {
			ro = new ResizeObserver(() => {
				panoFitted = false;
				drawPano();
			});
			if (c.parentElement) ro.observe(c.parentElement);
		}
		// Wheel zoom needs a non-passive listener so preventDefault stops the page scrolling.
		c?.addEventListener('wheel', panoWheel, { passive: false });
		return () => {
			ro?.disconnect();
			c?.removeEventListener('wheel', panoWheel);
		};
	});
</script>

<div class="flex h-full w-full gap-2 bg-black p-2">
	<!-- Tool column -->
	<div class="flex flex-col gap-1 pr-1">
		<button
			class="pano-tool"
			class:active={panoTool === 'crosshair'}
			aria-pressed={panoTool === 'crosshair'}
			aria-label={$_('cbct.panoCrosshair')}
			title={$_('cbct.panoCrosshair')}
			onclick={() => setPanoTool('crosshair')}><Crosshair size={14} /></button
		>
		<button
			class="pano-tool"
			class:active={panoTool === 'pan'}
			aria-pressed={panoTool === 'pan'}
			aria-label={$_('cbct.panoPan')}
			title={$_('cbct.panoPan')}
			onclick={() => setPanoTool('pan')}><Move size={14} /></button
		>
		<button
			class="pano-tool"
			class:active={panoTool === 'ruler'}
			aria-pressed={panoTool === 'ruler'}
			aria-label={$_('cbct.panoRuler')}
			title={$_('cbct.panoRuler')}
			onclick={() => setPanoTool('ruler')}><Ruler size={14} /></button
		>
		<button
			class="pano-tool"
			aria-label={$_('cbct.panoSlab')}
			title={$_('cbct.panoSlab')}
			onclick={cyclePanoSlab}><Spline size={14} /></button
		>
		<button
			class="pano-tool"
			aria-label={$_('cbct.panoZoomFit')}
			title={$_('cbct.panoZoomFit')}
			onclick={zoomFitPano}><Maximize2 size={14} /></button
		>
		<button
			class="pano-tool"
			class:active={panoShowOverlays}
			aria-pressed={panoShowOverlays}
			aria-label={$_('cbct.panoOverlays')}
			title={$_('cbct.panoOverlays')}
			onclick={togglePanoOverlays}><Eye size={14} /></button
		>
	</div>
	<!-- Main panoramic -->
	<div class="relative min-w-0 flex-1 overflow-hidden rounded-md bg-black">
		<canvas
			bind:this={canvasEl}
			class="block h-full w-full touch-none"
			class:cursor-crosshair={panoTool === 'ruler' || panoTool === 'crosshair'}
			class:cursor-grab={panoTool === 'pan' || panoTool === null}
			onpointerdown={panoPointerDown}
			onpointermove={panoPointerMove}
			onpointerup={panoPointerUp}
			onpointerleave={panoPointerUp}
			ondblclick={clearPanoMarkup}
		></canvas>
		{@render children?.()}
	</div>
</div>

<style>
	.pano-tool {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 4px;
		color: var(--color-fg-2);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.pano-tool:hover {
		background: var(--color-bg-2);
		color: var(--color-fg-0);
	}
	.pano-tool.active {
		/* Saffron brand mark (not the theme-flipping primary) — this toolbar sits on
		   the always-black panoramic canvas, where navy (light-mode primary) would
		   vanish. brand-400 is a light colour, legible on black in both themes. */
		background: color-mix(in oklab, var(--color-brand-400) 22%, transparent);
		color: var(--color-brand-400);
	}
</style>
