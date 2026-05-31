<script lang="ts">
	import { goto } from '$app/navigation';
	import { demoStore } from '$lib/demo-store.svelte';
	import { setPendingCapture, setPendingFile } from '$lib/file-handoff.svelte';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';
	import { maskPatient } from '$lib/pii';
	import { captureScreenAsDataUrl } from '@be-certain/core/utils';
	import { classifyFile, TWO_D_ASSET } from '@be-certain/imaging-3d/loaders';

	demoStore.hydrate();
	const recentActivities = $derived(demoStore.recentActivities());

	function relativeTime(iso: string): string {
		const diff = Date.now() - Date.parse(iso);
		const minutes = Math.round(diff / 60_000);
		if (minutes < 1) return m.dx_dashboard_time_now();
		if (minutes < 60) return m.dx_dashboard_time_minutes({ n: String(minutes) });
		const hours = Math.round(minutes / 60);
		if (hours < 24) return m.dx_dashboard_time_hours({ n: String(hours) });
		const days = Math.round(hours / 24);
		if (days < 7) return m.dx_dashboard_time_days({ n: String(days) });
		return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}

	let dragOver = $state(false);
	let zoneError = $state<string | null>(null);
	let fileInput: HTMLInputElement;

	const ACCEPTED = '.nii,.nii.gz,.nrrd,.obj,.stl,.ply,.gltf,.glb,.png,.jpg,.jpeg,.dcm';

	function startAnalysisFromFile(file: File) {
		const asset = classifyFile(file);
		if (asset === null) {
			zoneError = m.dx_dashboard_drop_unsupported({ name: file.name });
			setTimeout(() => (zoneError = null), 4000);
			return;
		}
		zoneError = null;
		setPendingFile(file);
		goto(asset === TWO_D_ASSET ? '/viewer?mode=2d' : '/viewer?mode=3d');
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) startAnalysisFromFile(file);
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) startAnalysisFromFile(file);
		target.value = '';
	}

	let capturing = $state(false);
	async function startScreenCapture() {
		if (capturing) return;
		capturing = true;
		zoneError = null;
		try {
			// Capture must run inside the click handler — getDisplayMedia is gated
			// by user activation, so we can't do it from the viewer's mount effect.
			const dataUrl = await captureScreenAsDataUrl();
			setPendingCapture(dataUrl);
			goto('/viewer?mode=2d');
		} catch (e) {
			const msg = e instanceof Error ? e.message : '';
			// User cancelling the OS picker throws NotAllowedError — treat that
			// as silent instead of an error toast.
			if (!/permission denied|NotAllowedError|cancel/i.test(msg)) {
				zoneError = m.dx_dashboard_capture_failed();
				setTimeout(() => (zoneError = null), 4000);
			}
		} finally {
			capturing = false;
		}
	}

	const greeting = $derived.by(() => {
		const h = new Date().getHours();
		if (h < 5) return m.dx_dashboard_greeting_night();
		if (h < 12) return m.dx_dashboard_greeting_morning();
		if (h < 18) return m.dx_dashboard_greeting_afternoon();
		return m.dx_dashboard_greeting_evening();
	});

	const firstName = $derived.by(() => {
		const name = auth.user?.name?.trim() ?? '';
		if (!name) return '';
		return name.split(/\s+/)[0]!;
	});
</script>

<div class="dashboard">
	<!-- ─── Welcome strip ──────────────────────────────────────────────────── -->
	<header class="welcome">
		<span class="text-eyebrow">{greeting}</span>
		<h1 class="text-display">
			{firstName ? m.dx_dashboard_welcome_named({ name: firstName }) : m.dx_dashboard_welcome_anon()}
		</h1>
		<p class="text-body tone-muted">{m.dx_dashboard_welcome_subtitle()}</p>
	</header>

	<!-- ─── File drop ──────────────────────────────────────────────────────── -->
	<section aria-labelledby="drop-title" class="upload-section">
		<div class="upload-toolbar">
			<button
				type="button"
				class="capture-btn"
				onclick={startScreenCapture}
				disabled={capturing}
				title={m.dx_dashboard_capture_window()}
			>
				<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<rect x="1.5" y="3" width="13" height="9" rx="1.5" />
					<path d="M5 14h6" />
					<path d="M8 12v2" />
				</svg>
				<span>{capturing ? m.dx_dashboard_capture_starting() : m.dx_dashboard_capture_window()}</span>
			</button>
		</div>
		<div
			role="button"
			tabindex="0"
			class="dropzone"
			class:over={dragOver}
			class:has-error={!!zoneError}
			aria-describedby="drop-formats"
			ondragover={(e) => {
				e.preventDefault();
				dragOver = true;
			}}
			ondragleave={() => (dragOver = false)}
			ondrop={handleDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput?.click())}
		>
			<div class="drop-icon" aria-hidden="true">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="17 8 12 3 7 8" />
					<line x1="12" y1="3" x2="12" y2="15" />
				</svg>
			</div>
			<h2 id="drop-title" class="text-section-title">{m.dx_dashboard_drop_title()}</h2>
			<p class="text-body tone-muted drop-sub">{m.dx_dashboard_drop_sub()}</p>
			<ul id="drop-formats" class="formats" aria-label={m.dx_dashboard_drop_formats_label()}>
				<li class="format-group">
					<span class="format-label">{m.dx_dashboard_drop_group_2d()}</span>
					<span class="format-values">.png · .jpg · .dcm</span>
				</li>
				<li class="format-divider" aria-hidden="true"></li>
				<li class="format-group">
					<span class="format-label">{m.dx_dashboard_drop_group_volume()}</span>
					<span class="format-values">.nii.gz · .nrrd</span>
				</li>
				<li class="format-divider" aria-hidden="true"></li>
				<li class="format-group">
					<span class="format-label">{m.dx_dashboard_drop_group_mesh()}</span>
					<span class="format-values">.obj · .stl · .ply · .glb</span>
				</li>
			</ul>
			<input
				bind:this={fileInput}
				type="file"
				accept={ACCEPTED}
				class="visually-hidden"
				onchange={handleFileSelect}
				tabindex="-1"
			/>
			{#if zoneError}
				<div class="drop-error" role="alert">{zoneError}</div>
			{/if}
		</div>
	</section>

	<!-- ─── Activity + Resources rail ──────────────────────────────────────── -->
	<section class="split">
		<div class="activity" aria-labelledby="activity-title">
			<header class="section-head">
				<h2 id="activity-title" class="text-section-title">{m.dx_dashboard_activity_title()}</h2>
				<p class="text-meta">{m.dx_dashboard_activity_subtitle()}</p>
			</header>
			{#if recentActivities.length === 0}
				<div class="empty">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.79.97 6.49 2.55" />
						<polyline points="21 3 21 9 15 9" />
						<path d="M12 7v5l3 2" />
					</svg>
					<div>
						<p class="empty-title">{m.dx_dashboard_activity_empty_title()}</p>
						<p class="empty-sub">{m.dx_dashboard_activity_empty_sub()}</p>
					</div>
				</div>
			{:else}
				<ul class="activity-list">
					{#each recentActivities as act, i (act.id)}
						<li class="activity-row" data-status={act.status} style:--idx={i}>
							<a class="activity-link" href="/history#a-{act.id}">
								<span class="status-dot" aria-hidden="true"></span>
								<div class="activity-main">
									<span class="activity-patient">
										{maskPatient(demoStore.patientName(act.patientId))}
									</span>
									<span class="activity-meta">
										{act.type}
										<span class="dot-sep">·</span>
										<span class="findings-count">{act.findings}</span>
										{act.findings === 1 ? m.dx_dashboard_activity_finding_one() : m.dx_dashboard_activity_finding_many()}
									</span>
								</div>
								<span class="activity-time">{relativeTime(act.timestamp)}</span>
								<span class="activity-review" aria-hidden="true">
									<span class="review-text">{m.dx_dashboard_activity_review()}</span>
									<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
										<path d="M5 3l5 5-5 5" />
									</svg>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<aside class="rail" aria-label={m.dx_dashboard_resources_eyebrow()}>
			<h3 class="text-eyebrow">{m.dx_dashboard_resources_eyebrow()}</h3>
			<nav class="rail-rows" aria-label={m.dx_dashboard_resources_eyebrow()}>
				<a class="rail-row resource" href="/history">
					<span>{m.dx_dashboard_view_cases()}</span>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</a>
				<a class="rail-row resource" href="/docs">
					<span>{m.dx_dashboard_resource_docs()}</span>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</a>
				<a class="rail-row resource" href="/support">
					<span>{m.dx_dashboard_resource_support()}</span>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<polyline points="9 18 15 12 9 6" />
					</svg>
				</a>
			</nav>
		</aside>
	</section>
</div>

<svelte:window
	ondragover={(e) => {
		if (e.dataTransfer?.types.includes('Files')) {
			e.preventDefault();
			dragOver = true;
		}
	}}
	ondragleave={(e) => {
		if (e.relatedTarget === null || (e.target as HTMLElement)?.tagName === 'HTML') {
			dragOver = false;
		}
	}}
	ondrop={handleDrop}
/>

<style>
	.dashboard {
		max-width: 1100px;
		margin: 0 auto;
		padding: 8px 0 64px;
		display: flex;
		flex-direction: column;
		gap: 40px;
		animation: rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	/* ─── Welcome ───────────────────────────────────────────────────────────── */
	.welcome {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px 0 0;
	}
	.welcome h1 {
		margin: 0;
	}
	.welcome p {
		margin: 0;
		max-width: 56ch;
	}

	/* ─── Upload section header (capture button row + dropzone) ─────────────── */
	.upload-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.upload-toolbar {
		display: flex;
		justify-content: flex-end;
	}
	.capture-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background-color: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--fg);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 150ms, border-color 150ms, color 150ms, transform 100ms;
	}
	.capture-btn:hover:not(:disabled) {
		background-color: var(--surface-2);
		border-color: var(--border-hover);
		color: var(--accent);
	}
	.capture-btn:active:not(:disabled) {
		transform: translateY(1px);
	}
	.capture-btn:disabled {
		opacity: 0.55;
		cursor: progress;
	}

	/* ─── Dropzone ──────────────────────────────────────────────────────────── */
	.dropzone {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		min-height: 320px;
		padding: 48px 24px 36px;
		border: 1.5px dashed var(--border);
		border-radius: 16px;
		background:
			radial-gradient(ellipse at top, rgba(240, 199, 100, 0.04), transparent 60%),
			linear-gradient(180deg, rgba(33, 53, 72, 0.45), rgba(26, 44, 62, 0.65));
		text-align: center;
		cursor: pointer;
		color: var(--muted-fg);
		transition: border-color 220ms, background-color 220ms, transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.03) inset,
			0 12px 36px -16px rgba(0, 0, 0, 0.4);
	}
	.dropzone:hover {
		border-color: rgba(240, 199, 100, 0.4);
		color: var(--fg);
	}
	.dropzone.over {
		border-color: var(--accent);
		border-style: solid;
		background:
			radial-gradient(ellipse at top, rgba(240, 199, 100, 0.12), transparent 60%),
			linear-gradient(180deg, rgba(240, 199, 100, 0.06), rgba(26, 44, 62, 0.7));
		color: var(--accent);
		transform: scale(1.005);
	}
	.dropzone.has-error {
		border-color: var(--destructive);
	}
	.dropzone:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 4px;
	}

	.drop-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 72px;
		height: 72px;
		border-radius: 18px;
		background: linear-gradient(135deg, rgba(240, 199, 100, 0.18), rgba(240, 199, 100, 0.04));
		border: 1px solid rgba(240, 199, 100, 0.2);
		color: var(--accent);
		margin-bottom: 4px;
		transition: transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}
	.dropzone.over .drop-icon {
		transform: translateY(-4px) scale(1.04);
	}

	.dropzone h2 {
		margin: 0;
	}
	.drop-sub {
		margin: 0;
		max-width: 44ch;
	}

	.formats {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		flex-wrap: wrap;
		justify-content: center;
	}
	.format-group {
		display: flex;
		flex-direction: column;
		gap: 2px;
		align-items: center;
	}
	.format-label {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-tertiary);
	}
	.format-values {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-fg);
		letter-spacing: 0.04em;
	}
	.format-divider {
		width: 1px;
		height: 24px;
		background-color: var(--border);
	}

	.drop-error {
		position: absolute;
		bottom: 16px;
		left: 16px;
		right: 16px;
		padding: 8px 12px;
		border-radius: 8px;
		background-color: rgba(232, 75, 58, 0.1);
		border: 1px solid rgba(232, 75, 58, 0.25);
		color: #f8a59a;
		font-size: 12px;
		text-align: left;
	}

	.visually-hidden {
		position: absolute;
		clip: rect(0 0 0 0);
		width: 1px;
		height: 1px;
		overflow: hidden;
	}

	/* ─── Section heads ─────────────────────────────────────────────────────── */
	.section-head {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 18px;
	}
	.section-head h2 {
		margin: 0;
	}
	.section-head p {
		margin: 0;
	}

	/* ─── Activity + Aside ──────────────────────────────────────────────────── */
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 260px;
		gap: 40px;
		align-items: start;
	}
	.activity {
		display: flex;
		flex-direction: column;
	}
	.empty {
		display: flex;
		align-items: center;
		gap: 18px;
		padding: 28px 24px;
		border: 1px dashed var(--border);
		border-radius: 12px;
		color: var(--muted-fg);
	}
	.empty svg {
		flex-shrink: 0;
		opacity: 0.7;
	}
	.empty-title {
		margin: 0 0 4px;
		font-size: 14px;
		color: var(--fg);
		font-weight: 500;
	}
	.empty-sub {
		margin: 0;
		font-size: 13px;
		color: var(--muted-fg);
		line-height: 1.5;
	}

	/* Recent-activity list — divide-y rows, anchored to /history#a-{id}. */
	.activity-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--border);
		border-radius: 12px;
		background-color: var(--card);
		overflow: hidden;
	}
	.activity-row {
		border-bottom: 1px solid var(--border);
		opacity: 0;
		animation: rowRise 380ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
		animation-delay: calc(var(--idx, 0) * 35ms);
	}
	.activity-row:last-child {
		border-bottom: none;
	}
	.activity-link {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 12px;
		padding: 13px 16px;
		text-decoration: none;
		color: inherit;
		transition: background-color 150ms;
	}
	.activity-link:hover {
		background-color: rgba(232, 236, 240, 0.025);
	}
	.activity-link:focus-visible {
		outline: 1px solid var(--accent);
		outline-offset: -1px;
		background-color: rgba(232, 236, 240, 0.025);
	}
	.status-dot {
		flex-shrink: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background-color: var(--muted-fg);
	}
	[data-status='complete'] .status-dot {
		background-color: #5dd4a6;
	}
	[data-status='reviewing'] .status-dot {
		background-color: var(--accent);
	}
	[data-status='flagged'] .status-dot {
		background-color: var(--destructive);
		animation: dotPulse 2400ms ease-in-out infinite;
	}
	.activity-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.activity-patient {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--fg);
		letter-spacing: 0.04em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.activity-meta {
		display: inline-flex;
		gap: 4px;
		font-size: 11px;
		color: var(--muted-fg);
		font-family: var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		align-items: center;
	}
	.dot-sep {
		opacity: 0.5;
	}
	.findings-count {
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.activity-time {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--muted-fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
		justify-self: end;
	}
	.activity-review {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
		opacity: 0;
		transform: translateX(-4px);
		transition: opacity 180ms, transform 180ms, color 180ms;
	}
	.activity-link:hover .activity-review,
	.activity-link:focus-visible .activity-review {
		opacity: 1;
		transform: translateX(0);
		color: var(--accent);
	}
	@media (hover: none) {
		.activity-review {
			opacity: 1;
			transform: translateX(0);
			color: var(--accent);
		}
		.review-text {
			display: none;
		}
	}
	@keyframes rowRise {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes dotPulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(232, 75, 58, 0.4); }
		50% { box-shadow: 0 0 0 4px rgba(232, 75, 58, 0); }
	}

	.rail {
		display: flex;
		flex-direction: column;
		gap: 12px;
		position: sticky;
		top: 8px;
	}
	.rail h3 {
		margin: 0;
	}
	.rail-rows {
		display: flex;
		flex-direction: column;
	}
	.rail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border-top: 1px solid rgba(240, 199, 100, 0.06);
		font-size: 14px;
	}
	.rail-row:first-child {
		border-top: none;
	}
	a.resource {
		text-decoration: none;
		color: var(--fg);
		transition: color 160ms;
	}
	a.resource:hover {
		color: var(--accent);
	}
	a.resource svg {
		color: var(--muted-fg);
		transition: transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1), color 160ms;
	}
	a.resource:hover svg {
		color: var(--accent);
		transform: translateX(3px);
	}

	@keyframes rise {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* ─── Responsive ────────────────────────────────────────────────────────── */
	@media (max-width: 900px) {
		.split {
			grid-template-columns: 1fr;
			gap: 32px;
		}
		.rail {
			position: static;
		}
	}
	@media (max-width: 560px) {
		.dropzone {
			padding: 36px 18px 28px;
			min-height: 280px;
		}
		.format-divider {
			display: none;
		}
		.formats {
			gap: 8px 16px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dashboard,
		.drop-icon,
		.dropzone {
			animation: none;
			transition: none;
		}
	}
</style>
