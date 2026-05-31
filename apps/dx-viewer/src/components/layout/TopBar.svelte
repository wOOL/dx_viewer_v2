<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		/** Localised analysis-type crumb shown after "Dx Viewer". */
		mode: string;
		/** File or scan name shown as the active crumb. Null hides the segment. */
		fileName: string | null;
		onBack: () => void;
		/** Right-aligned action area. Each viewer plugs in its own buttons. */
		actions?: Snippet;
	};
	let { mode, fileName, onBack, actions }: Props = $props();

	let isMobile = $state(false);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const mq = window.matchMedia('(max-width: 880px)');
		const update = () => (isMobile = mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});
</script>

<header class="top-bar" class:mobile={isMobile}>
	<div class="breadcrumbs">
		<button
			type="button"
			class="back-btn"
			onclick={onBack}
			title="Back to dashboard"
			aria-label="Back to dashboard"
		>
			<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M10 13L5 8l5-5" />
			</svg>
		</button>
		{#if isMobile}
			<span class="crumb-active">{fileName ?? mode}</span>
		{:else}
			<span class="crumb">Dx Viewer</span>
			<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="chev" aria-hidden="true">
				<path d="M6 4l4 4-4 4" />
			</svg>
			<span class="crumb">{mode}</span>
			{#if fileName}
				<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="chev" aria-hidden="true">
					<path d="M6 4l4 4-4 4" />
				</svg>
				<span class="crumb-active" title={fileName}>{fileName}</span>
			{/if}
		{/if}
	</div>

	{#if actions}
		<div class="actions">
			{@render actions()}
		</div>
	{/if}
</header>

<style>
	.top-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		min-height: 60px;
		border-bottom: 1px solid var(--border);
		background-color: var(--bg);
		flex-shrink: 0;
		gap: 12px;
	}
	.top-bar.mobile {
		padding: 10px 14px;
		min-height: 52px;
	}
	.breadcrumbs {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
	}
	.back-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: var(--radius);
		color: var(--fg);
		cursor: pointer;
		transition: background-color 150ms;
		flex-shrink: 0;
	}
	.back-btn:hover {
		background-color: var(--surface-2);
	}
	.crumb {
		font-size: 13px;
		color: var(--muted-fg);
		white-space: nowrap;
	}
	.crumb-active {
		font-size: 13px;
		color: var(--fg);
		font-family: var(--font-mono);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.chev {
		color: var(--text-tertiary, rgba(232, 236, 240, 0.4));
		flex-shrink: 0;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.top-bar.mobile .actions {
		gap: 6px;
	}
</style>
