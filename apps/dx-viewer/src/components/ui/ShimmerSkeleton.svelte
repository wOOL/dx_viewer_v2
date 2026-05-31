<script lang="ts">
	let { progress, label }: { progress?: number; label?: string } = $props();
</script>

<div class="shimmer">
	<div class="bar" style:width="{progress !== undefined ? Math.round(progress * 100) : 35}%"></div>
	{#if label}<p class="label">{label}</p>{/if}
</div>

<style>
	.shimmer {
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
		padding: 24px;
	}
	.bar {
		height: 4px;
		max-width: 320px;
		min-width: 64px;
		background: linear-gradient(90deg, var(--surface-2), var(--accent), var(--surface-2));
		background-size: 200% 100%;
		border-radius: 2px;
		animation: shimmer 1.6s linear infinite;
	}
	.label {
		font-size: var(--fs-small);
		color: var(--muted-fg);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	@keyframes shimmer {
		0% { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}
</style>
