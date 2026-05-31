<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	type LayerKey = 'disease' | 'anatomy' | 'toothNumbers';
	type MaskKey = 'disease' | 'anatomy';

	type Props = {
		layers: { disease: boolean; anatomy: boolean; toothNumbers: boolean };
		masks: { disease: boolean; anatomy: boolean };
		counts: { disease: number; anatomy: number; toothNumbers: number };
		hasMasks: { disease: boolean; anatomy: boolean };
		onToggle: (key: LayerKey) => void;
		onToggleMask: (key: MaskKey) => void;
	};
	let { layers, masks, counts, hasMasks, onToggle, onToggleMask }: Props = $props();

	type Pill = { key: LayerKey; maskKey: MaskKey | null; label: () => string; color: string };
	const pills: Pill[] = [
		{ key: 'disease', maskKey: 'disease', label: () => m.dx_viewer_2d_layer_disease(), color: '#F25C3B' },
		{ key: 'anatomy', maskKey: 'anatomy', label: () => m.dx_viewer_2d_layer_anatomy(), color: '#E8C998' },
		{ key: 'toothNumbers', maskKey: null, label: () => m.dx_viewer_2d_layer_tooth(), color: '#F0C764' }
	];
</script>

<div class="cluster" role="group" aria-label={m.dx_viewer_2d_layers_aria()}>
	{#each pills as p (p.key)}
		<div class="pill-wrap" class:on={layers[p.key]}>
			<button
				type="button"
				class="pill"
				aria-pressed={layers[p.key]}
				onclick={() => onToggle(p.key)}
			>
				<span class="dot" style:background={p.color}></span>
				<span class="label">{p.label()}</span>
				<span class="count">{counts[p.key]}</span>
			</button>
			{#if p.maskKey && hasMasks[p.maskKey]}
				<button
					type="button"
					class="mask-btn"
					class:on={masks[p.maskKey] && layers[p.key]}
					aria-pressed={masks[p.maskKey]}
					aria-label={m.dx_viewer_2d_mask_toggle()}
					title={m.dx_viewer_2d_mask_toggle()}
					disabled={!layers[p.key]}
					onclick={() => p.maskKey && onToggleMask(p.maskKey)}
				>
					M
				</button>
			{/if}
		</div>
	{/each}
</div>

<style>
	.cluster {
		position: absolute;
		top: 12px;
		right: 12px;
		display: inline-flex;
		gap: 6px;
		background: rgba(15, 28, 38, 0.7);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 4px;
		z-index: 5;
	}
	.pill-wrap {
		display: inline-flex;
		border-radius: 999px;
		overflow: hidden;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		background: transparent;
		border: 1px solid transparent;
		color: var(--muted-fg);
		font-size: var(--text-micro);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-family: var(--font-mono);
		cursor: pointer;
		transition: background-color 150ms, color 150ms, border-color 150ms;
		border-radius: 999px 0 0 999px;
	}
	.pill-wrap:has(.mask-btn) .pill {
		border-radius: 999px 0 0 999px;
	}
	.pill-wrap:not(:has(.mask-btn)) .pill {
		border-radius: 999px;
	}
	.pill:hover {
		color: var(--fg);
		background-color: var(--surface-3);
	}
	.pill-wrap.on .pill {
		color: var(--fg);
		background-color: var(--surface-2);
		border-color: var(--border-hover);
	}
	.pill-wrap:not(.on) .dot {
		opacity: 0.4;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: 0 0 auto;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
		transition: opacity 150ms;
	}
	.label {
		white-space: nowrap;
	}
	.count {
		opacity: 0.7;
		font-feature-settings: 'tnum' 1;
	}
	.mask-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		padding: 0 8px;
		background: transparent;
		border: 1px solid transparent;
		border-left: 1px solid var(--border);
		color: var(--muted-fg);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		cursor: pointer;
		transition: color 150ms, background-color 150ms;
		border-radius: 0 999px 999px 0;
	}
	.mask-btn:hover:not(:disabled) {
		color: var(--fg);
		background-color: var(--surface-3);
	}
	.mask-btn.on {
		color: var(--accent);
		background-color: var(--surface-2);
	}
	.mask-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}
	@media (max-width: 680px) {
		.cluster {
			top: 8px;
			right: 8px;
		}
		.pill .label {
			display: none;
		}
	}
</style>
