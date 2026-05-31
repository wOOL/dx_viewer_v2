<script lang="ts" module>
	export type ImageAdjust = { brightness: number; contrast: number; invert: number };
	export const DEFAULT_ADJUST: ImageAdjust = { brightness: 1, contrast: 1, invert: 0 };

	/** CSS `filter` string to apply to the <img> element. */
	export function adjustFilter(a: ImageAdjust): string {
		return `brightness(${a.brightness}) contrast(${a.contrast}) invert(${a.invert})`;
	}
</script>

<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	type Props = {
		adjust: ImageAdjust;
		threshold: number;
		onAdjust: (next: ImageAdjust) => void;
		onThreshold: (next: number) => void;
		onReset: () => void;
	};
	let { adjust, threshold, onAdjust, onThreshold, onReset }: Props = $props();

	let open = $state(false);

	const isAdjusted = $derived(
		adjust.brightness !== 1 || adjust.contrast !== 1 || adjust.invert !== 0 || threshold !== 0.5
	);

	function setField<K extends keyof ImageAdjust>(key: K, value: number) {
		onAdjust({ ...adjust, [key]: value });
	}

	const fmtMul = (v: number) => `${v.toFixed(2)}×`;
	const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<div class="cluster" class:open>
	<button
		type="button"
		class="head"
		aria-expanded={open}
		onclick={() => (open = !open)}
		title={m.dx_viewer_2d_adjust_title()}
	>
		<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
			<circle cx="8" cy="8" r="3" />
			<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
		</svg>
		<span class="label">{m.dx_viewer_2d_adjust_title()}</span>
		{#if isAdjusted}
			<span class="dot" aria-hidden="true"></span>
		{/if}
	</button>

	{#if open}
		<div class="body">
			{@render slider(m.dx_viewer_2d_adjust_brightness(), 0.5, 1.5, 0.01, adjust.brightness, (v) => setField('brightness', v), fmtMul(adjust.brightness))}
			{@render slider(m.dx_viewer_2d_adjust_contrast(), 0.5, 1.5, 0.01, adjust.contrast, (v) => setField('contrast', v), fmtMul(adjust.contrast))}
			{@render slider(m.dx_viewer_2d_adjust_invert(), 0, 1, 0.05, adjust.invert, (v) => setField('invert', v), fmtPct(adjust.invert))}
			<div class="divider"></div>
			{@render slider(m.dx_viewer_2d_adjust_threshold(), 0, 1, 0.01, threshold, onThreshold, fmtPct(threshold))}
			<button type="button" class="reset" onclick={onReset}>
				{m.dx_viewer_2d_adjust_reset()}
			</button>
		</div>
	{/if}
</div>

{#snippet slider(
	label: string,
	min: number,
	max: number,
	step: number,
	value: number,
	onInput: (v: number) => void,
	display: string
)}
	<label class="slider-row">
		<span class="slider-label">{label}</span>
		<input
			type="range"
			{min}
			{max}
			{step}
			{value}
			oninput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
		/>
		<span class="slider-value">{display}</span>
	</label>
{/snippet}

<style>
	.cluster {
		position: absolute;
		bottom: 12px;
		left: 12px;
		z-index: 5;
		background: rgba(15, 28, 38, 0.7);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		min-width: 44px;
		transition: min-width 200ms ease-out;
	}
	.cluster.open {
		min-width: 280px;
	}
	.head {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 10px;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		border-radius: var(--radius-lg);
		transition: color 150ms;
	}
	.head:hover {
		color: var(--fg);
	}
	.cluster.open .head {
		color: var(--fg);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		border-bottom: 1px solid var(--border);
	}
	.label {
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		flex: 0 0 auto;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
	}
	.slider-row {
		display: grid;
		grid-template-columns: 80px 1fr 44px;
		align-items: center;
		gap: 10px;
		font-size: var(--text-micro);
		color: var(--muted-fg);
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.slider-label {
		white-space: nowrap;
	}
	.slider-value {
		text-align: right;
		color: var(--fg);
		font-feature-settings: 'tnum' 1;
	}
	.slider-row input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}
	.divider {
		height: 1px;
		background: var(--border);
		margin: 2px 0;
	}
	.reset {
		align-self: flex-end;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--muted-fg);
		font-size: var(--text-micro);
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 4px 10px;
		border-radius: var(--radius);
		cursor: pointer;
		transition: color 150ms, border-color 150ms;
	}
	.reset:hover {
		color: var(--fg);
		border-color: var(--border-hover);
	}
	@media (max-width: 680px) {
		.cluster {
			bottom: 8px;
			left: 8px;
		}
		.cluster.open {
			min-width: 240px;
		}
	}
</style>
