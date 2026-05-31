<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		description?: string;
		children: Snippet;
		footer?: Snippet;
	};
	let { title, description, children, footer }: Props = $props();
</script>

<section class="section">
	<header>
		<h2>{title}</h2>
		{#if description}<p class="description">{description}</p>{/if}
	</header>

	<div class="body">
		{@render children()}
	</div>

	{#if footer}
		<div class="footer">
			{@render footer()}
		</div>
	{/if}
</section>

<style>
	.section {
		position: relative;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 28px 32px 24px;
		display: flex;
		flex-direction: column;
		gap: 22px;
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.03) inset,
			0 1px 2px rgba(0, 0, 0, 0.15),
			0 6px 24px -8px rgba(0, 0, 0, 0.3);
	}
	/* Subtle gold accent strip on the leading edge — quiet but characterful. */
	.section::before {
		content: '';
		position: absolute;
		top: 32px;
		bottom: 32px;
		left: -1px;
		width: 2px;
		border-radius: 0 2px 2px 0;
		background: linear-gradient(180deg, transparent, rgba(240, 199, 100, 0.45), transparent);
		opacity: 0.6;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--fg);
	}
	.description {
		margin: 0;
		font-size: 13px;
		color: var(--muted-fg);
		line-height: 1.55;
		max-width: 60ch;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.footer {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		flex-wrap: wrap;
		align-items: center;
		padding-top: 18px;
		border-top: 1px solid var(--border);
	}

	@media (max-width: 640px) {
		.section {
			padding: 22px 22px 18px;
		}
	}
</style>
