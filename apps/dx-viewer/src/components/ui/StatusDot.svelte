<script lang="ts">
	let { color = 'var(--primary)', size = 6, pulsing = true }: { color?: string; size?: number; pulsing?: boolean } = $props();
</script>

<span
	class="dot"
	class:pulsing
	style:width="{size}px"
	style:height="{size}px"
	style:background-color={color}
></span>

<style>
	.dot {
		display: inline-block;
		border-radius: 9999px;
		flex-shrink: 0;
	}
	.dot.pulsing {
		animation: pulse-subtle 2s ease-in-out infinite;
	}
</style>
