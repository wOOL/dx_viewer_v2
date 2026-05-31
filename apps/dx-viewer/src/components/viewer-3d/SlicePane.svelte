<script lang="ts">
	import type { SliceAxis, SliceView } from '@be-certain/imaging-3d/svelte';
	import { onDestroy, untrack } from 'svelte';

	type Crosshair = { x: number; y: number; z: number };

	type Props = {
		axis: SliceAxis;
		label: string;
		sliceView: SliceView | null;
		worldPos: number | null;
		crosshair: Crosshair | null;
		onChange: (worldCoord: number) => void;
		/**
		 * Surfaces this pane's canvas container to the parent so it can be
		 * passed into viewer.mount(). Explicit callback (not bind:this) so the
		 * parent's $state updates synchronously when the element binds —
		 * Svelte 5's $bindable + bind:el chain has subtler propagation timing
		 * that we don't want to depend on for triggering slice-view creation.
		 */
		onCanvas: (el: HTMLDivElement | null) => void;
	};

	let { axis, label, sliceView, worldPos, crosshair, onChange, onCanvas }: Props = $props();

	let canvasEl: HTMLDivElement | undefined = $state();

	const AXIS_COLORS: Record<SliceAxis, string> = {
		axial: '#F0C764',
		coronal: '#5DD4C9',
		sagittal: '#E87B9F'
	};

	// Line colour encodes the PLANE the line represents, not which view it lives in.
	// Vertical line on the axial view is the sagittal plane (X-const) → coloured sagittal-pink, etc.
	const PLANE_LINE_COLORS: Record<SliceAxis, { v: string; h: string }> = {
		axial: { v: AXIS_COLORS.sagittal, h: AXIS_COLORS.coronal },
		coronal: { v: AXIS_COLORS.sagittal, h: AXIS_COLORS.axial },
		sagittal: { v: AXIS_COLORS.coronal, h: AXIS_COLORS.axial }
	};

	const ORIENTATION_LABELS: Record<SliceAxis, { top: string; bottom: string; left: string; right: string }> = {
		axial: { top: 'A', bottom: 'P', left: 'R', right: 'L' },
		coronal: { top: 'S', bottom: 'I', left: 'R', right: 'L' },
		sagittal: { top: 'S', bottom: 'I', left: 'P', right: 'A' }
	};

	const SLICE_AXIS_CHAR: Record<SliceAxis, string> = { axial: 'Z', coronal: 'Y', sagittal: 'X' };

	let axisColor = $derived(AXIS_COLORS[axis]);
	let planeLineColors = $derived(PLANE_LINE_COLORS[axis]);
	let orient = $derived(ORIENTATION_LABELS[axis]);
	let axisChar = $derived(SLICE_AXIS_CHAR[axis]);

	let worldMin = $derived(sliceView ? sliceView.worldRange[0] : 0);
	let worldMax = $derived(sliceView ? sliceView.worldRange[1] : 0);
	let worldStep = $derived(sliceView ? sliceView.worldStep : 0.5);
	let hasRange = $derived(worldMax > worldMin);
	let sliderValue = $derived(worldPos ?? worldMin);

	// Re-compute crosshair pixel position whenever the picked point, the slice
	// view, the slider position, or the container size changes. worldToCss
	// reads the live render-window viewport.
	let resizeTick = $state(0);
	let crosshairPx: { left: number; top: number } | null = $derived.by(() => {
		// Touch resizeTick + worldPos so this $derived re-runs on container resize and slice movement.
		resizeTick;
		worldPos;
		if (!sliceView || !crosshair) return null;
		try {
			return sliceView.worldToCss(crosshair.x, crosshair.y, crosshair.z);
		} catch {
			return null;
		}
	});

	let ro: ResizeObserver | null = null;
	$effect(() => {
		if (!canvasEl) return;
		// Surface the canvas to the parent — parent stores it in $state and the
		// $effect in Viewer3D.svelte then calls wireSliceViews().
		untrack(() => onCanvas(canvasEl!));
		// Set up the resize observer that drives crosshair re-positioning.
		untrack(() => {
			ro = new ResizeObserver(() => (resizeTick++));
			if (canvasEl) ro.observe(canvasEl);
		});
		return () => {
			ro?.disconnect();
			ro = null;
			// Untrack: clearing onCanvas on unmount triggers the parent to drop
			// its ref. Parent's wireSliceViews already guards against this.
			untrack(() => onCanvas(null));
		};
	});

	onDestroy(() => ro?.disconnect());
</script>

<div class="cell" style:border-top-color={axisColor}>
	<div class="header">
		<span class="axis-dot" style:background-color={axisColor}></span>
		<span class="axis-label">{label}</span>
		<span class="slice-num">{worldPos !== null ? `${axisChar} ${worldPos.toFixed(1)} mm` : '—'}</span>
	</div>
	<div class="canvas" bind:this={canvasEl}>
		{#if crosshairPx}
			<div
				class="crosshair-v"
				style:left="{crosshairPx.left}px"
				style:background-color={planeLineColors.v}
				style:box-shadow="0 0 4px {planeLineColors.v}66"
			></div>
			<div
				class="crosshair-h"
				style:top="{crosshairPx.top}px"
				style:background-color={planeLineColors.h}
				style:box-shadow="0 0 4px {planeLineColors.h}66"
			></div>
			<div
				class="crosshair-dot"
				style:left="{crosshairPx.left - 4}px"
				style:top="{crosshairPx.top - 4}px"
				style:background-color={axisColor}
				style:box-shadow="0 0 6px {axisColor}99"
			></div>
		{/if}
		{#if sliceView}
			<div class="orient orient-top">{orient.top}</div>
			<div class="orient orient-bottom">{orient.bottom}</div>
			<div class="orient orient-left">{orient.left}</div>
			<div class="orient orient-right">{orient.right}</div>
		{/if}
	</div>
	<div class="control-row">
		<input
			type="range"
			min={worldMin}
			max={worldMax}
			step={worldStep}
			value={sliderValue}
			disabled={!sliceView || !hasRange}
			oninput={(e) => onChange(parseFloat(e.currentTarget.value))}
			style:accent-color={axisColor}
			aria-label="{label} slice position in millimetres"
		/>
	</div>
</div>

<style>
	.cell {
		display: flex;
		flex-direction: column;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-top-width: 2px;
		border-radius: var(--radius);
		overflow: hidden;
		min-height: 0;
	}
	.header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-fg);
	}
	.axis-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.axis-label {
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--fg);
	}
	.slice-num {
		margin-left: auto;
		font-feature-settings: 'tnum' on, 'lnum' on;
		color: var(--muted-fg);
	}
	.canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		background-color: #07101a;
	}
	.crosshair-v,
	.crosshair-h {
		position: absolute;
		pointer-events: none;
	}
	.crosshair-v {
		top: 0;
		bottom: 0;
		width: 1px;
		transform: translateX(-0.5px);
	}
	.crosshair-h {
		left: 0;
		right: 0;
		height: 1px;
		transform: translateY(-0.5px);
	}
	.crosshair-dot {
		position: absolute;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		pointer-events: none;
	}
	.orient {
		position: absolute;
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(232, 236, 240, 0.55);
		pointer-events: none;
		text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
		user-select: none;
	}
	.orient-top {
		top: 6px;
		left: 50%;
		transform: translateX(-50%);
	}
	.orient-bottom {
		bottom: 6px;
		left: 50%;
		transform: translateX(-50%);
	}
	.orient-left {
		left: 6px;
		top: 50%;
		transform: translateY(-50%);
	}
	.orient-right {
		right: 6px;
		top: 50%;
		transform: translateY(-50%);
	}
	.control-row {
		padding: 6px 10px 8px;
		border-top: 1px solid var(--border);
	}
	input[type='range'] {
		width: 100%;
		height: 4px;
		cursor: pointer;
	}
	input[type='range']:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
