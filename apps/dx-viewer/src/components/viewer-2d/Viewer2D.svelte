<script lang="ts">
	import { goto } from '$app/navigation';
	import TopBar from '$components/layout/TopBar.svelte';
	import ShimmerSkeleton from '$components/ui/ShimmerSkeleton.svelte';
	import { consumePendingCapture, consumePendingFile } from '$lib/file-handoff.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pb } from '$lib/pocketbase';
	import { preferences } from '$lib/preferences.svelte';
	import { ScanSession } from '$lib/use-cases/scan-session.svelte';
	import DetectionLayer from './DetectionLayer.svelte';
	import { type FindingState } from './FindingRow.svelte';
	import ImageCanvas2D, { type ImageCanvas2DApi } from './ImageCanvas2D.svelte';
	import ImageControls, { adjustFilter, DEFAULT_ADJUST, type ImageAdjust } from './ImageControls.svelte';
	import LabelChips from './LabelChips.svelte';
	import LayerToggles from './LayerToggles.svelte';
	import MarkdownReport from './MarkdownReport.svelte';
	import ResultsPanel, { type GroupMode, type SortMode, type Tab } from './ResultsPanel.svelte';

	const session = new ScanSession(pb);

	let api: ImageCanvas2DApi | undefined = $state();

	let selectedId = $state<string | null>(null);
	let hoveredId = $state<string | null>(null);
	let hiddenIds = $state<Set<string>>(new Set());
	let layers = $state({ disease: true, anatomy: false, toothNumbers: true });
	let masks = $state({ disease: false, anatomy: false });
	let tab = $state<Tab>('findings');

	let imageAdjust = $state<ImageAdjust>({ ...DEFAULT_ADJUST });
	let liveThreshold = $state(0.5);
	let findingStates = $state<Map<string, FindingState>>(new Map());
	let sortBy = $state<SortMode>('default');
	let groupBy = $state<GroupMode>('type');
	let patientMode = $state(false);

	const isBusy = $derived(
		session.step === 'capturing' || session.step === 'analyzing' || session.step === 'annotating'
	);

	const counts = $derived({
		disease: session.analysis?.extra.disease_result.result.bboxes.length ?? 0,
		anatomy: session.analysis?.extra.anatomy_result.result.bboxes.length ?? 0,
		toothNumbers: session.analysis?.extra.number_result.result.bboxes.length ?? 0
	});

	const hasMasks = $derived({
		disease: (session.analysis?.extra.disease_result.result.masks?.length ?? 0) > 0,
		anatomy: (session.analysis?.extra.anatomy_result.result.masks?.length ?? 0) > 0
	});

	const imageFilter = $derived(adjustFilter(imageAdjust));

	// On mount: consume whatever the dashboard handed off. The screen-capture
	// path stashes a data URL because getDisplayMedia must run inside the
	// dashboard's click handler — calling it from here would be blocked by
	// the browser's user-activation gate.
	$effect(() => {
		const file = consumePendingFile();
		if (file) {
			session.loadFromFile(file);
			return;
		}
		const dataUrl = consumePendingCapture();
		if (dataUrl) session.analyzeFromDataUrl(dataUrl);
	});

	// When a fresh analysis completes, clear per-run selection state. Tracked via
	// reference identity (not derived) so panning/zooming doesn't re-trigger.
	let lastFramedAnalysis: object | null = null;
	$effect(() => {
		if (session.analysis && session.analysis !== lastFramedAnalysis) {
			lastFramedAnalysis = session.analysis;
			selectedId = null;
			hiddenIds = new Set();
			findingStates = new Map();
		}
	});

	/**
	 * Single explicit entry point for "user picked a finding". Zoom is an action,
	 * not a derived state — driving it from a reactive effect would re-fly the
	 * camera any time the dependency graph re-validates (e.g. after a pan/zoom).
	 */
	function selectFinding(id: string) {
		selectedId = id;
		const bbox = bboxForId(id);
		if (bbox) api?.zoomToBBox(bbox);
	}

	function bboxForId(id: string): [number, number, number, number] | null {
		const a = session.analysis;
		if (!a) return null;
		const [kind, iStr] = id.split(':');
		const i = Number(iStr);
		const arr =
			kind === 'disease'
				? a.extra.disease_result.result.bboxes
				: kind === 'anatomy'
					? a.extra.anatomy_result.result.bboxes
					: kind === 'tooth'
						? a.extra.number_result.result.bboxes
						: null;
		const b = arr?.[i];
		return b ? (b as [number, number, number, number]) : null;
	}

	function toggleHidden(id: string) {
		const next = new Set(hiddenIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		hiddenIds = next;
	}

	function toggleLayer(key: 'disease' | 'anatomy' | 'toothNumbers') {
		layers[key] = !layers[key];
	}

	function toggleMask(key: 'disease' | 'anatomy') {
		masks[key] = !masks[key];
	}

	function setFindingState(id: string, state: FindingState | undefined) {
		const next = new Map(findingStates);
		if (state === undefined) next.delete(id);
		else next.set(id, state);
		findingStates = next;
	}

	function resetAdjust() {
		imageAdjust = { ...DEFAULT_ADJUST };
		liveThreshold = 0.5;
	}

	function handleNew() {
		session.reset();
		selectedId = null;
		hoveredId = null;
		hiddenIds = new Set();
		findingStates = new Map();
		api?.reset(0);
	}
</script>

<div class="root">
	<TopBar
		mode="2D Analysis"
		fileName={session.fileName}
		onBack={() => goto('/')}
	>
		{#snippet actions()}
			{#if session.step === 'idle' && !session.analysis}
				<button
					type="button"
					class="primary-btn"
					onclick={() => session.startCapture()}
				>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<rect x="2" y="4" width="12" height="9" rx="1.5" />
						<circle cx="8" cy="8.5" r="2.5" />
					</svg>
					<span>{m.dx_viewer_2d_capture()}</span>
				</button>
			{:else if session.step === 'complete'}
				<button
					type="button"
					class="ghost-btn"
					onclick={handleNew}
				>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M13 4v3h-3" />
						<path d="M13 7A5.5 5.5 0 1 0 8 13" />
					</svg>
					<span>{m.dx_viewer_2d_new()}</span>
				</button>
			{/if}
			{#if session.analysis}
				<span class="meta-chip" aria-label="{counts.disease + counts.anatomy} findings">
					<span class="meta-dot" aria-hidden="true"></span>
					<span class="meta-num">{counts.disease + counts.anatomy}</span>
					<span class="meta-lbl">{m.dx_viewer_2d_findings_count_label()}</span>
				</span>
			{/if}
		{/snippet}
	</TopBar>

	<div class="layout">
		<div class="canvas-wrap">
			{#if isBusy}
				<ShimmerSkeleton
					label={session.step === 'capturing'
						? m.capture_capturing()
						: session.step === 'analyzing'
							? m.capture_analyzing_regions()
							: m.capture_detecting()}
				/>
			{:else if session.croppedImage}
				<ImageCanvas2D
					imageSrc={session.croppedImage}
					bind:api
					interactive={session.step === 'complete'}
					{imageFilter}
				>
					{#snippet overlay()}
						<DetectionLayer
							analysis={session.analysis}
							{layers}
							showMasks={masks}
							{patientMode}
							{liveThreshold}
							{findingStates}
							{hiddenIds}
							{hoveredId}
							{selectedId}
							onHover={(id) => (hoveredId = id)}
							onSelect={selectFinding}
						/>
					{/snippet}
					{#snippet chrome({ scale, tx, ty })}
						{#if session.analysis}
							<LabelChips
								analysis={session.analysis}
								{layers}
								{scale}
								{tx}
								{ty}
								fdiNumbering={preferences.fdiNumbering}
								{patientMode}
								{liveThreshold}
								{findingStates}
								{hiddenIds}
								{hoveredId}
								{selectedId}
								onHover={(id) => (hoveredId = id)}
								onSelect={selectFinding}
							/>
							<LayerToggles
								{layers}
								{masks}
								{counts}
								{hasMasks}
								onToggle={toggleLayer}
								onToggleMask={toggleMask}
							/>
							<ImageControls
								adjust={imageAdjust}
								threshold={liveThreshold}
								onAdjust={(a) => (imageAdjust = a)}
								onThreshold={(t) => (liveThreshold = t)}
								onReset={resetAdjust}
							/>
						{/if}
					{/snippet}
				</ImageCanvas2D>
			{:else}
				<div class="empty">
					<p>{m.dx_viewer_2d_idle_hint()}</p>
				</div>
			{/if}
		</div>

		<aside class="sidebar">
			<ResultsPanel
				analysis={session.analysis}
				fdiNumbering={preferences.fdiNumbering}
				{selectedId}
				{hoveredId}
				{hiddenIds}
				{findingStates}
				{liveThreshold}
				{sortBy}
				{groupBy}
				{patientMode}
				bind:tab
				onSelect={selectFinding}
				onHover={(id) => (hoveredId = id)}
				onToggle={toggleHidden}
				onSetState={setFindingState}
				onSortChange={(s) => (sortBy = s)}
				onGroupChange={(g) => (groupBy = g)}
				onPatientModeChange={(b) => (patientMode = b)}
			/>
		</aside>
	</div>

	{#if session.error}
		<div class="error" role="alert">{session.error}</div>
	{/if}

	<!-- Print-only: snapshot of the report + annotated X-ray, no app chrome. -->
	{#if session.analysis && session.croppedImage}
		<div class="print-only print-page" aria-hidden="true">
			<h1>{m.dx_viewer_2d_print_title()}</h1>
			<div class="print-image-wrap">
				<img src={session.croppedImage} alt="X-ray" />
			</div>
			<div class="print-report">
				<MarkdownReport report={session.analysis.report ?? null} />
			</div>
		</div>
	{/if}
</div>

<style>
	/* Mirrors viewer-3d/Viewer3D's .root — full-height column with overflow
	 * locked so wheel events stay inside the canvas instead of scrolling the
	 * route shell. */
	.root {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background-color: var(--bg);
	}
	/* Body row sits flush under the TopBar, no gap. Mirrors the 3D viewer's
	 * .main-row with canvas-area + panel-wrap children. */
	.layout {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		padding: 12px;
		gap: 12px;
	}
	@media (max-width: 880px) {
		.layout {
			flex-direction: column;
			padding: 10px;
			gap: 10px;
		}
	}
	.canvas-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		border-radius: var(--radius-lg);
		background-color: #0b1620;
		border: 1px solid var(--border);
		box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.55);
		overflow: hidden;
		display: flex;
		align-items: stretch;
		justify-content: stretch;
	}
	.canvas-wrap > :global(*) {
		flex: 1;
	}
	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 32px;
		color: var(--muted-fg);
		text-align: center;
		font-size: var(--text-meta);
	}
	.sidebar {
		flex-shrink: 0;
		width: 360px;
		min-height: 0;
		display: flex;
	}
	@media (max-width: 880px) {
		.sidebar {
			width: 100%;
			max-height: 40vh;
		}
	}
	.sidebar > :global(*) {
		flex: 1;
	}
	.error {
		margin: 0 12px 12px;
		padding: 12px;
		border-radius: var(--radius);
		background-color: rgba(232, 75, 58, 0.08);
		color: var(--destructive);
		border: 1px solid var(--destructive);
		font-size: var(--text-meta);
	}
	.print-only {
		display: none;
	}

	/* TopBar action buttons — matches the visual weight of the 3D's save-btn:
	 * compact, 13px sans, 9px×18px padding. Accent variant for the primary
	 * action, ghost variant for "New scan". */
	.primary-btn,
	.ghost-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 18px;
		border-radius: var(--radius);
		font-size: 13px;
		font-weight: 500;
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background-color 150ms, border-color 150ms, opacity 150ms, transform 100ms;
	}
	.primary-btn {
		background-color: var(--accent);
		color: var(--primary-fg, #0f1c26);
		border: 1px solid var(--accent);
	}
	.primary-btn:hover {
		opacity: 0.88;
	}
	.primary-btn:active {
		transform: translateY(1px);
	}
	.ghost-btn {
		background-color: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
	}
	.ghost-btn:hover {
		background-color: var(--surface-2);
		border-color: var(--border-hover);
	}
	.ghost-btn:active {
		transform: translateY(1px);
	}

	/* Findings chip — sits to the right of the primary action. Mono number +
	 * small label, mirrors the metric-readout treatment used in the 3D HUD. */
	.meta-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background-color: rgba(232, 236, 240, 0.02);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--fg);
		font-feature-settings: 'tnum' on, 'lnum' on;
	}
	.meta-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--accent);
	}
	.meta-num {
		color: var(--fg);
		font-weight: 500;
	}
	.meta-lbl {
		color: var(--muted-fg);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 9px;
	}
</style>
