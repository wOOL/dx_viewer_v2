<script lang="ts">
	import {
		Crosshair,
		Move,
		Contrast,
		Ruler,
		Spline,
		MapPin,
		Layers,
		Maximize2,
		RotateCcw,
		ToggleLeft,
		ToggleRight,
		LayoutGrid,
		Box,
		SquareStack
	} from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
	import type { CbctStore, CbctTool, LayoutMode } from '@be-certain/imaging-3d/state';

	interface Props {
		store: CbctStore;
		onresetAll?: () => void;
	}
	const { store, onresetAll }: Props = $props();

	function pick(t: CbctTool) {
		store.tool = t;
	}

	// Slab thickness (MIP) — cycle off / thin / medium / thick (half-thickness in voxels).
	const SLAB_STEPS = [0, 3, 6, 10];
	function cycleSlab() {
		const i = SLAB_STEPS.indexOf(store.slabThickness);
		store.slabThickness = SLAB_STEPS[(i + 1) % SLAB_STEPS.length] ?? 0;
	}

	function layout(m: LayoutMode) {
		store.layoutMode = m;
	}
</script>

<aside class="flex w-12 shrink-0 flex-col items-center border-r border-border bg-bg-1 py-2">
	<!-- Layout switcher group -->
	<div class="flex flex-col items-center">
		<button
			class="rail-btn"
			class:active={store.layoutMode === 'mpr'}
			aria-pressed={store.layoutMode === 'mpr'}
			onclick={() => layout('mpr')}
			title={$_('cbct.layoutMpr')}
			aria-label={$_('cbct.layoutMpr')}
		>
			<LayoutGrid size={15} />
		</button>
		<button
			class="rail-btn"
			class:active={store.layoutMode === 'volume'}
			aria-pressed={store.layoutMode === 'volume'}
			onclick={() => layout('volume')}
			title={$_('cbct.layoutVolume')}
			aria-label={$_('cbct.layoutVolume')}
		>
			<Box size={15} />
		</button>
		<button
			class="rail-btn"
			class:active={store.layoutMode === 'panoramic'}
			aria-pressed={store.layoutMode === 'panoramic'}
			onclick={() => layout('panoramic')}
			title={$_('cbct.layoutPanoramic')}
			aria-label={$_('cbct.layoutPanoramic')}
		>
			<Spline size={15} />
		</button>
	</div>

	<!-- Slice tools act on the MPR panes, so they only appear in the MPR layout. The
	     3D view has its own orbit + orientation gizmo, and the Panoramic view carries
	     its own tool column (pan / ruler / slab / fit / overlays) — showing these here
	     in those layouts presented inert, duplicate-looking tools (e.g. two rulers). -->
	{#if store.layoutMode === 'mpr'}
		<div class="my-2 h-px w-6 bg-border"></div>

		<!-- Tool group -->
		<div class="flex flex-col items-center">
			<button
				class="rail-btn"
				class:active={store.tool === 'crosshair'}
				aria-pressed={store.tool === 'crosshair'}
				onclick={() => pick('crosshair')}
				title={$_('cbct.crosshairTool')}
				aria-label={$_('cbct.crosshairTool')}
			>
				<Crosshair size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.tool === 'pan'}
				aria-pressed={store.tool === 'pan'}
				onclick={() => pick('pan')}
				title={$_('cbct.pan')}
				aria-label={$_('cbct.pan')}
			>
				<Move size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.tool === 'wl'}
				aria-pressed={store.tool === 'wl'}
				onclick={() => pick('wl')}
				title={$_('cbct.windowLevel')}
				aria-label={$_('cbct.windowLevel')}
			>
				<Contrast size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.tool === 'measure'}
				aria-pressed={store.tool === 'measure'}
				onclick={() => pick('measure')}
				title={$_('cbct.linearMeasurement')}
				aria-label={$_('cbct.linearMeasurement')}
			>
				<Ruler size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.tool === 'angle'}
				aria-pressed={store.tool === 'angle'}
				onclick={() => pick('angle')}
				title={$_('cbct.angleMeasurement')}
				aria-label={$_('cbct.angleMeasurement')}
			>
				<Maximize2 size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.tool === 'annotate'}
				aria-pressed={store.tool === 'annotate'}
				onclick={() => pick('annotate')}
				title={$_('cbct.annotation')}
				aria-label={$_('cbct.annotation')}
			>
				<MapPin size={16} />
			</button>
			<button
				class="rail-btn"
				class:active={store.slabThickness > 0}
				aria-pressed={store.slabThickness > 0}
				onclick={cycleSlab}
				title={store.slabThickness > 0
					? $_('cbct.slabOn', { values: { n: store.slabThickness * 2 + 1 } })
					: $_('cbct.slabOff')}
				aria-label={$_('cbct.slabThickness')}
			>
				<SquareStack size={16} />
			</button>
		</div>
	{/if}

	<div class="my-2 h-px w-6 bg-border"></div>

	<!-- Misc -->
	<div class="flex flex-col items-center">
		{#if store.layoutMode === 'mpr'}
			<button
				class="rail-btn"
				aria-pressed={store.crosshair}
				onclick={() => (store.crosshair = !store.crosshair)}
				title={$_('cbct.toggleCrosshair')}
				aria-label={$_('cbct.toggleCrosshair')}
			>
				{#if store.crosshair}
					<ToggleRight size={16} />
				{:else}
					<ToggleLeft size={16} />
				{/if}
			</button>
			<button
				class="rail-btn"
				onclick={() => store.resetWL()}
				title={$_('cbct.resetWindowLevel')}
				aria-label={$_('cbct.resetWindowLevel')}
			>
				<Layers size={16} />
			</button>
		{/if}
		<button
			class="rail-btn"
			onclick={() => onresetAll?.()}
			title={$_('cbct.resetAll')}
			aria-label={$_('cbct.resetAll')}
		>
			<RotateCcw size={16} />
		</button>
	</div>
</aside>

<style>
	.rail-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 0.35rem;
		color: var(--color-fg-2);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.rail-btn:hover {
		background: var(--color-bg-2);
		color: var(--color-fg-0);
	}
	.rail-btn.active {
		background: var(--color-primary);
		color: var(--color-bg-0);
	}
</style>
