<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { onDismiss }: { onDismiss?: () => void } = $props();
	let dismissed = $state(false);

	function dismiss() {
		dismissed = true;
		onDismiss?.();
	}
</script>

{#if !dismissed}
	<div class="banner" role="alert">
		<div class="text">
			<strong>{m.dx_viewer_2d_anomaly_title()}</strong>
			<span>{m.dx_viewer_2d_anomaly_body()}</span>
		</div>
		<button type="button" class="close" aria-label={m.dx_viewer_2d_hide()} onclick={dismiss}>
			<svg viewBox="0 0 12 12" width="10" height="10">
				<path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" stroke-width="1.5" />
			</svg>
		</button>
	</div>
{/if}

<style>
	/* Mirrors the 3D panel's `.orient-warning` — faint amber wash + thin border,
	 * never raised. Sits inline between the section eyebrow and the list. */
	.banner {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.5;
		color: rgba(232, 179, 75, 0.92);
		background-color: rgba(232, 179, 75, 0.06);
		border: 1px solid rgba(232, 179, 75, 0.18);
		border-radius: var(--radius);
	}
	.text {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: rgba(232, 179, 75, 0.78);
	}
	.text strong {
		color: rgba(232, 179, 75, 1);
		font-weight: 500;
		font-family: var(--font-sans);
	}
	.close {
		flex-shrink: 0;
		background: transparent;
		border: 0;
		color: rgba(232, 179, 75, 0.55);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-sm);
		margin: -2px -2px 0 0;
		transition: color 150ms, background-color 150ms;
	}
	.close:hover {
		color: rgba(232, 179, 75, 1);
		background-color: rgba(232, 179, 75, 0.08);
	}
</style>
