<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		demoStore,
		type Activity,
		type ActivityStatus,
		type ScanType
	} from '$lib/demo-store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { maskPatient } from '$lib/pii';
	import { onMount } from 'svelte';

	demoStore.hydrate();

	type StatusFilter = 'all' | ActivityStatus;

	let statusFilter = $state<StatusFilter>('all');
	let typeFilter = $state<ScanType | 'all'>('all');
	let query = $state('');

	const STATUS_FILTERS: { value: StatusFilter; label: () => string }[] = [
		{ value: 'all', label: () => m.dx_cases_filter_all() },
		{ value: 'complete', label: () => m.dx_cases_filter_complete() },
		{ value: 'reviewing', label: () => m.dx_cases_filter_reviewing() },
		{ value: 'flagged', label: () => m.dx_cases_filter_flagged() }
	];

	const SCAN_TYPES: ScanType[] = ['Bitewing', 'Panoramic', 'Periapical', 'CBCT', 'IOS'];

	const all = $derived(
		[...demoStore.activities].sort(
			(a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
		)
	);

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return all.filter((a) => {
			if (statusFilter !== 'all' && a.status !== statusFilter) return false;
			if (typeFilter !== 'all' && a.type !== typeFilter) return false;
			if (q) {
				// Search on the underlying name even though we render the masked
				// form — staff still need to find a case by remembered name.
				const patient = demoStore.patientName(a.patientId).toLowerCase();
				if (!patient.includes(q)) return false;
			}
			return true;
		});
	});

	const stats = $derived.by(() => {
		const total = all.length;
		const flagged = all.filter((a) => a.status === 'flagged').length;
		const reviewing = all.filter((a) => a.status === 'reviewing').length;
		const totalFindings = all.reduce((acc, a) => acc + a.findings, 0);
		const avg = total > 0 ? Math.round((totalFindings / total) * 10) / 10 : 0;
		return { total, flagged, reviewing, avg };
	});

	function formatRelative(iso: string): string {
		const diff = Date.now() - Date.parse(iso);
		const minutes = Math.round(diff / 60_000);
		if (minutes < 1) return m.dx_dashboard_time_now();
		if (minutes < 60) return m.dx_dashboard_time_minutes({ n: String(minutes) });
		const hours = Math.round(minutes / 60);
		if (hours < 24) return m.dx_dashboard_time_hours({ n: String(hours) });
		const days = Math.round(hours / 24);
		if (days < 7) return m.dx_dashboard_time_days({ n: String(days) });
		return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function modeFor(type: ScanType): '2d' | '3d' {
		return type === 'CBCT' || type === 'IOS' ? '3d' : '2d';
	}
	function review(activity: Activity) {
		goto(`/viewer?mode=${modeFor(activity.type)}`);
	}

	// ── Deep-link highlight ─────────────────────────────────────────────
	// Dashboard activity rows link to /history#a-{activityId}; on mount we
	// scroll to the matching row and trigger a brief pulse so the user can
	// orient themselves.
	let highlightId = $state<string | null>(null);
	let listEl: HTMLElement | undefined = $state();

	onMount(() => {
		const hash = page.url.hash;
		if (!hash?.startsWith('#a-')) return;
		const id = hash.slice(3);
		highlightId = id;
		// Wait a frame so the DOM has the row.
		requestAnimationFrame(() => {
			const node = listEl?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
			node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		});
		const t = setTimeout(() => (highlightId = null), 2400);
		return () => clearTimeout(t);
	});

	function resetFilters() {
		statusFilter = 'all';
		typeFilter = 'all';
		query = '';
	}
</script>

<div class="page">
	<header class="head">
		<div class="head-main">
			<span class="eyebrow">{m.dx_cases_eyebrow()}</span>
			<div class="title-row">
				<h1 class="text-display">{m.dx_cases_title()}</h1>
				<span class="title-count" aria-label="{stats.total} total">{stats.total}</span>
			</div>
			<p class="text-body tone-muted">{m.dx_cases_subtitle()}</p>
		</div>
	</header>

	<!-- ── Stat strip — borderless metrics, 1px dividers between tiles -->
	<section class="stats" aria-label="Practice summary">
		<div class="stat">
			<span class="stat-num">{stats.total}</span>
			<span class="stat-lbl">{m.dx_cases_stat_total()}</span>
		</div>
		<div class="stat" data-tone="flagged">
			<span class="stat-num">{stats.flagged}</span>
			<span class="stat-lbl">{m.dx_cases_stat_flagged()}</span>
		</div>
		<div class="stat" data-tone="reviewing">
			<span class="stat-num">{stats.reviewing}</span>
			<span class="stat-lbl">{m.dx_cases_stat_reviewing()}</span>
		</div>
		<div class="stat">
			<span class="stat-num">{stats.avg}</span>
			<span class="stat-lbl">{m.dx_cases_stat_avg_findings()}</span>
		</div>
	</section>

	<!-- ── Filter toolbar — status segment, type select, search -->
	<section class="toolbar" aria-label="Filters">
		<div class="seg" role="group" aria-label={m.dx_cases_filter_aria()}>
			{#each STATUS_FILTERS as opt}
				<button
					type="button"
					class="seg-btn"
					class:on={statusFilter === opt.value}
					data-tone={opt.value}
					onclick={() => (statusFilter = opt.value)}
				>
					{opt.label()}
				</button>
			{/each}
		</div>

		<div class="toolbar-right">
			<label class="search">
				<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
					<circle cx="7" cy="7" r="4.5" />
					<path d="M11 11l3 3" />
				</svg>
				<input
					type="search"
					value={query}
					placeholder={m.dx_cases_search_placeholder()}
					oninput={(e) => (query = (e.target as HTMLInputElement).value)}
				/>
			</label>

			<select
				class="type-select"
				value={typeFilter}
				onchange={(e) => (typeFilter = (e.target as HTMLSelectElement).value as ScanType | 'all')}
				aria-label={m.dx_cases_type_filter_aria()}
			>
				<option value="all">{m.dx_cases_type_all()}</option>
				{#each SCAN_TYPES as t}
					<option value={t}>{t}</option>
				{/each}
			</select>
		</div>
	</section>

	<!-- ── Cases list — deep panel, divide-y rows, stagger reveal -->
	{#if all.length === 0}
		<section class="empty primary-empty">
			<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
				<path d="M14 18l36 0M14 32l36 0M14 46l24 0" />
				<circle cx="9" cy="18" r="1.5" fill="currentColor" />
				<circle cx="9" cy="32" r="1.5" fill="currentColor" />
				<circle cx="9" cy="46" r="1.5" fill="currentColor" />
			</svg>
			<div>
				<p class="empty-title">{m.dx_cases_empty_title()}</p>
				<p class="empty-sub">{m.dx_cases_empty_sub()}</p>
			</div>
		</section>
	{:else if filtered.length === 0}
		<section class="empty">
			<p class="empty-title">{m.dx_cases_filtered_empty_title()}</p>
			<p class="empty-sub">{m.dx_cases_filtered_empty_sub()}</p>
			<button type="button" class="reset-link" onclick={resetFilters}>
				{m.dx_settings_reset()}
			</button>
		</section>
	{:else}
		<section class="list-shell" bind:this={listEl} aria-label={m.dx_cases_title()}>
			<div class="list-head" aria-hidden="true">
				<span>{m.dx_cases_col_date()}</span>
				<span>{m.dx_cases_col_patient()}</span>
				<span>{m.dx_cases_col_type()}</span>
				<span class="head-num">{m.dx_cases_col_findings()}</span>
				<span aria-hidden="true"></span>
			</div>
			{#each filtered as c, i (c.id)}
				<button
					type="button"
					class="row"
					data-row-id={c.id}
					data-status={c.status}
					class:highlight={highlightId === c.id}
					style:--idx={i}
					onclick={() => review(c)}
					aria-label="Review {c.type} for {maskPatient(demoStore.patientName(c.patientId))}"
				>
					<time class="col-when mono" datetime={c.timestamp}>{formatRelative(c.timestamp)}</time>

					<div class="col-patient patient">
						<span class="status-dot" aria-hidden="true"></span>
						<span class="patient-name">
							{maskPatient(demoStore.patientName(c.patientId))}
						</span>
					</div>

					<span class="col-type">
						<span class="type-chip">{c.type}</span>
					</span>

					<span class="col-findings findings mono">
						<span class="findings-num">{c.findings}</span>
					</span>

					<span class="col-action review">
						<span class="review-text">{m.dx_cases_review_cta()}</span>
						<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M5 3l5 5-5 5" />
						</svg>
					</span>
				</button>
			{/each}
		</section>
	{/if}

	<p class="todo">{m.dx_cases_stub_notice()}</p>
</div>

<style>
	.page {
		max-width: 1180px;
		margin: 0 auto;
		padding: 4px 0 96px;
		display: flex;
		flex-direction: column;
		gap: 28px;
		animation: pageRise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	/* ── Header ─────────────────────────────────────────────────────────── */
	.head {
		display: flex;
		gap: 24px;
		align-items: flex-end;
		padding-bottom: 8px;
	}
	.head-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}
	.eyebrow {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--muted-fg);
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.title-row h1 {
		margin: 0;
	}
	.title-count {
		font-family: var(--font-mono);
		font-size: 14px;
		padding: 4px 10px;
		border-radius: 999px;
		background-color: rgba(232, 236, 240, 0.04);
		border: 1px solid var(--border);
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.head-main p {
		margin: 0;
		max-width: 64ch;
	}

	/* ── Stats strip — no cards, just dividers ──────────────────────────── */
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 18px 22px;
		border-right: 1px solid var(--border);
	}
	.stat:last-child {
		border-right: none;
	}
	.stat-num {
		font-family: var(--font-mono);
		font-size: 26px;
		font-weight: 500;
		color: var(--fg);
		letter-spacing: -0.01em;
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.stat[data-tone='flagged'] .stat-num {
		color: var(--destructive);
	}
	.stat[data-tone='reviewing'] .stat-num {
		color: var(--accent);
	}
	.stat-lbl {
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
	}

	/* ── Toolbar ────────────────────────────────────────────────────────── */
	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.seg {
		display: inline-flex;
		background-color: var(--surface);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 3px;
		gap: 2px;
	}
	.seg-btn {
		padding: 6px 12px;
		background: transparent;
		border: 0;
		color: var(--muted-fg);
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border-radius: 7px;
		cursor: pointer;
		transition: color 150ms, background-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.seg-btn:hover {
		color: var(--fg);
	}
	.seg-btn.on {
		background-color: var(--surface-3);
		color: var(--fg);
	}
	.seg-btn.on[data-tone='flagged'] {
		color: var(--destructive);
	}
	.seg-btn.on[data-tone='reviewing'] {
		color: var(--accent);
	}
	.seg-btn.on[data-tone='complete'] {
		color: #5dd4a6;
	}

	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.search {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		background-color: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--muted-fg);
		transition: border-color 150ms, background-color 150ms;
	}
	.search:focus-within {
		border-color: var(--accent);
		background-color: var(--surface-2);
	}
	.search input {
		background: transparent;
		border: 0;
		color: var(--fg);
		font: inherit;
		font-size: 13px;
		min-width: 200px;
		outline: none;
	}
	.search input::placeholder {
		color: var(--muted-fg);
	}
	.type-select {
		appearance: none;
		-webkit-appearance: none;
		background-color: var(--surface);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--fg);
		font: inherit;
		font-size: 13px;
		padding: 7px 28px 7px 12px;
		cursor: pointer;
		background-image: linear-gradient(45deg, transparent 50%, var(--muted-fg) 50%),
			linear-gradient(135deg, var(--muted-fg) 50%, transparent 50%);
		background-position: calc(100% - 13px) 50%, calc(100% - 9px) 50%;
		background-size: 4px 4px;
		background-repeat: no-repeat;
		transition: border-color 150ms;
	}
	.type-select:hover {
		border-color: var(--border-hover);
	}

	/* ── List ──────────────────────────────────────────────────────────── */
	.list-shell {
		display: grid;
		/* Columns: when · patient (flex) · type · findings · action. All non-
		 * patient columns are auto so they size to the widest cell across rows
		 * via subgrid below. Status was dropped — the coloured dot on the
		 * patient row already encodes it. */
		grid-template-columns: auto minmax(0, 1fr) auto auto auto;
		background-color: #0b1620;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.list-head,
	.row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		gap: 20px;
		align-items: center;
		padding: 14px 22px;
	}
	.list-head {
		font-family: var(--font-mono);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		background-color: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.head-num {
		justify-self: end;
	}
	.row {
		background: transparent;
		border: 0;
		border-bottom: 1px solid var(--border);
		color: inherit;
		text-align: left;
		cursor: pointer;
		font: inherit;
		padding-top: 18px;
		padding-bottom: 18px;
		opacity: 0;
		animation: rowRise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
		animation-delay: calc(var(--idx, 0) * 28ms);
		transition: background-color 150ms, transform 120ms;
	}
	.row:last-child {
		border-bottom: none;
	}
	.row:hover {
		background-color: rgba(232, 236, 240, 0.03);
	}
	.row:active {
		transform: translateX(1px);
	}
	.row:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
	}
	.row.highlight {
		animation: rowRise 420ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards,
			rowPulse 2200ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.col-when {
		color: var(--muted-fg);
		font-size: 12px;
		font-feature-settings: 'tnum' on, 'lnum' on;
		white-space: nowrap;
	}

	.patient {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.status-dot {
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--muted-fg);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.04);
	}
	.row[data-status='complete'] .status-dot {
		background-color: #5dd4a6;
	}
	.row[data-status='reviewing'] .status-dot {
		background-color: var(--accent);
	}
	.row[data-status='flagged'] .status-dot {
		background-color: var(--destructive);
		animation: dotPulse 2400ms ease-in-out infinite;
	}
	.patient-name {
		font-family: var(--font-mono);
		font-size: 14px;
		color: var(--fg);
		letter-spacing: 0.04em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.col-type {
		display: inline-flex;
	}
	.type-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 5px 14px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-fg);
		background-color: rgba(232, 236, 240, 0.02);
		white-space: nowrap;
		width: max-content;
	}

	.findings {
		justify-self: end;
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
	}
	.findings-num {
		font-size: 17px;
		font-weight: 500;
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}

	.review {
		justify-self: end;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		opacity: 0.55;
		transition: color 180ms, opacity 180ms, transform 180ms;
	}
	.row:hover .review,
	.row:focus-visible .review {
		color: var(--accent);
		opacity: 1;
		transform: translateX(2px);
	}
	@media (hover: none) {
		.review {
			opacity: 1;
			color: var(--accent);
		}
	}

	/* ── Empty states ───────────────────────────────────────────────────── */
	.empty {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: center;
		text-align: center;
		padding: 48px 24px;
		border: 1px dashed var(--border);
		border-radius: 14px;
		color: var(--muted-fg);
	}
	.empty.primary-empty {
		flex-direction: row;
		justify-content: center;
		gap: 20px;
		text-align: left;
		padding: 36px;
	}
	.empty svg {
		opacity: 0.45;
		flex-shrink: 0;
	}
	.empty-title {
		margin: 0;
		font-size: 15px;
		color: var(--fg);
		font-weight: 500;
	}
	.empty-sub {
		margin: 0;
		font-size: 13px;
		max-width: 48ch;
		line-height: 1.5;
	}
	.reset-link {
		margin-top: 8px;
		background: none;
		border: none;
		color: var(--accent);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.reset-link:hover {
		text-decoration: underline;
	}

	.todo {
		color: var(--text-tertiary);
		font-size: 12px;
		font-style: italic;
		margin: 0;
	}

	.mono {
		font-family: var(--font-mono);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}

	/* ── Animations ─────────────────────────────────────────────────────── */
	@keyframes pageRise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes rowRise {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes rowPulse {
		0% { background-color: rgba(240, 199, 100, 0); }
		18% { background-color: rgba(240, 199, 100, 0.14); }
		100% { background-color: rgba(240, 199, 100, 0); }
	}
	@keyframes dotPulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(232, 75, 58, 0.5); }
		50% { box-shadow: 0 0 0 4px rgba(232, 75, 58, 0); }
	}

	/* ── Responsive collapse ────────────────────────────────────────────── */
	@media (max-width: 880px) {
		.head {
			flex-direction: column;
			align-items: stretch;
		}
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.stat:nth-child(2n) {
			border-right: none;
		}
		.stat:nth-child(-n + 2) {
			border-bottom: 1px solid var(--border);
		}
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}
		.toolbar-right {
			justify-content: space-between;
		}
		.list-shell {
			grid-template-columns: auto minmax(0, 1fr) auto auto auto;
		}
		.list-head,
		.row {
			gap: 10px;
			padding: 12px 14px;
		}
		.row {
			padding-top: 14px;
			padding-bottom: 14px;
		}
		.review-text {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page,
		.row,
		.row.highlight,
		.status-dot,
		.review {
			animation: none;
			transition: none;
		}
	}
</style>
