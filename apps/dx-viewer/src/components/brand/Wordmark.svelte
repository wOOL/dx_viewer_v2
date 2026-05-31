<script lang="ts">
	type Props = {
		size?: 'sm' | 'md' | 'lg';
		variant?: 'full' | 'icon';
	};
	let { size = 'md', variant = 'full' }: Props = $props();

	const sizeMap = {
		sm: { full: 110, icon: 28 },
		md: { full: 160, icon: 36 },
		lg: { full: 220, icon: 48 }
	} as const;

	const src = $derived(variant === 'icon' ? '/brand/logo-icon.png' : '/brand/logo-full.png');
	const width = $derived(sizeMap[size][variant]);
</script>

<img
	{src}
	alt="BeCertain"
	{width}
	height={variant === 'icon' ? width : undefined}
	class="wordmark"
	data-variant={variant}
	draggable="false"
/>

<style>
	.wordmark {
		display: block;
		user-select: none;
		-webkit-user-drag: none;
	}
	.wordmark[data-variant='icon'] {
		border-radius: 8px;
		aspect-ratio: 1 / 1;
	}
</style>
