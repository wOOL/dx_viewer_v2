<script lang="ts">
	import { studies } from '$lib/stores/studies.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { computeMetrics, recentPatients } from '$lib/dashboard';
	import { buildPatientSearchIndex, filterPatientsByQuery } from '$lib/patientSearch';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { _, locale } from 'svelte-i18n';
	import {
		UploadCloud,
		Search,
		UserPlus,
		ArrowRight,
		Users,
		Activity,
		ClipboardList,
		FileText,
		RefreshCw
	} from 'lucide-svelte';

	// The redesigned home dashboard. The visual focal point is the X-Ray drop/upload
	// zone; the two next-most-important actions are "Create a New Patient" and patient
	// search. "Recent Analyses" caps at 3 (→ View All), and a small Metrics Dashboard
	// summarises the account. The full patient grid lives at /patients.
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

	const loadingNoData = $derived(loading && studies.patients.length === 0);
	const errorNoData = $derived(loadError && studies.patients.length === 0);

	const greeting = $derived(
		auth.user?.name
			? $_('dashboard.welcome', { values: { name: auth.user.name } })
			: $_('dashboard.welcomeFallback')
	);

	const metrics = $derived(computeMetrics(studies.patients, Date.now()));
	const recent = $derived(recentPatients(studies.patients, 3));
	const metricCards = $derived([
		{
			key: 'totalPatients',
			icon: Users,
			value: metrics.totalPatients,
			label: $_('dashboard.totalPatients')
		},
		{
			key: 'analysesThisWeek',
			icon: Activity,
			value: metrics.analysesThisWeek,
			label: $_('dashboard.analysesThisWeek')
		},
		{
			key: 'totalAnalyses',
			icon: ClipboardList,
			value: metrics.totalAnalyses,
			label: $_('dashboard.totalAnalyses')
		}
	]);

	// Quick-jump patient search (a dropdown of matches; Enter / "See all" → /patients).
	let search = $state('');
	let searchOpen = $state(false);
	let searchWrap = $state<HTMLElement | null>(null);
	const searchIndex = $derived(buildPatientSearchIndex(studies.patients, $locale ?? undefined));
	const matches = $derived(
		search.trim() ? filterPatientsByQuery(searchIndex, search).slice(0, 6) : []
	);

	function onWindowClick(e: MouseEvent) {
		if (searchWrap && !searchWrap.contains(e.target as Node)) searchOpen = false;
	}
	function goAllResults() {
		const q = search.trim();
		searchOpen = false;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()-built path + query string (resolve can't carry queries)
		goto(resolve('/(app)/patients') + (q ? `?q=${encodeURIComponent(q)}` : ''));
	}
	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			goAllResults();
		} else if (e.key === 'Escape') {
			searchOpen = false;
		}
	}

	// "Drop or Upload X-Rays" → pick a file and hand it to the global quick-analyze flow
	// (drag-drop anywhere is already handled by GlobalDropZone). Same flow either way.
	let fileInput = $state<HTMLInputElement | null>(null);
	function openPicker() {
		fileInput?.click();
	}
	function onFilePicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) window.dispatchEvent(new CustomEvent('dxv:quick-analyze', { detail: file }));
		input.value = ''; // let the same file be re-picked
	}

	function fmtDate(iso?: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString($locale ?? undefined);
	}
</script>

<svelte:window onclick={onWindowClick} />

<main class="flex-1 overflow-y-auto px-8 py-8">
	<div class="mx-auto max-w-6xl">
		<!-- Welcome + create-patient -->
		<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
			<h1 class="text-2xl font-bold text-fg-0">{greeting}</h1>
			<a href={resolve('/(app)/upload')} class="create-btn" data-testid="dash-create-patient">
				<UserPlus size={15} />
				{$_('dashboard.createPatient')}
			</a>
		</div>

		<!-- Patient quick-search -->
		<div class="search-wrap" bind:this={searchWrap}>
			<div class="search-box">
				<Search size={16} class="text-fg-2" />
				<input
					type="text"
					class="search-input"
					placeholder={$_('dashboard.searchPlaceholder')}
					aria-label={$_('dashboard.searchPlaceholder')}
					data-testid="dash-search"
					bind:value={search}
					onfocus={() => (searchOpen = true)}
					oninput={() => (searchOpen = true)}
					onkeydown={onSearchKeydown}
				/>
			</div>
			{#if searchOpen && search.trim()}
				<div class="search-drop" data-testid="dash-search-results">
					{#each matches as m (m.id)}
						<a
							class="search-item"
							href={resolve('/(app)/patients/[patientId]', { patientId: m.id })}
						>
							<span class="si-avatar">{m.initials}</span>
							<span class="si-meta">
								<span class="si-name">{m.name}</span>
								{#if m.dob}<span class="si-dob">{fmtDate(m.dob)}</span>{/if}
							</span>
						</a>
					{/each}
					{#if matches.length === 0}
						<div class="search-empty">
							{$_('dashboard.searchEmpty', { values: { q: search.trim() } })}
						</div>
					{/if}
					<button type="button" class="search-all" onclick={goAllResults}>
						{$_('dashboard.searchAll', { values: { q: search.trim() } })}
						<ArrowRight size={13} />
					</button>
				</div>
			{/if}
		</div>

		<!-- Dashboard: X-ray analysis + recent (left) · metrics (right) -->
		<div class="dash-grid">
			<div class="dash-main">
				<div class="section-label">{$_('dashboard.xrayAnalysis')}</div>
				<button type="button" class="dropzone" onclick={openPicker} data-testid="dash-dropzone">
					<span class="dz-ring"><UploadCloud size={26} /></span>
					<span class="dz-pill">{$_('dashboard.dropUpload')}</span>
					<span class="dz-hint">{$_('dashboard.dropHint')}</span>
				</button>
				<input
					type="file"
					accept="image/*"
					class="hidden"
					bind:this={fileInput}
					onchange={onFilePicked}
				/>

				<div class="mt-7 mb-3 flex items-center justify-between">
					<div class="section-label !mb-0">{$_('dashboard.recentAnalyses')}</div>
					<a href={resolve('/(app)/patients')} class="view-all" data-testid="dash-view-all">
						{$_('dashboard.viewAll')}
						<ArrowRight size={13} />
					</a>
				</div>
				{#if loadingNoData}
					<div class="recent-grid">
						{#each [0, 1, 2] as i (i)}
							<div class="recent-card skeleton"></div>
						{/each}
					</div>
				{:else if errorNoData}
					<button type="button" class="recent-empty retry" onclick={load}>
						<RefreshCw size={14} />
						{$_('common.retry')}
					</button>
				{:else if recent.length === 0}
					<div class="recent-empty">{$_('dashboard.noRecent')}</div>
				{:else}
					<div class="recent-grid">
						{#each recent as r (r.id)}
							<a
								class="recent-card"
								href={resolve('/(app)/patients/[patientId]', { patientId: r.id })}
							>
								<FileText size={15} class="text-fg-3" />
								<span class="rc-name">{r.name}</span>
								<span class="rc-date">{fmtDate(r.date)}</span>
							</a>
						{/each}
					</div>
				{/if}
			</div>

			<div class="dash-side">
				<div class="section-label">{$_('dashboard.metrics')}</div>
				<div class="metric-list">
					{#each metricCards as c (c.key)}
						{@const Icon = c.icon}
						<div class="metric-card" data-testid="dash-metric-{c.key}">
							<span class="mc-icon"><Icon size={18} /></span>
							<span class="mc-body">
								<span class="mc-value">{loadingNoData ? '—' : c.value}</span>
								<span class="mc-label">{c.label}</span>
							</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</main>

<style>
	.create-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-accent);
		background: transparent;
		color: var(--color-fg-0);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s;
	}
	.create-btn :global(svg) {
		color: var(--color-accent);
	}
	.create-btn:hover {
		background: var(--color-primary-tint);
	}

	.search-wrap {
		position: relative;
		max-width: 36rem;
		margin-bottom: 2rem;
	}
	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 0.9rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
	}
	.search-box:focus-within {
		border-color: var(--color-accent);
	}
	.search-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-fg-0);
		font-size: 0.9rem;
	}
	.search-input::placeholder {
		color: var(--color-fg-3);
	}
	.search-drop {
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 0;
		right: 0;
		z-index: 30;
		padding: 0.3rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
	}
	.search-item {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.55rem;
		border-radius: calc(var(--radius-control) - 2px);
		cursor: pointer;
	}
	.search-item:hover {
		background: var(--color-bg-2);
	}
	.si-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 28px;
		width: 28px;
		flex: none;
		border-radius: 50%;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-size: 0.72rem;
		font-weight: 700;
	}
	.si-meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}
	.si-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-fg-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.si-dob {
		font-size: 0.72rem;
		color: var(--color-fg-2);
	}
	.search-empty {
		padding: 0.6rem 0.6rem;
		font-size: 0.8rem;
		color: var(--color-fg-2);
	}
	.search-all {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		margin-top: 0.2rem;
		padding: 0.5rem 0.6rem;
		border: none;
		border-top: 1px solid var(--color-border);
		background: transparent;
		/* Neutral text (not saffron) so it clears AA contrast in BOTH themes — saffron
		   text fails on the light background. The accent arrow conveys the affordance. */
		color: var(--color-fg-1);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.search-all :global(svg) {
		color: var(--color-accent);
	}
	.search-all:hover {
		color: var(--color-fg-0);
	}

	.dash-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: 1.5rem;
	}
	@media (max-width: 900px) {
		.dash-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.section-label {
		margin-bottom: 0.6rem;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--color-fg-2);
	}

	.dropzone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.85rem;
		width: 100%;
		min-height: 200px;
		padding: 2rem;
		border-radius: var(--radius-card);
		border: 1.5px dashed color-mix(in oklab, var(--color-accent) 55%, var(--color-border));
		background:
			linear-gradient(var(--color-border) 1px, transparent 1px) 0 0 / 28px 28px,
			linear-gradient(90deg, var(--color-border) 1px, transparent 1px) 0 0 / 28px 28px,
			var(--color-bg-1);
		background-blend-mode: soft-light;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}
	.dropzone:hover {
		border-color: var(--color-accent);
	}
	.dz-ring {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 58px;
		width: 58px;
		border-radius: 50%;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-2);
	}
	.dz-pill {
		padding: 0.55rem 1.1rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-size: 0.9rem;
		font-weight: 700;
	}
	.dz-hint {
		font-size: 0.78rem;
		color: var(--color-fg-2);
	}

	.view-all {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.78rem;
		font-weight: 600;
		/* Neutral text + accent arrow — saffron text would fail AA on the light bg. */
		color: var(--color-fg-1);
	}
	.view-all :global(svg) {
		color: var(--color-accent);
	}
	.view-all:hover {
		color: var(--color-fg-0);
	}
	.recent-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}
	@media (max-width: 640px) {
		.recent-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.recent-card {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-height: 92px;
		padding: 0.85rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		transition:
			border-color 0.12s,
			background 0.12s;
	}
	.recent-card:hover {
		border-color: var(--color-accent);
		background: var(--color-bg-2);
	}
	.recent-card.skeleton {
		pointer-events: none;
		opacity: 0.6;
		animation: dash-pulse 1.2s ease-in-out infinite;
	}
	.rc-name {
		margin-top: 0.1rem;
		font-size: 0.88rem;
		font-weight: 600;
		color: var(--color-fg-0);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rc-date {
		font-size: 0.74rem;
		color: var(--color-fg-2);
	}
	.recent-empty {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 1.5rem;
		border-radius: var(--radius-control);
		border: 1px dashed var(--color-border);
		background: var(--color-bg-1);
		font-size: 0.82rem;
		color: var(--color-fg-2);
	}
	.recent-empty.retry {
		cursor: pointer;
		justify-content: center;
		width: 100%;
	}
	.recent-empty.retry:hover {
		color: var(--color-fg-0);
		border-color: var(--color-accent);
	}

	.metric-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.metric-card {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-card);
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-accent);
		background: var(--color-bg-1);
	}
	.mc-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		width: 38px;
		flex: none;
		border-radius: var(--radius-control);
		background: var(--color-bg-2);
		color: var(--color-fg-1);
	}
	.mc-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.2;
	}
	.mc-value {
		font-size: 1.45rem;
		font-weight: 700;
		color: var(--color-fg-0);
		font-variant-numeric: tabular-nums;
	}
	.mc-label {
		font-size: 0.76rem;
		color: var(--color-fg-2);
	}
	@keyframes dash-pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 0.65;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.recent-card.skeleton {
			animation: none;
		}
	}
</style>
