<script lang="ts">
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';

	interface Props {
		/** Current page, 0-based. */
		page: number;
		/** Total number of pages (>= 1). The pager hides itself when this is 1. */
		pageCount: number;
		/** Total item count, for the "N results" hint (optional). */
		total?: number;
		/** Called with the new 0-based page when the user navigates. */
		onpage: (page: number) => void;
	}
	let { page, pageCount, total, onpage }: Props = $props();

	function go(p: number) {
		const next = Math.min(Math.max(0, p), pageCount - 1);
		if (next !== page) onpage(next);
	}
</script>

{#if pageCount > 1}
	<nav class="pager" aria-label={$_('pager.label')}>
		<button
			type="button"
			class="pager-btn"
			disabled={page <= 0}
			onclick={() => go(page - 1)}
			aria-label={$_('pager.prev')}
		>
			<ChevronLeft size={16} />
		</button>
		<span class="pager-status" role="status" aria-live="polite">
			{$_('pager.pageOf', { values: { current: page + 1, total: pageCount } })}
			{#if total != null}<span class="pager-count"
					>· {$_('pager.results', { values: { n: total } })}</span
				>{/if}
		</span>
		<button
			type="button"
			class="pager-btn"
			disabled={page >= pageCount - 1}
			onclick={() => go(page + 1)}
			aria-label={$_('pager.next')}
		>
			<ChevronRight size={16} />
		</button>
	</nav>
{/if}

<style>
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}
	.pager-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		color: var(--color-fg-1);
		cursor: pointer;
		transition:
			background 0.12s,
			border-color 0.12s,
			color 0.12s;
	}
	.pager-btn:hover:not(:disabled) {
		background: var(--color-bg-2);
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.pager-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.pager-status {
		font-size: 0.85rem;
		color: var(--color-fg-2);
		font-variant-numeric: tabular-nums;
	}
	.pager-count {
		color: var(--color-fg-3);
	}
</style>
