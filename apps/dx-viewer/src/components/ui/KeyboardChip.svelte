<script lang="ts">
	let { key }: { key: string } = $props();
</script>

<kbd>{key}</kbd>

<style>
	kbd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px 6px;
		border-radius: 4px;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: var(--fs-micro);
		color: var(--muted-fg);
		min-width: 18px;
	}
</style>
