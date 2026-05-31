<script lang="ts">
	type Props = {
		tone?: 'positive' | 'neutral' | 'warning' | 'critical';
		label: string;
	};
	let { tone = 'neutral', label }: Props = $props();
</script>

<span class="badge" data-tone={tone}>
	<span class="dot"></span>
	{label}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		font-weight: 500;
		color: var(--fg);
		letter-spacing: -0.005em;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: currentColor;
		flex-shrink: 0;
		box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 18%, transparent);
	}
	.badge[data-tone='positive'] .dot {
		color: #5dd4c9;
	}
	.badge[data-tone='warning'] .dot {
		color: var(--accent);
	}
	.badge[data-tone='critical'] .dot {
		color: #e87b9f;
	}
	.badge[data-tone='neutral'] .dot {
		color: var(--muted-fg);
	}
</style>
