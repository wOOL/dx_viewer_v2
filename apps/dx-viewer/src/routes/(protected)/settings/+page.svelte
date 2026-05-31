<script lang="ts">
	import BezelButton from '$components/ui/BezelButton.svelte';
	import Toggle from '$components/ui/Toggle.svelte';
	import { demoStore } from '$lib/demo-store.svelte';
	import { preferences, SUPPORTED_LOCALES, type LocaleTag } from '$lib/preferences.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onMount } from 'svelte';

	preferences.hydrate();
	demoStore.hydrate();

	const sections = [
		{ id: 'preferences', label: m.dx_settings_section_preferences },
		{ id: 'analysis', label: m.dx_settings_section_analysis },
		{ id: 'diagnostics', label: m.dx_settings_section_diagnostics },
		{ id: 'developer', label: m.dx_settings_section_developer }
	];
	let activeSection = $state('preferences');

	let demoToast = $state<string | null>(null);
	function flashToast(msg: string) {
		demoToast = msg;
		setTimeout(() => {
			if (demoToast === msg) demoToast = null;
		}, 2200);
	}

	function regenerateDemo() {
		demoStore.regenerate();
		flashToast(m.dx_settings_demo_regenerated());
	}
	function clearDemo() {
		demoStore.clear();
		flashToast(m.dx_settings_demo_cleared());
	}

	let confirmingReset = $state(false);
	let resetToast = $state(false);

	function handleReset() {
		preferences.reset();
		confirmingReset = false;
		resetToast = true;
		setTimeout(() => (resetToast = false), 2500);
	}

	onMount(() => {
		const headings = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
		const io = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
				if (visible[0]) activeSection = visible[0].target.id;
			},
			{ rootMargin: '-25% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
		);
		headings.forEach((h) => io.observe(h));
		return () => io.disconnect();
	});

	function scrollTo(id: string) {
		const el = document.getElementById(id);
		if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	const thresholdPct = $derived(Math.round(preferences.diseaseThreshold * 100));
</script>

<div class="page">
	<header class="page-head">
		<h1 class="text-display">{m.dx_settings_title()}</h1>
		<p class="text-body tone-muted">{m.dx_settings_tagline()}</p>
	</header>

	<div class="layout">
		<aside class="toc" aria-label={m.dx_settings_section_preferences()}>
			<nav>
				{#each sections as section}
					<button
						type="button"
						class="toc-link"
						class:active={activeSection === section.id}
						aria-current={activeSection === section.id ? 'true' : undefined}
						onclick={() => scrollTo(section.id)}
					>
						{section.label()}
					</button>
				{/each}
			</nav>
			<div class="toc-foot">
				<span class="text-eyebrow">{m.dx_settings_storage_label()}</span>
				<p class="text-meta">{m.dx_settings_storage_note()}</p>
				{#if confirmingReset}
					<div class="reset-confirm">
						<BezelButton variant="ghost" type="button" onclick={() => (confirmingReset = false)}>
							{m.dx_account_cancel()}
						</BezelButton>
						<BezelButton variant="destructive" type="button" onclick={handleReset}>
							{m.dx_settings_reset_confirm()}
						</BezelButton>
					</div>
				{:else}
					<button class="reset-link" type="button" onclick={() => (confirmingReset = true)}>
						{m.dx_settings_reset()}
					</button>
				{/if}
			</div>
		</aside>

		<main class="sections">
			<!-- ─── Preferences ────────────────────────────────────────── -->
			<section id="preferences" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_settings_preferences_title()}</h2>
					<p class="text-body tone-muted section-desc">{m.dx_settings_preferences_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_language_label()}</span>
							<span class="row-hint">{m.dx_settings_language_hint()}</span>
						</dt>
						<dd>
							<div class="select-wrapper">
								<select
									class="select"
									value={preferences.locale}
									onchange={(e) => preferences.setLocale((e.target as HTMLSelectElement).value as LocaleTag)}
								>
									{#each SUPPORTED_LOCALES as locale}
										<option value={locale.tag}>
											{locale.nativeName}
											{#if locale.nativeName !== locale.englishName}
												— {locale.englishName}
											{/if}
										</option>
									{/each}
								</select>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</div>
						</dd>
					</div>
				</dl>
			</section>

			<!-- ─── Analysis ───────────────────────────────────────────── -->
			<section id="analysis" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_settings_analysis_title()}</h2>
					<p class="text-body tone-muted section-desc">{m.dx_settings_analysis_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_numbering_label()}</span>
							<span class="row-hint">{m.dx_settings_numbering_hint()}</span>
						</dt>
						<dd>
							<div class="segmented" role="radiogroup" aria-label={m.dx_settings_numbering_label()}>
								<button
									type="button"
									role="radio"
									aria-checked={!preferences.fdiNumbering}
									class:active={!preferences.fdiNumbering}
									onclick={() => preferences.setFdiNumbering(false)}
								>
									{m.dx_settings_numbering_universal()}
								</button>
								<button
									type="button"
									role="radio"
									aria-checked={preferences.fdiNumbering}
									class:active={preferences.fdiNumbering}
									onclick={() => preferences.setFdiNumbering(true)}
								>
									{m.dx_settings_numbering_fdi()}
								</button>
							</div>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_threshold_label()}</span>
							<span class="row-hint">{m.dx_settings_threshold_hint()}</span>
						</dt>
						<dd>
							<div class="slider-block">
								<input
									type="range"
									min="0"
									max="0.9"
									step="0.05"
									value={preferences.diseaseThreshold}
									oninput={(e) => preferences.setDiseaseThreshold(parseFloat((e.target as HTMLInputElement).value))}
									aria-label={m.dx_settings_threshold_label()}
									aria-valuemin={0}
									aria-valuemax={90}
									aria-valuenow={thresholdPct}
									aria-valuetext={`${thresholdPct}%`}
								/>
								<span class="slider-value text-mono-numeric">{thresholdPct}%</span>
							</div>
							<p class="row-helper text-meta">
								{thresholdPct < 25
									? m.dx_settings_threshold_low()
									: thresholdPct < 60
										? m.dx_settings_threshold_balanced()
										: m.dx_settings_threshold_high()}
							</p>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_segmentation_label()}</span>
							<span class="row-hint">{m.dx_settings_segmentation_hint()}</span>
						</dt>
						<dd>
							<Toggle
								checked={preferences.diseaseSegmentation}
								onchange={(v) => preferences.setDiseaseSegmentation(v)}
								label={m.dx_settings_segmentation_label()}
							/>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">3D antialiasing (FXAA)</span>
							<span class="row-hint">Post-process antialiasing for the 3D viewer. Smooths the stair-step edges on segmentation meshes. Disable if rendering feels sluggish on integrated GPUs.</span>
						</dt>
						<dd>
							<Toggle
								checked={preferences.fxaaEnabled}
								onchange={(v) => preferences.setFxaaEnabled(v)}
								label="Enable FXAA"
							/>
						</dd>
					</div>
				</dl>
			</section>

			<!-- ─── Diagnostics ────────────────────────────────────────── -->
			<section id="diagnostics" class="section">
				<div class="section-head">
					<h2 class="text-section-title">{m.dx_settings_diagnostics_title()}</h2>
					<p class="text-body tone-muted section-desc">{m.dx_settings_diagnostics_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_debug_label()}</span>
							<span class="row-hint">{m.dx_settings_debug_hint()}</span>
						</dt>
						<dd>
							<Toggle
								checked={preferences.debugLogging}
								onchange={(v) => preferences.setDebugLogging(v)}
								label={m.dx_settings_debug_label()}
							/>
						</dd>
					</div>
				</dl>
			</section>

			<!-- ─── Developer (DEMO MODE — remove when real data exists) ── -->
			<section id="developer" class="section last">
				<div class="section-head dev-head">
					<span class="dev-pill">{m.dx_settings_developer_pill()}</span>
					<h2 class="text-section-title">{m.dx_settings_developer_title()}</h2>
					<p class="text-body tone-muted section-desc">{m.dx_settings_developer_description()}</p>
				</div>
				<dl class="rows">
					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_demo_limit_label()}</span>
							<span class="row-hint">{m.dx_settings_demo_limit_hint()}</span>
						</dt>
						<dd>
							<div class="slider-block">
								<input
									type="range"
									min="0"
									max="12"
									step="1"
									value={demoStore.dashboardActivityLimit}
									oninput={(e) => demoStore.setDashboardActivityLimit(parseInt((e.target as HTMLInputElement).value, 10))}
									aria-label={m.dx_settings_demo_limit_label()}
								/>
								<span class="slider-value text-mono-numeric">{demoStore.dashboardActivityLimit}</span>
							</div>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_demo_counts_label()}</span>
							<span class="row-hint">{m.dx_settings_demo_counts_hint()}</span>
						</dt>
						<dd>
							<div class="demo-counts">
								<div class="count-tile">
									<span class="count-num">{demoStore.patients.length}</span>
									<span class="count-lbl">{m.dx_settings_demo_count_patients()}</span>
								</div>
								<div class="count-tile">
									<span class="count-num">{demoStore.activities.length}</span>
									<span class="count-lbl">{m.dx_settings_demo_count_activities()}</span>
								</div>
							</div>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_demo_actions_label()}</span>
							<span class="row-hint">{m.dx_settings_demo_actions_hint()}</span>
						</dt>
						<dd>
							<div class="demo-actions">
								<BezelButton onclick={regenerateDemo}>
									{m.dx_settings_demo_regenerate()}
								</BezelButton>
								<BezelButton variant="secondary" onclick={clearDemo}>
									{m.dx_settings_demo_clear()}
								</BezelButton>
							</div>
						</dd>
					</div>

					<div class="row">
						<dt>
							<span class="row-label">{m.dx_settings_demo_manage_label()}</span>
							<span class="row-hint">{m.dx_settings_demo_manage_hint()}</span>
						</dt>
						<dd>
							<a href="/settings/demo-data" class="manage-link">
								<span>{m.dx_settings_demo_manage_cta()}</span>
								<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<polyline points="9 18 15 12 9 6" />
								</svg>
							</a>
						</dd>
					</div>
				</dl>
			</section>
		</main>
	</div>

	{#if resetToast}
		<div class="toast positive" role="status" aria-live="polite">{m.dx_settings_reset_done()}</div>
	{:else if demoToast}
		<div class="toast positive" role="status" aria-live="polite">{demoToast}</div>
	{/if}
</div>

<style>
	.page {
		max-width: 1100px;
		margin: 0 auto;
		padding: 8px 0 96px;
		animation: pageRise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
		position: relative;
	}

	.page-head {
		padding: 16px 0 36px;
	}
	.page-head h1 {
		margin: 0 0 8px;
	}
	.page-head p {
		margin: 0;
		max-width: 60ch;
	}

	.layout {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 64px;
		align-items: start;
	}

	/* ─── TOC ──────────────────────────────────────────────────────────────── */
	.toc {
		position: sticky;
		top: 8px;
		display: flex;
		flex-direction: column;
		gap: 32px;
	}
	.toc nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.toc-link {
		position: relative;
		display: block;
		background: none;
		border: none;
		padding: 10px 16px;
		border-radius: 6px;
		color: var(--muted-fg);
		font-size: 14px;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		transition: color 160ms, background-color 160ms;
	}
	.toc-link::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		width: 2px;
		height: 0;
		background-color: var(--accent);
		border-radius: 0 2px 2px 0;
		transform: translateY(-50%);
		transition: height 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.toc-link:hover {
		color: var(--fg);
		background-color: rgba(255, 255, 255, 0.02);
	}
	.toc-link.active {
		color: var(--fg);
		font-weight: 500;
	}
	.toc-link.active::before {
		height: 16px;
	}
	.toc-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.toc-foot {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px 10px;
		border-top: 1px solid var(--border);
	}
	.toc-foot p {
		margin: 0;
	}
	.reset-link {
		background: none;
		border: none;
		color: var(--muted-fg);
		font: inherit;
		font-size: 13px;
		cursor: pointer;
		padding: 6px 0 0;
		text-align: left;
		align-self: flex-start;
		transition: color 160ms;
	}
	.reset-link:hover {
		color: var(--destructive);
	}
	.reset-confirm {
		display: flex;
		gap: 6px;
		margin-top: 4px;
		flex-wrap: wrap;
	}

	/* ─── Sections ─────────────────────────────────────────────────────────── */
	.sections {
		display: flex;
		flex-direction: column;
	}
	.section {
		padding: 56px 0 56px;
		border-top: 1px solid var(--border);
		scroll-margin-top: 32px;
		display: flex;
		flex-direction: column;
		gap: 36px;
	}
	.section:first-child {
		border-top: none;
		padding-top: 8px;
	}
	.section.last {
		padding-bottom: 24px;
	}
	.section-head {
		position: relative;
		padding-left: 14px;
	}
	.section-head::before {
		content: '';
		position: absolute;
		left: 0;
		top: 4px;
		bottom: 4px;
		width: 3px;
		border-radius: 0 2px 2px 0;
		background-color: var(--accent);
		opacity: 0.7;
	}
	.section-head h2 {
		margin: 0 0 8px;
	}
	.section-head p,
	.section-head .section-desc {
		margin: 0;
		max-width: 60ch;
	}

	/* ─── Rows ─────────────────────────────────────────────────────────────── */
	.rows {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 24px;
		padding: 22px 0;
		border-top: 1px solid rgba(240, 199, 100, 0.06);
		align-items: center;
	}
	.row:first-child {
		border-top: none;
		padding-top: 24px;
	}
	dt {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.row-label {
		font-size: var(--text-body);
		color: var(--fg);
		font-weight: 500;
	}
	.row-hint {
		font-size: var(--text-meta);
		color: var(--muted-fg);
		line-height: 1.5;
		max-width: 58ch;
	}
	dd {
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
	}
	.row-helper {
		margin: 0;
		text-align: right;
		max-width: 28ch;
	}

	/* ─── Select ───────────────────────────────────────────────────────────── */
	.select-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.select {
		appearance: none;
		-webkit-appearance: none;
		font: inherit;
		font-size: 14px;
		color: var(--fg);
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 9px 36px 9px 14px;
		min-width: 200px;
		cursor: pointer;
		transition: border-color 160ms, background-color 160ms;
	}
	.select:hover {
		border-color: var(--border-hover);
	}
	.select:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(240, 199, 100, 0.18);
	}
	.select-wrapper svg {
		position: absolute;
		right: 12px;
		pointer-events: none;
		color: var(--muted-fg);
	}

	/* ─── Segmented control ────────────────────────────────────────────────── */
	.segmented {
		display: inline-flex;
		padding: 3px;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		gap: 2px;
	}
	.segmented button {
		padding: 7px 14px;
		background: none;
		border: none;
		color: var(--muted-fg);
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		border-radius: 7px;
		transition: color 160ms, background-color 220ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.segmented button:hover:not(.active) {
		color: var(--fg);
	}
	.segmented button.active {
		background-color: var(--surface-3);
		color: var(--fg);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset;
	}
	.segmented button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	/* ─── Slider ───────────────────────────────────────────────────────────── */
	.slider-block {
		display: inline-flex;
		align-items: center;
		gap: 12px;
	}
	.slider-value {
		min-width: 44px;
		text-align: right;
		font-size: 14px;
		color: var(--accent);
	}
	input[type='range'] {
		appearance: none;
		-webkit-appearance: none;
		width: 200px;
		background: transparent;
		cursor: pointer;
	}
	input[type='range']::-webkit-slider-runnable-track {
		height: 4px;
		background: linear-gradient(
			to right,
			var(--accent) 0%,
			var(--accent) calc((var(--val, 0)) * 100%),
			var(--surface-3) calc((var(--val, 0)) * 100%),
			var(--surface-3) 100%
		);
		border-radius: 2px;
	}
	input[type='range']::-moz-range-track {
		height: 4px;
		background: var(--surface-3);
		border-radius: 2px;
	}
	input[type='range']::-moz-range-progress {
		background: var(--accent);
		height: 4px;
		border-radius: 2px;
	}
	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 16px;
		height: 16px;
		background-color: var(--accent);
		border-radius: 50%;
		margin-top: -6px;
		border: 2px solid var(--bg);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
		transition: transform 120ms;
	}
	input[type='range']::-moz-range-thumb {
		width: 16px;
		height: 16px;
		background-color: var(--accent);
		border-radius: 50%;
		border: 2px solid var(--bg);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
	}
	input[type='range']:focus-visible::-webkit-slider-thumb {
		box-shadow: 0 0 0 4px rgba(240, 199, 100, 0.25), 0 2px 6px rgba(0, 0, 0, 0.4);
	}
	input[type='range']:hover::-webkit-slider-thumb {
		transform: scale(1.1);
	}

	/* ─── Developer section ────────────────────────────────────────────────── */
	.dev-head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.dev-pill {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: 4px;
		background-color: rgba(232, 179, 75, 0.1);
		color: rgba(232, 179, 75, 0.92);
		border: 1px solid rgba(232, 179, 75, 0.25);
		margin-bottom: 6px;
	}
	.demo-counts {
		display: flex;
		gap: 10px;
	}
	.count-tile {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		padding: 8px 14px;
		background-color: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 8px;
		min-width: 88px;
	}
	.count-num {
		font-family: var(--font-mono);
		font-size: 22px;
		font-weight: 500;
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.count-lbl {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		font-family: var(--font-mono);
	}
	.demo-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.manage-link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border: 1px solid var(--border);
		border-radius: 8px;
		font-size: 13px;
		color: var(--fg);
		text-decoration: none;
		font-family: var(--font-sans);
		transition: background-color 150ms, border-color 150ms, color 150ms;
	}
	.manage-link:hover {
		background-color: var(--surface-2);
		border-color: var(--border-hover);
		color: var(--accent);
	}
	.manage-link svg {
		opacity: 0.65;
		transition: transform 200ms;
	}
	.manage-link:hover svg {
		transform: translateX(2px);
		opacity: 1;
	}

	/* ─── Toast ────────────────────────────────────────────────────────────── */
	.toast {
		position: fixed;
		bottom: 32px;
		left: 50%;
		transform: translateX(-50%);
		padding: 12px 20px;
		border-radius: 999px;
		font-size: 13px;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
		animation: toastIn 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
		z-index: 60;
	}
	.toast.positive {
		background-color: rgba(93, 212, 201, 0.12);
		border: 1px solid rgba(93, 212, 201, 0.25);
		color: #b6e8e2;
	}

	@keyframes pageRise {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes toastIn {
		from { opacity: 0; transform: translate(-50%, 8px); }
		to { opacity: 1; transform: translate(-50%, 0); }
	}

	@media (max-width: 920px) {
		.layout {
			grid-template-columns: 1fr;
			gap: 32px;
		}
		.toc {
			position: static;
			display: none;
		}
		.row {
			grid-template-columns: 1fr;
			gap: 12px;
		}
		dd {
			align-items: flex-start;
		}
		.row-helper {
			text-align: left;
		}
	}

	@media (max-width: 560px) {
		.page-head h1 {
			font-size: 26px;
		}
		input[type='range'] {
			width: 100%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.page,
		.toast,
		.segmented button,
		.toc-link::before {
			animation: none;
			transition: none;
		}
	}
</style>
