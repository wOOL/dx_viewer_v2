<script lang="ts">
	import { Search, Clock } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { history, type HistoryEntry } from '$lib/stores/history.svelte';
	import { MAX_SEARCH_LENGTH } from '$lib/limits';
	import { modalityLabel } from '$lib/modality';

	interface Props {
		title: string;
		showSearch?: boolean;
		searchValue?: string;
		onSearch?: (q: string) => void;
		extra?: import('svelte').Snippet;
	}

	let { title, showSearch = true, searchValue = $bindable(''), onSearch, extra }: Props = $props();

	function histName(e: HistoryEntry): string {
		return e.patientName || $_('topbar.unknown');
	}

	function handleSearch(e: Event) {
		const v = (e.target as HTMLInputElement).value;
		searchValue = v;
		onSearch?.(v);
	}

	let historyOpen = $state(false);
	let historyBtn = $state<HTMLButtonElement | undefined>(undefined);

	// Escape closes the History popover and returns focus to its trigger (the
	// WAI-ARIA menu idiom + matches the modals' Escape behaviour) — previously it
	// could only be dismissed by clicking the toggle or the backdrop scrim, leaving
	// a keyboard user who'd tabbed into the menu with no key to close it.
	function onWindowKey(e: KeyboardEvent) {
		if (historyOpen && e.key === 'Escape') {
			e.preventDefault();
			historyOpen = false;
			historyBtn?.focus();
		}
	}

	function entryUrl(e: HistoryEntry): string {
		const params = { patientId: e.patientId, studyId: e.studyId };
		if (e.kind === 'cbct') return resolve('/(app)/cbct/[patientId]/[studyId]', params);
		if (e.kind === 'ios') return resolve('/(app)/ios/[patientId]/[studyId]', params);
		return resolve('/(app)/viewer/[patientId]/[studyId]', params);
	}

	function openEntry(e: HistoryEntry) {
		historyOpen = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- entryUrl() returns resolve()-built paths
		goto(entryUrl(e));
	}

	function relTime(ms: number): string {
		const s = Math.round((Date.now() - ms) / 1000);
		if (s < 60) return $_('topbar.justNow');
		const m = Math.round(s / 60);
		if (m < 60) return $_('topbar.minutesAgo', { values: { m } });
		const h = Math.round(m / 60);
		if (h < 24) return $_('topbar.hoursAgo', { values: { h } });
		return $_('topbar.daysAgo', { values: { d: Math.round(h / 24) } });
	}

	// modality strings render via $lib/modality.modalityLabel so they're i18n'd.
</script>

<svelte:window onkeydown={onWindowKey} />

<header class="topbar">
	<!-- Search leads on the left where present (studies); otherwise the page title
	     acts as the header (account / settings / billing / …). The redundant
	     "Dx Viewer" title is gone from the studies bar — the logo already brands it. -->
	{#if showSearch}
		<label class="search">
			<Search size={15} class="search-icon" />
			<input
				type="text"
				maxlength={MAX_SEARCH_LENGTH}
				placeholder={$_('common.search')}
				aria-label={$_('common.search')}
				bind:value={searchValue}
				oninput={handleSearch}
			/>
		</label>
	{:else if title}
		<h1 class="title">{title}</h1>
	{/if}

	<div class="spacer"></div>

	{#if extra}{@render extra()}{/if}

	<div class="hist">
		<button
			type="button"
			class="icon-btn"
			class:on={historyOpen}
			bind:this={historyBtn}
			aria-label={$_('topbar.history')}
			aria-expanded={historyOpen}
			onclick={() => (historyOpen = !historyOpen)}
		>
			<Clock size={17} />
		</button>

		{#if historyOpen}
			<button
				type="button"
				class="scrim"
				aria-label={$_('topbar.closeHistory')}
				onclick={() => (historyOpen = false)}
			></button>
			<div class="menu" role="menu">
				<div class="menu-head">
					<span>{$_('topbar.recentlyViewed')}</span>
					{#if history.entries.length > 0}
						<button type="button" class="clear" onclick={() => history.clear()}
							>{$_('topbar.clear')}</button
						>
					{/if}
				</div>
				{#if history.entries.length === 0}
					<div class="empty">{$_('topbar.noRecent')}</div>
				{:else}
					{#each history.entries as e (e.studyId)}
						<button type="button" class="entry" onclick={() => openEntry(e)}>
							<div class="entry-name">{histName(e)}</div>
							<div class="entry-meta">
								{modalityLabel(e.modality, $_)} · {relTime(e.at)}
							</div>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		height: 56px;
		flex: none;
		padding: 0 1.25rem;
		background: var(--color-bg-0);
		border-bottom: 1px solid var(--color-border);
	}
	.title {
		font-size: 1.05rem;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--color-fg-0);
		margin: 0;
		white-space: nowrap;
	}
	.spacer {
		flex: 1;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 320px;
		max-width: 38vw;
		padding: 0.45rem 0.85rem;
		border-radius: 999px;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		transition: border-color 0.12s;
	}
	.search:focus-within {
		border-color: var(--color-primary);
	}
	.search :global(.search-icon) {
		color: var(--color-fg-2);
		flex: none;
	}
	.search input {
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
		font-size: 0.85rem;
		color: var(--color-fg-0);
	}
	.search input::placeholder {
		color: var(--color-fg-3);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		width: 34px;
		border-radius: var(--radius-control);
		color: var(--color-fg-2);
		transition:
			color 0.12s,
			background 0.12s;
	}
	.icon-btn:hover {
		color: var(--color-fg-0);
		background: var(--color-bg-2);
	}
	.icon-btn.on {
		color: var(--color-fg-0);
		background: var(--color-bg-2);
	}

	.hist {
		position: relative;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 40;
		cursor: default;
	}
	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 8px);
		z-index: 50;
		width: 288px;
		max-height: 70vh;
		overflow: auto;
		padding: 0.35rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
	}
	.menu-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.4rem 0.55rem;
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-fg-2);
	}
	.clear {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 500;
		color: var(--color-fg-2);
		transition: color 0.1s;
	}
	.clear:hover {
		color: var(--color-primary);
	}
	.empty {
		padding: 1rem 0.6rem;
		text-align: center;
		font-size: 0.8rem;
		color: var(--color-fg-2);
	}
	.entry {
		display: block;
		width: 100%;
		padding: 0.5rem 0.55rem;
		border-radius: calc(var(--radius-control) - 2px);
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}
	.entry:hover {
		background: var(--color-bg-2);
	}
	.entry-name {
		font-size: 0.85rem;
		color: var(--color-fg-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.entry-meta {
		font-size: 0.72rem;
		color: var(--color-fg-2);
	}
</style>
