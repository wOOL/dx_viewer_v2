<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children, padding = '20px' }: { children: Snippet; padding?: string } = $props();
</script>

<div class="bezel card" style:padding>
	{@render children()}
</div>

<style>
	.card {
		background-color: var(--card);
		color: var(--card-fg);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
</style>
