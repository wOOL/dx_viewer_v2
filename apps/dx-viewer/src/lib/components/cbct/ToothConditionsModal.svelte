<script lang="ts">
	import { X, Search } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
	import { toothDisplay } from '$lib/constants';
	import { foldDiacritics } from '$lib/patients';
	import { focusTrap } from '$lib/focusTrap';
	import { MAX_SEARCH_LENGTH } from '$lib/limits';

	interface Condition {
		name: string;
		// Optional: a CBCT "Missing tooth (segmentation gap)" finding is a DETERMINISTIC
		// geometry derivation, not an AI detection — it has no model confidence. Showing a
		// fabricated % for it (the callers used to default to 0 or 0.9, so the SAME finding
		// read "0%" via the 3D mesh and "90%" via the report) misrepresents the AI. The pill
		// renders only when a real confidence is present (mirrors ToothDetailCard).
		confidence?: number;
		category?: 'periodontal' | 'restorative' | 'endo';
		included?: boolean;
	}

	interface Props {
		tooth: number;
		conditions: Condition[];
		anatomy?: { roots?: number; canals?: number };
		open: boolean;
		onclose?: () => void;
	}
	const { tooth, conditions = [], anatomy = {}, open, onclose }: Props = $props();

	let mode = $state<'category' | 'alphabetical'>('category');
	let query = $state('');

	const filtered = $derived(
		conditions.filter((c) => {
			const q = foldDiacritics(query);
			return !q || foldDiacritics(c.name).includes(q);
		})
	);
	const grouped = $derived.by(() => {
		const g: Record<string, Condition[]> = {
			periodontal: [],
			restorative: [],
			endo: [],
			other: []
		};
		for (const c of filtered) {
			const key = c.category && c.category in g ? c.category : 'other';
			g[key].push(c);
		}
		return g;
	});
	const sorted = $derived([...filtered].sort((a, b) => a.name.localeCompare(b.name)));

	function pillClass(conf: number) {
		if (conf >= 0.9) return 'bg-danger-500';
		if (conf >= 0.5) return 'bg-warning-500';
		return 'bg-fg-3';
	}

	// Close on Escape, consistent with the other viewer modals.
	function onWindowKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onclose?.();
	}
</script>

<svelte:window onkeydown={onWindowKey} />

{#if open}
	<!-- Backdrop as a button (a11y-clean click-to-close), matching PaywallModal. -->
	<button
		class="fixed inset-0 z-50 bg-bg-0/70 backdrop-blur-sm"
		onclick={onclose}
		aria-label={$_('cbct.closeConditions')}
	></button>
	<div
		use:focusTrap
		class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
		role="dialog"
		aria-modal="true"
		aria-label={$_('cbct.toothConditions', { values: { n: toothDisplay(tooth) } })}
		tabindex="-1"
	>
		<div
			class="pointer-events-auto flex max-h-[80vh] w-[520px] flex-col rounded-xl border border-border bg-bg-1 shadow-2xl"
		>
			<div class="flex items-center justify-between border-b border-border px-5 py-3">
				<h2 class="text-base font-semibold text-fg-0">
					{$_('cbct.toothConditions', { values: { n: toothDisplay(tooth) } })}
				</h2>
				<button class="text-fg-2 hover:text-fg-0" onclick={onclose} aria-label={$_('common.close')}>
					<X size={18} />
				</button>
			</div>

			<div class="flex items-center gap-2 border-b border-border px-5 py-2">
				<button
					class="rounded px-2 py-1 text-xs {mode === 'category'
						? 'bg-primary text-bg-0'
						: 'text-fg-2 hover:text-fg-0'}"
					onclick={() => (mode = 'category')}
				>
					{$_('cbct.category')}
				</button>
				<button
					class="rounded px-2 py-1 text-xs {mode === 'alphabetical'
						? 'bg-primary text-bg-0'
						: 'text-fg-2 hover:text-fg-0'}"
					onclick={() => (mode = 'alphabetical')}
				>
					{$_('cbct.alphabetically')}
				</button>
			</div>

			<div class="px-5 pt-3">
				<div
					class="flex items-center gap-2 rounded-md border border-border bg-bg-2 px-2 py-1.5 focus-within:border-primary"
				>
					<Search size={14} class="text-fg-2" />
					<input
						type="text"
						maxlength={MAX_SEARCH_LENGTH}
						placeholder={$_('common.search')}
						bind:value={query}
						class="w-full bg-transparent text-xs text-fg-0 outline-none placeholder:text-fg-2"
					/>
				</div>
			</div>

			{#if anatomy.roots || anatomy.canals}
				<div class="px-5 pt-2 text-xs text-fg-2">
					{#if anatomy.roots}<span class="mr-3"
							>{$_('cbct.rootCount', { values: { n: anatomy.roots } })}</span
						>{/if}
					{#if anatomy.canals}<span>{$_('cbct.canalCount', { values: { n: anatomy.canals } })}</span
						>{/if}
				</div>
			{/if}

			<div class="flex-1 overflow-y-auto px-5 py-2">
				{#if mode === 'alphabetical'}
					<ul class="flex flex-col gap-1 text-xs">
						{#each sorted as c, i (i)}
							<li class="flex items-center justify-between gap-2 rounded-md bg-bg-2/40 px-2 py-1.5">
								<span class="text-fg-1">{c.name}</span>
								{#if typeof c.confidence === 'number'}
									<span
										class="rounded-sm px-1.5 py-0.5 text-[10px] text-bg-0 {pillClass(c.confidence)}"
									>
										{Math.round(c.confidence * 100)}%
									</span>
								{/if}
							</li>
						{:else}
							<li class="text-fg-2 text-xs">{$_('cbct.noConditionsMatch')}</li>
						{/each}
					</ul>
				{:else}
					{@const g = grouped}
					{#each ['periodontal', 'restorative', 'endo', 'other'] as cat (cat)}
						{#if g[cat] && g[cat].length > 0}
							<div class="mb-3">
								<div class="mb-1 text-[10px] font-semibold tracking-wider text-fg-2 uppercase">
									{$_('cbct.cat_' + cat)}
								</div>
								<ul class="flex flex-col gap-1 text-xs">
									{#each g[cat] as c, i (i)}
										<li
											class="flex items-center justify-between gap-2 rounded-md bg-bg-2/40 px-2 py-1.5"
										>
											<span class="text-fg-1">{c.name}</span>
											{#if typeof c.confidence === 'number'}
												<span
													class="rounded-sm px-1.5 py-0.5 text-[10px] text-bg-0 {pillClass(
														c.confidence
													)}"
												>
													{Math.round(c.confidence * 100)}%
												</span>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.checkbox {
		accent-color: var(--color-primary);
	}
</style>
