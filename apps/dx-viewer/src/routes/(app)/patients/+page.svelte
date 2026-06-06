<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import PatientCard from '$lib/components/PatientCard.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import { studies } from '$lib/stores/studies.svelte';
	import { Upload, RefreshCw, SearchX, Plus } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { _, locale } from 'svelte-i18n';
	import { buildPatientSearchIndex, filterPatientsByQuery } from '$lib/patientSearch';
	import { paginate } from '$lib/pagination';

	// The full patient list (the old dashboard grid). The home dashboard links here via
	// "View All" + the search bar (with ?q=), and the sidebar "Patients" nav.
	let search = $state(page.url.searchParams.get('q') ?? '');
	let loadError = $state(false);
	let loading = $state(true);

	async function load() {
		loading = true;
		loadError = false;
		try {
			await studies.refresh();
		} catch {
			loadError = true;
		} finally {
			loading = false;
		}
	}
	onMount(load);

	const searchIndex = $derived(buildPatientSearchIndex(studies.patients, $locale ?? undefined));
	const filtered = $derived(filterPatientsByQuery(searchIndex, search));

	const PAGE_SIZE = 24;
	let pageNum = $state(0);
	let lastSearch = $state('');
	$effect(() => {
		if (search !== lastSearch) {
			lastSearch = search;
			pageNum = 0;
		}
	});
	const paged = $derived(paginate(filtered, pageNum, PAGE_SIZE));
</script>

<TopBar title={$_('nav.patients')} bind:searchValue={search} />

<main class="flex-1 overflow-y-auto px-8 py-7">
	<div class="mb-6 flex items-center justify-between">
		<h2 class="text-xl font-bold text-fg-0">{$_('nav.patients')}</h2>
		<a href={resolve('/(app)/upload')} class="btn-primary">
			<Upload size={15} />
			{$_('common.newStudy')}
		</a>
	</div>

	{#if loadError && studies.patients.length === 0}
		<div class="empty-state">
			<div class="empty-icon"><RefreshCw size={28} class="text-fg-2" /></div>
			<div class="text-center">
				<h3 class="text-lg font-semibold text-fg-0">{$_('studies.loadErrorTitle')}</h3>
				<p class="mt-1 text-sm text-fg-2">{$_('studies.loadErrorDesc')}</p>
			</div>
			<button class="btn-primary" onclick={load}
				><RefreshCw size={15} /> {$_('common.retry')}</button
			>
		</div>
	{:else if loading && studies.patients.length === 0}
		<div class="empty-state">
			<div class="empty-icon"><RefreshCw size={28} class="animate-spin text-fg-2" /></div>
			<div class="text-center">
				<h3 class="text-lg font-semibold text-fg-0">{$_('studies.loadingTitle')}</h3>
			</div>
		</div>
	{:else if studies.patients.length === 0}
		<div class="empty-state">
			<div class="empty-icon"><Plus size={28} class="text-fg-2" /></div>
			<div class="text-center">
				<h3 class="text-lg font-semibold text-fg-0">{$_('studies.emptyTitle')}</h3>
				<p class="mt-1 text-sm text-fg-2">{$_('studies.emptyDesc')}</p>
			</div>
			<a href={resolve('/(app)/upload')} class="btn-primary">
				<Upload size={15} />
				{$_('studies.uploadFirst')}
			</a>
		</div>
	{:else if filtered.length === 0}
		<div class="empty-state">
			<div class="empty-icon"><SearchX size={28} class="text-fg-2" /></div>
			<div class="text-center">
				<h3 class="text-lg font-semibold text-fg-0">{$_('studies.noMatchTitle')}</h3>
				<p class="mt-1 text-sm text-fg-2">{$_('studies.noMatchDesc', { values: { q: search } })}</p>
			</div>
			<button class="btn-primary" onclick={() => (search = '')}>{$_('common.clearSearch')}</button>
		</div>
	{:else}
		<div
			class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5"
		>
			{#each paged.items as patient (patient.id)}
				<PatientCard {patient} />
			{/each}
		</div>
		<Pager
			page={paged.page}
			pageCount={paged.pageCount}
			total={paged.total}
			onpage={(p) => (pageNum = p)}
		/>
	{/if}
</main>

<style>
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.85rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover {
		background: var(--color-primary-hover);
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 5rem 1rem;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius-card);
		background: var(--color-bg-1);
	}
	.empty-icon {
		border-radius: 999px;
		background: var(--color-bg-2);
		padding: 1rem;
	}
</style>
