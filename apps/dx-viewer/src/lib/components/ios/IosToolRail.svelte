<script lang="ts">
	import {
		RotateCcw,
		Grid3X3,
		Camera,
		Ruler,
		Eraser,
		ChevronDown,
		ChevronUp,
		ChevronRight,
		ChevronLeft,
		ArrowUpFromLine,
		ArrowDownFromLine
	} from 'lucide-svelte';
	import { _ } from 'svelte-i18n';

	interface Props {
		wireframe: boolean;
		measureMode?: boolean;
		hasMeasurements?: boolean;
		onreset?: () => void;
		onwireframe?: () => void;
		onorient?: (v: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom') => void;
		onscreenshot?: () => void;
		onmeasure?: () => void;
		onclearmeasure?: () => void;
	}
	const {
		wireframe,
		measureMode = false,
		hasMeasurements = false,
		onreset,
		onwireframe,
		onorient,
		onscreenshot,
		onmeasure,
		onclearmeasure
	}: Props = $props();
</script>

<aside class="flex w-12 shrink-0 flex-col items-center border-r border-border bg-bg-1 py-2">
	<div class="flex flex-col items-center">
		<button
			class="rail-btn"
			onclick={() => onorient?.('front')}
			title={$_('ios.anteriorView')}
			aria-label={$_('ios.anteriorView')}
		>
			<ChevronUp size={15} />
		</button>
		<button
			class="rail-btn"
			onclick={() => onorient?.('back')}
			title={$_('ios.posteriorView')}
			aria-label={$_('ios.posteriorView')}
		>
			<ChevronDown size={15} />
		</button>
		<button
			class="rail-btn"
			onclick={() => onorient?.('right')}
			title={$_('ios.rightBuccal')}
			aria-label={$_('ios.rightBuccal')}
		>
			<ChevronRight size={15} />
		</button>
		<button
			class="rail-btn"
			onclick={() => onorient?.('left')}
			title={$_('ios.leftBuccal')}
			aria-label={$_('ios.leftBuccal')}
		>
			<ChevronLeft size={15} />
		</button>
		<button
			class="rail-btn"
			onclick={() => onorient?.('top')}
			title={$_('ios.occlusalUpper')}
			aria-label={$_('ios.occlusalUpper')}
		>
			<ArrowDownFromLine size={15} />
		</button>
		<button
			class="rail-btn"
			onclick={() => onorient?.('bottom')}
			title={$_('ios.occlusalLower')}
			aria-label={$_('ios.occlusalLower')}
		>
			<ArrowUpFromLine size={15} />
		</button>
	</div>
	<div class="my-2 h-px w-6 bg-border"></div>
	<div class="flex flex-col items-center">
		<button
			class="rail-btn"
			class:active={wireframe}
			aria-pressed={wireframe}
			onclick={() => onwireframe?.()}
			title={$_('ios.wireframe')}
			aria-label={$_('ios.wireframe')}
		>
			<Grid3X3 size={15} />
		</button>
		<button
			class="rail-btn"
			class:active={measureMode}
			aria-pressed={measureMode}
			onclick={() => onmeasure?.()}
			title={$_('ios.measure')}
			aria-label={$_('ios.measure')}
		>
			<Ruler size={15} />
		</button>
		{#if hasMeasurements}
			<button
				class="rail-btn"
				onclick={() => onclearmeasure?.()}
				title={$_('ios.clearMeasurements')}
				aria-label={$_('ios.clearMeasurements')}
			>
				<Eraser size={15} />
			</button>
		{/if}
		<button
			class="rail-btn"
			onclick={() => onscreenshot?.()}
			title={$_('ios.screenshot')}
			aria-label={$_('ios.screenshot')}
		>
			<Camera size={15} />
		</button>
	</div>
	<div class="my-2 h-px w-6 bg-border"></div>
	<div class="flex flex-col items-center">
		<button
			class="rail-btn"
			onclick={() => onreset?.()}
			title={$_('ios.resetView')}
			aria-label={$_('ios.resetView')}
		>
			<RotateCcw size={15} />
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
