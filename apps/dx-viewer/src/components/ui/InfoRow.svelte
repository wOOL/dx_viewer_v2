<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = {
		label: string;
		value?: string;
		children?: Snippet;
	};
	let { label, value, children }: Props = $props();
</script>

<div class="row">
	<span class="label">{label}</span>
	<span class="value">
		{#if children}{@render children()}{:else}{value ?? '—'}{/if}
	</span>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 16px;
		padding: 12px 0;
		border-bottom: 1px solid rgba(240, 199, 100, 0.06);
		align-items: center;
	}
	.row:last-child {
		border-bottom: none;
	}
	.label {
		font-size: 13px;
		color: var(--muted-fg);
	}
	.value {
		font-size: 14px;
		color: var(--fg);
		text-align: right;
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
</style>
