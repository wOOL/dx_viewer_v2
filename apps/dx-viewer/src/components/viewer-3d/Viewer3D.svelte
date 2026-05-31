<script lang="ts">
	import { goto } from '$app/navigation';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import BezelCard from '$components/ui/BezelCard.svelte';
	import ShimmerSkeleton from '$components/ui/ShimmerSkeleton.svelte';
	import { consumePendingFile, setPendingFile } from '$lib/file-handoff.svelte';
	import * as m from '$lib/paraglide/messages';
	import { pb } from '$lib/pocketbase';
	import { preferences } from '$lib/preferences.svelte';
	import { Volume3DSession } from '$lib/use-cases/volume-3d-session.svelte';
	import { classifyFile, TWO_D_ASSET } from '@be-certain/imaging-3d/loaders';
	import { onDestroy, onMount } from 'svelte';
	import SlicePane from './SlicePane.svelte';
	import StructureList from './StructureList.svelte';
	import TopBar from '$components/layout/TopBar.svelte';
	import UploadGate from './UploadGate.svelte';

	const session = new Volume3DSession(pb);

	let mainEl: HTMLDivElement | undefined = $state();
	let axialEl: HTMLDivElement | undefined = $state();
	let coronalEl: HTMLDivElement | undefined = $state();
	let sagittalEl: HTMLDivElement | undefined = $state();

	// Sidebar collapsible + resizable (demo: PANEL_MIN_WIDTH=280, PANEL_MAX_WIDTH=640, default 360).
	const PANEL_MIN = 280;
	const PANEL_MAX = 640;
	// Default closed on laptops <1440px so the canvas isn't squeezed. Matches the demo.
	let panelOpen = $state(typeof window !== 'undefined' ? window.innerWidth >= 1440 : true);
	let panelWidth = $state(360);
	let resizing = $state(false);
	let resizeStartX = 0;
	let resizeStartW = 0;
	let prevBodyCursor = '';
	let prevBodyUserSelect = '';

	let isMobile = $state(false);

	onMount(() => {
		const mq = window.matchMedia('(max-width: 880px)');
		const update = () => (isMobile = mq.matches);
		update();
		mq.addEventListener('change', update);

		const pending = consumePendingFile();
		if (pending) handleUpload(pending);

		return () => mq.removeEventListener('change', update);
	});

	onDestroy(() => session.dispose());

	// FXAA preference applied live — toggling the Settings switch propagates to
	// the active render window without remounting the volume.
	$effect(() => {
		const enabled = preferences.fxaaEnabled;
		if (session.stage === 'ready') {
			session.viewer.setUseFXAA(enabled);
		}
	});

	// After the volume mounts and the SlicePane components render, their canvas
	// containers (axialEl/coronalEl/sagittalEl) become bound — that's when we
	// can wire VTK slice views to them. The session.mount() call also runs
	// wireSliceViews internally but at that moment these refs are still
	// undefined; this effect picks up the slack as soon as the refs settle.
	$effect(() => {
		// Touch reactive deps so this re-runs when any of them change.
		const main = mainEl;
		const axial = axialEl;
		const coronal = coronalEl;
		const sagittal = sagittalEl;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		session.viewer.assets;
		if (!main) return;
		session.viewer.wireSliceViews({ main, axial, coronal, sagittal });
	});

	function handleUpload(file: File) {
		// 2D images dropped on the 3D viewer's upload gate route to /viewer?mode=2d
		// via the same file-handoff the dashboard uses. Keeps a single code path
		// for "user gave us a 2D X-ray; show them the 2D viewer".
		if (classifyFile(file) === TWO_D_ASSET) {
			setPendingFile(file);
			goto('/viewer?mode=2d');
			return;
		}
		if (!mainEl) return;
		const containers = { main: mainEl, axial: axialEl, coronal: coronalEl, sagittal: sagittalEl };
		const n = file.name.toLowerCase();
		if (n.endsWith('.nii') || n.endsWith('.nii.gz') || n.endsWith('.nrrd')) {
			session.loadCbct(file, containers);
		} else if (n.endsWith('.obj') || n.endsWith('.stl') || n.endsWith('.ply')) {
			session.loadIos(file, containers);
		} else if (n.endsWith('.gltf') || n.endsWith('.glb')) {
			session.loadGltf(file, containers);
		} else {
			alert(`Unsupported file type: ${file.name}`);
		}
	}

	function onResizeStart(e: PointerEvent) {
		if (!panelOpen) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		resizing = true;
		resizeStartX = e.clientX;
		resizeStartW = panelWidth;
		// Lock body cursor + disable text selection so the drag feels consistent
		// even when the pointer crosses elements with their own cursor styles
		// (range inputs, the VTK interactor, etc.). Matches the demo.
		prevBodyCursor = document.body.style.cursor;
		prevBodyUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'ew-resize';
		document.body.style.userSelect = 'none';
	}
	function onResizeMove(e: PointerEvent) {
		if (!resizing) return;
		const delta = resizeStartX - e.clientX;
		panelWidth = Math.max(PANEL_MIN, Math.min(PANEL_MAX, resizeStartW + delta));
	}
	function onResizeEnd(e: PointerEvent) {
		if (!resizing) return;
		resizing = false;
		document.body.style.cursor = prevBodyCursor;
		document.body.style.userSelect = prevBodyUserSelect;
		try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
	}

	// ─── Derived UI state ────────────────────────────────────────────────────

	const segMount = $derived(
		session.viewer.assets.find((a) => a.kind === 'gltf-segmentation' || a.kind === 'labels')
	);
	const segAssetIndex = $derived(
		session.viewer.assets.findIndex((a) => a.kind === 'gltf-segmentation' || a.kind === 'labels')
	);

	type Structure = {
		id: number;
		name: string;
		groupKey: string;
		group: string;
		color: string;
		vertexCount?: number;
		volumeMm3?: number;
	};
	const labelStructures = $derived.by<Structure[]>(() => (segMount?.['structures'] ?? []) as Structure[]);

	const volumeMount = $derived(
		session.viewer.assets.find((a) => a.kind === 'volume' || a.kind === 'labels')
	);
	const meshMount = $derived(session.viewer.assets.find((a) => a.kind === 'mesh'));
	const hasMPR = $derived(!!volumeMount);

	function toggleOne(id: number) {
		if (segAssetIndex < 0) return;
		const cur = session.viewer.labelVisibility[id] ?? true;
		session.viewer.setLabelVisibility(segAssetIndex, id, !cur);
	}

	function toggleGroup(_groupKey: string, items: Structure[]) {
		if (segAssetIndex < 0) return;
		const anyVisible = items.some((s) => (session.viewer.labelVisibility[s.id] ?? true) !== false);
		const target = !anyVisible;
		session.viewer.setLabelVisibilityBulk(
			segAssetIndex,
			items.map((s) => ({ labelId: s.id, visible: target }))
		);
	}

	function setOpacityOne(id: number, opacity: number) {
		if (segAssetIndex < 0) return;
		session.viewer.setLabelOpacity(segAssetIndex, id, opacity);
	}

	function fmtDims(d: unknown): string | null {
		if (!Array.isArray(d) || d.length < 3) return null;
		return `${d[0]} × ${d[1]} × ${d[2]}`;
	}
	function fmtSpacing(s: unknown): string | null {
		if (!Array.isArray(s) || s.length < 3) return null;
		return s.map((v) => Number(v).toFixed(2)).join(' × ') + ' mm';
	}
	function fmtIntensity(r: unknown): string | null {
		if (!Array.isArray(r) || r.length < 2) return null;
		return `${Math.round(Number(r[0]))} → ${Math.round(Number(r[1]))}`;
	}
	function fmtFormat(f: unknown): string {
		if (typeof f !== 'string') return '—';
		return f.toUpperCase();
	}
	function fmtAffineSource(s: unknown): { label: string; identity: boolean } {
		const v = typeof s === 'string' ? s : 'unknown';
		return {
			label: v === 'identity' ? 'identity (no sform/qform)' : v,
			identity: v === 'identity'
		};
	}

	function setSliceWorld(axis: 'axial' | 'coronal' | 'sagittal', world: number) {
		session.viewer.setSliceWorldPos(axis, world);
	}

	const segStatusLabel = $derived.by(() => {
		switch (session.segStage) {
			case 'idle':
				return session.kind === 'gltf' ? null : m.dx_viewer_3d_seg_idle();
			case 'inferring':
				return m.dx_viewer_3d_seg_inferring();
			case 'mounting':
				return m.dx_viewer_3d_seg_mounting();
			case 'ready':
				return m.dx_viewer_3d_seg_ready();
			case 'paywall':
				return m.dx_viewer_3d_seg_paywall();
			case 'error':
				return session.segError ?? m.dx_viewer_3d_inference_failed();
		}
	});
</script>

<div class="root">
	<TopBar
		fileName={session.fileName}
		mode="3D Analysis"
		onBack={() => goto('/')}
	>
		{#snippet actions()}
			{#if session.stage !== 'idle'}
				<button type="button" class="new-scan-btn" onclick={() => session.dispose()}>
					<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M13 4v3h-3" />
						<path d="M13 7A5.5 5.5 0 1 0 8 13" />
					</svg>
					<span>{m.dx_viewer_2d_new()}</span>
				</button>
			{/if}
		{/snippet}
	</TopBar>
	<div class="main-row">
		<div class="canvas-area" class:has-mpr={hasMPR && !isMobile} class:idle={session.stage === 'idle'}>
			<div class="canvas-frame">
				<div class="canvas-inner" bind:this={mainEl}></div>

				{#if session.stage === 'idle'}
					<div class="upload-overlay">
						<UploadGate onUpload={handleUpload} />
					</div>
				{/if}

				{#if session.stage === 'ready' && (volumeMount || meshMount)}
					<div class="hud hud-left">
						{#if volumeMount}
							{#if fmtDims(volumeMount['dims'])}
								<div class="hud-row"><span class="k">DIM</span><span class="v">{fmtDims(volumeMount['dims'])}</span></div>
							{/if}
							{#if fmtSpacing(volumeMount['spacing'])}
								<div class="hud-row"><span class="k">SPC</span><span class="v">{fmtSpacing(volumeMount['spacing'])}</span></div>
							{/if}
						{/if}
						{#if meshMount}
							<div class="hud-row"><span class="k">VTX</span><span class="v">{(meshMount['vertexCount'] as number).toLocaleString()}</span></div>
							<div class="hud-row"><span class="k">TRI</span><span class="v">{(meshMount['faceCount'] as number).toLocaleString()}</span></div>
						{/if}
						{#if labelStructures.length > 0}
							<div class="hud-row"><span class="k">LBL</span><span class="v">{labelStructures.length}</span></div>
						{/if}
					</div>
					<button type="button" class="reset-btn" onclick={() => session.viewer.resetCamera()} title="Reset view">
						<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M2.5 8a5.5 5.5 0 1 1 1.62 3.9" />
							<path d="M2 5v3h3" />
						</svg>
						<span>Reset view</span>
					</button>
					<div class="hint-pill">
						<span><span class="hint-action">Drag</span> rotate</span>
						<span class="hint-sep">·</span>
						<span><span class="hint-action">Right-drag</span> pan</span>
						<span class="hint-sep">·</span>
						<span><span class="hint-action">Scroll</span> zoom</span>
					</div>
				{/if}

				{#if session.stage === 'mounting'}
					<div class="overlay">
						<ShimmerSkeleton label={m.dx_viewer_3d_mounting()} progress={session.progress} />
					</div>
				{:else if session.stage === 'error' && session.error}
					<div class="overlay">
						<BezelCard>
							<p class="error">{session.error}</p>
							<BezelButton variant="secondary" onclick={() => session.dispose()}>{m.dx_viewer_3d_retry()}</BezelButton>
						</BezelCard>
					</div>
				{/if}

				<!-- Segmentation status used to live as a bottom-left toast here;
				     moved into the sidebar's Layers section so it stops covering
				     the drag/rotate/zoom hint pill. -->

			</div>

			<!-- Slice panes mount only when MPR is active (matches demo behaviour).
			     Each pane calls onCanvas() once its container is bound, which
			     stores the element in our $state and triggers the $effect that
			     wires the VTK slice views. -->
			{#if hasMPR && !isMobile}
				<SlicePane
					axis="axial"
					label={m.dx_viewer_3d_axial()}
					sliceView={session.viewer.getSliceView('axial')}
					worldPos={session.viewer.slicePositions.axial}
					crosshair={session.viewer.crosshair}
					onChange={(v) => setSliceWorld('axial', v)}
					onCanvas={(el) => (axialEl = el ?? undefined)}
				/>
				<SlicePane
					axis="coronal"
					label={m.dx_viewer_3d_coronal()}
					sliceView={session.viewer.getSliceView('coronal')}
					worldPos={session.viewer.slicePositions.coronal}
					crosshair={session.viewer.crosshair}
					onChange={(v) => setSliceWorld('coronal', v)}
					onCanvas={(el) => (coronalEl = el ?? undefined)}
				/>
				<SlicePane
					axis="sagittal"
					label={m.dx_viewer_3d_sagittal()}
					sliceView={session.viewer.getSliceView('sagittal')}
					worldPos={session.viewer.slicePositions.sagittal}
					crosshair={session.viewer.crosshair}
					onChange={(v) => setSliceWorld('sagittal', v)}
					onCanvas={(el) => (sagittalEl = el ?? undefined)}
				/>
			{/if}
		</div>

		<div class="panel-wrap" style:width={isMobile ? '100%' : panelOpen ? `${panelWidth}px` : '0px'}>
			{#if panelOpen && !isMobile}
				<div
					class="resize-handle"
					class:active={resizing}
					onpointerdown={onResizeStart}
					onpointermove={onResizeMove}
					onpointerup={onResizeEnd}
					onpointercancel={onResizeEnd}
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize sidebar"
				></div>
			{/if}

			{#if !isMobile}
				<button
					type="button"
					class="panel-toggle"
					class:open={panelOpen}
					onclick={() => (panelOpen = !panelOpen)}
					title={panelOpen ? 'Collapse panel' : 'Expand panel'}
				>
					{panelOpen ? '›' : '‹'}
				</button>
			{/if}

			<aside class="panel" class:open={panelOpen}>
				<div class="panel-content">
					<section class="side-sec">
						<h4 class="side-eyebrow">{volumeMount ? 'Acquisition' : meshMount ? 'Geometry' : m.dx_viewer_3d_source()}</h4>
						<div class="meta-list">
							<div class="meta-row">
								<span class="meta-k">File</span>
								<span class="meta-v" title={session.fileName ?? ''}>{session.fileName ?? '—'}</span>
							</div>
							{#if volumeMount}
								<div class="meta-row"><span class="meta-k">Modality</span><span class="meta-v">CBCT</span></div>
								<div class="meta-row"><span class="meta-k">Format</span><span class="meta-v">{fmtFormat(volumeMount['format'])}{session.fileName?.endsWith('.gz') ? ' · gzip' : ''}</span></div>
								{#if segMount && segMount['schemaName']}
									<div class="meta-row"><span class="meta-k">Schema</span><span class="meta-v">{segMount['schemaName']}</span></div>
								{/if}
								{#if fmtDims(volumeMount['dims'])}
									<div class="meta-row"><span class="meta-k">Dimensions</span><span class="meta-v">{fmtDims(volumeMount['dims'])} vx</span></div>
								{/if}
								{#if fmtSpacing(volumeMount['spacing'])}
									<div class="meta-row"><span class="meta-k">Spacing</span><span class="meta-v">{fmtSpacing(volumeMount['spacing'])}</span></div>
								{/if}
								{#if fmtIntensity(volumeMount['range'])}
									<div class="meta-row"><span class="meta-k">Intensity</span><span class="meta-v">{fmtIntensity(volumeMount['range'])}</span></div>
								{/if}
								{#if labelStructures.length > 0}
									<div class="meta-row"><span class="meta-k">Structures</span><span class="meta-v">{labelStructures.length}</span></div>
								{/if}
								{#if volumeMount['affineSource']}
									{@const af = fmtAffineSource(volumeMount['affineSource'])}
									<div class="meta-row"><span class="meta-k">Orientation</span><span class="meta-v" class:warn={af.identity}>{af.label}</span></div>
								{/if}
							{/if}
							{#if meshMount}
								<div class="meta-row"><span class="meta-k">Vertices</span><span class="meta-v">{(meshMount['vertexCount'] as number).toLocaleString()}</span></div>
								<div class="meta-row"><span class="meta-k">Triangles</span><span class="meta-v">{(meshMount['faceCount'] as number).toLocaleString()}</span></div>
								{#if Array.isArray(meshMount['bounds']) && (meshMount['bounds'] as number[]).length >= 6}
									{@const b = meshMount['bounds'] as number[]}
									<div class="meta-row"><span class="meta-k">Bounds X</span><span class="meta-v">{b[0]!.toFixed(1)} → {b[1]!.toFixed(1)}</span></div>
									<div class="meta-row"><span class="meta-k">Bounds Y</span><span class="meta-v">{b[2]!.toFixed(1)} → {b[3]!.toFixed(1)}</span></div>
									<div class="meta-row"><span class="meta-k">Bounds Z</span><span class="meta-v">{b[4]!.toFixed(1)} → {b[5]!.toFixed(1)}</span></div>
								{/if}
							{/if}
						</div>
						{#if volumeMount && volumeMount['affineSource'] === 'identity'}
							<div class="orient-warning">
								This file has no orientation matrix (sform / qform).
								Anatomical directions (R/L, anterior/posterior) may be unreliable.
							</div>
						{/if}
					</section>

					<section class="side-sec">
						<h4 class="side-eyebrow">Layers</h4>
						<div class="layers">
							{#if segMount && segAssetIndex >= 0}
								{@const segVisible = session.viewer.assets[segAssetIndex]?.visible ?? true}
								<button
									type="button"
									class="layer-card primary"
									class:dim={!segVisible}
									onclick={() => session.viewer.setAssetVisibility(segAssetIndex, !segVisible)}
									title={segVisible ? 'Hide AI analysis' : 'Show AI analysis'}
								>
									<span class="layer-eye-icon" aria-hidden="true">
										<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
											{#if segVisible}
												<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
												<circle cx="8" cy="8" r="2" fill="currentColor" />
											{:else}
												<path d="M3 3l10 10" />
												<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
											{/if}
										</svg>
									</span>
									<div class="layer-body">
										<div class="layer-title-row">
											<span class="layer-title">AI analysis</span>
											<span class="layer-badge">PRIMARY</span>
										</div>
										<div class="layer-subtitle">Anatomical structures · solid</div>
									</div>
								</button>
							{:else if session.kind && session.kind !== 'gltf'}
								{#if session.segStage === 'inferring' || session.segStage === 'mounting'}
									<div class="layer-card primary inflight">
										<span class="layer-spinner" aria-hidden="true"></span>
										<div class="layer-body">
											<div class="layer-title-row">
												<span class="layer-title">AI analysis</span>
											</div>
											<div class="layer-subtitle">
												{session.segStage === 'inferring' ? 'Analyzing on server…' : 'Rendering segmentation…'}
											</div>
										</div>
									</div>
								{:else if session.segStage === 'paywall'}
									<div class="layer-card paywall">
										<span class="layer-eye-icon">✕</span>
										<div class="layer-body">
											<div class="layer-title-row">
												<span class="layer-title">AI analysis</span>
											</div>
											<div class="layer-subtitle">Subscription required</div>
										</div>
										<BezelButton variant="secondary" onclick={() => (location.href = '/account')}>
											{m.paywall_manage_subscription()}
										</BezelButton>
									</div>
								{:else if session.segStage === 'error' && session.segError}
									<div class="layer-card error">
										<span class="layer-eye-icon">✕</span>
										<div class="layer-body">
											<div class="layer-title-row">
												<span class="layer-title">AI analysis</span>
											</div>
											<div class="layer-subtitle" title={session.segError}>{session.segError}</div>
										</div>
									</div>
								{/if}
							{/if}

							{#if volumeMount}
								{@const volIdx = session.viewer.assets.findIndex((a) => a.kind === 'volume')}
								{@const volVisible = volIdx >= 0 ? (session.viewer.assets[volIdx]?.visible ?? true) : true}
								<button
									type="button"
									class="layer-card"
									class:dim={!volVisible}
									onclick={() => volIdx >= 0 && session.viewer.setAssetVisibility(volIdx, !volVisible)}
									title={volVisible ? 'Hide xray volume' : 'Show xray volume'}
								>
									<span class="layer-eye-icon" aria-hidden="true">
										<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
											{#if volVisible}
												<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
												<circle cx="8" cy="8" r="2" fill="currentColor" />
											{:else}
												<path d="M3 3l10 10" />
												<path d="M1.5 8C3 5 5.2 3.5 8 3.5s5 1.5 6.5 4.5C13 11 10.8 12.5 8 12.5S3 11 1.5 8z" />
											{/if}
										</svg>
									</span>
									<div class="layer-body">
										<div class="layer-title-row">
											<span class="layer-title">CT context</span>
										</div>
										<div class="layer-subtitle">Translucent backdrop</div>
									</div>
								</button>
							{/if}
						</div>
					</section>

					{#if labelStructures.length > 0}
						<section class="side-sec">
							<h4 class="side-eyebrow">{m.dx_viewer_3d_labels()}</h4>
							<StructureList
								structures={labelStructures}
								visibility={session.viewer.labelVisibility}
								opacity={session.viewer.labelOpacity}
								onToggle={toggleOne}
								onToggleGroup={toggleGroup}
								onOpacity={setOpacityOne}
							/>
						</section>
					{/if}
				</div>
			</aside>
		</div>
	</div>
</div>

<style>
	/* viewerStyles.root — flex column, full height, no overflow.
	 * Critical: overflow: hidden cascades down so wheel events on slice canvases
	 * reach VTK's interactor instead of scrolling the route shell. */
	.root {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background-color: var(--bg);
	}
	.main-row {
		flex: 1;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		min-height: 0;
	}
	@media (max-width: 880px) {
		.main-row {
			flex-direction: column;
		}
	}

	/* viewer3dStyles.canvas — flex:1, grid layout.
	 *
	 * Three modes, picked entirely by CSS media queries on viewport height:
	 *   - Default (no MPR):     1×1, main fills the whole canvas-area.
	 *   - 2×2 (MPR, short):     demo's stock layout — main top-left,
	 *                            axial/coronal/sagittal in the other 3 cells.
	 *                            Works on laptops + standard monitors.
	 *   - Diagnocat strip (MPR, tall ≥880px): 3 slice panes stacked in a
	 *                            220-px-wide left column, main viewport
	 *                            spans the remaining width × full height.
	 *                            Lights up on tall external monitors where
	 *                            the strip layout reads better than 2×2.
	 *
	 * The DOM order in Viewer3D.svelte is fixed (main canvas, axial, coronal,
	 * sagittal), so we use :nth-child position selectors to assign each child
	 * its grid-area for each layout — no class shuffling per breakpoint.
	 */
	.canvas-area {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		grid-template-rows: 1fr;
		gap: 0;
		padding: 16px;
		background-color: var(--bg);
		overflow: hidden;
		min-width: 0;
	}
	.canvas-area.idle {
		padding: 16px;
	}

	/* MPR — short layout (default, 2×2). */
	.canvas-area.has-mpr {
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
		gap: 6px;
		padding: 8px;
	}
	.canvas-area.has-mpr > :global(*:nth-child(1)) { grid-area: 1 / 1 / 2 / 2; } /* main canvas */
	.canvas-area.has-mpr > :global(*:nth-child(2)) { grid-area: 1 / 2 / 2 / 3; } /* axial */
	.canvas-area.has-mpr > :global(*:nth-child(3)) { grid-area: 2 / 1 / 3 / 2; } /* coronal */
	.canvas-area.has-mpr > :global(*:nth-child(4)) { grid-area: 2 / 2 / 3 / 3; } /* sagittal */

	/* MPR — tall layout: slice strip on the left, main on the right.
	 * Strip width tuned (was 220, now 280) for readability of the orientation
	 * labels + scrub slider thumb on retina displays. */
	@media (min-height: 880px) {
		.canvas-area.has-mpr {
			grid-template-columns: 280px 1fr;
			grid-template-rows: 1fr 1fr 1fr;
			gap: 6px;
			padding: 8px;
		}
		.canvas-area.has-mpr > :global(*:nth-child(1)) { grid-area: 1 / 2 / 4 / 3; } /* main spans all 3 rows */
		.canvas-area.has-mpr > :global(*:nth-child(2)) { grid-area: 1 / 1 / 2 / 2; } /* axial */
		.canvas-area.has-mpr > :global(*:nth-child(3)) { grid-area: 2 / 1 / 3 / 2; } /* coronal */
		.canvas-area.has-mpr > :global(*:nth-child(4)) { grid-area: 3 / 1 / 4 / 2; } /* sagittal */
	}

	/* Mobile — single column, MPR hidden via the hasMPR && !isMobile guard
	 * in Viewer3D's template so the slice panes don't render at all. */
	@media (max-width: 880px) {
		.canvas-area,
		.canvas-area.has-mpr {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr;
			padding: 8px;
			gap: 0;
		}
	}

	/* viewer3dStyles.canvasFrame — bezel chrome around the WebGL canvas. */
	.canvas-frame {
		position: relative;
		border-radius: var(--radius-lg);
		overflow: hidden;
		background-color: #0b1620;
		border: 1px solid var(--border);
		box-shadow: 0 30px 60px -30px rgba(0, 0, 0, 0.55);
		min-height: 0;
		min-width: 0;
	}
	/* viewer3dStyles.canvasInner — the actual VTK mount point. */
	.canvas-inner {
		position: absolute;
		inset: 0;
	}

	.upload-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 5;
	}

	/* viewer3dStyles.loadingOverlay equivalents. */
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background-color: rgba(15, 28, 38, 0.85);
		backdrop-filter: blur(6px);
		gap: 10px;
		padding: 24px;
		text-align: center;
		z-index: 10;
	}
	.error {
		color: var(--destructive);
		font-size: 14px;
		margin-bottom: 12px;
	}

	/* Frosted-glass HUD chrome — matches the demo's viewer3dStyles.hudTopLeft.
	 * The translucent panel + backdrop blur + inset highlight keeps the
	 * readout legible over the volume's variable luminance without sitting
	 * heavy on the eye. */
	.hud {
		position: absolute;
		top: 12px;
		left: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		pointer-events: none;
		font-family: var(--font-mono);
		font-size: 10px;
		color: rgba(232, 236, 240, 0.88);
		padding: 9px 12px;
		min-width: 180px;
		background-color: rgba(8, 16, 24, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		backdrop-filter: blur(8px) saturate(140%);
		-webkit-backdrop-filter: blur(8px) saturate(140%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 8px 24px -12px rgba(0, 0, 0, 0.5);
		z-index: 4;
	}
	.hud-row { display: flex; gap: 8px; }
	.hud-row .k { color: rgba(232, 236, 240, 0.5); min-width: 26px; }
	.hud-row .v { font-feature-settings: 'tnum' on, 'lnum' on; }
	.reset-btn {
		position: absolute;
		top: 12px;
		right: 12px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 11px 7px 9px;
		background-color: rgba(8, 16, 24, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 999px;
		color: rgba(232, 236, 240, 0.88);
		cursor: pointer;
		font-size: 11px;
		font-family: var(--font-sans);
		backdrop-filter: blur(8px) saturate(140%);
		-webkit-backdrop-filter: blur(8px) saturate(140%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 8px 24px -12px rgba(0, 0, 0, 0.5);
		transition: background-color 150ms, border-color 150ms, color 150ms;
		z-index: 4;
	}
	.reset-btn:hover {
		background-color: rgba(8, 16, 24, 0.85);
		border-color: rgba(255, 255, 255, 0.18);
		color: var(--fg);
	}
	.reset-btn svg { flex-shrink: 0; opacity: 0.85; }
	/* Bottom-centre interaction hint — matches the demo's viewer3dStyles.hintBar
	 * pattern. Critical for first-time discoverability: users don't know that
	 * right-drag pans or that scroll zooms until they're told. */
	.hint-pill {
		position: absolute;
		bottom: 14px;
		left: 50%;
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 7px 14px;
		background-color: rgba(8, 16, 24, 0.55);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 999px;
		color: rgba(232, 236, 240, 0.72);
		font-size: 11px;
		font-family: var(--font-sans);
		backdrop-filter: blur(8px) saturate(140%);
		-webkit-backdrop-filter: blur(8px) saturate(140%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 8px 24px -12px rgba(0, 0, 0, 0.5);
		pointer-events: none;
		z-index: 4;
		white-space: nowrap;
	}
	.hint-action {
		color: var(--fg);
		font-weight: 500;
		margin-right: 4px;
	}
	.hint-sep {
		color: rgba(232, 236, 240, 0.3);
	}
	@media (max-width: 980px) {
		.hint-pill { display: none; }
	}

	@keyframes pulse {
		0%, 100% { opacity: 0.4; transform: scale(0.85); }
		50%     { opacity: 1;   transform: scale(1.1);  }
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Layers section — card-style boxes with eye icon, title + subtitle, and
	 * an optional PRIMARY badge on the active asset. Matches the source
	 * material's right panel. */
	.layers {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.layer-card {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 12px 14px;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		text-align: left;
		color: var(--fg);
		font-size: 13px;
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background-color 150ms, border-color 150ms, opacity 150ms;
	}
	button.layer-card:hover {
		background-color: rgba(232, 236, 240, 0.03);
		border-color: var(--border-hover, var(--border));
	}
	.layer-card.primary {
		border-color: rgba(240, 199, 100, 0.45);
	}
	button.layer-card.primary:hover {
		border-color: rgba(240, 199, 100, 0.75);
	}
	.layer-card.dim {
		opacity: 0.45;
	}
	.layer-card.inflight,
	.layer-card.paywall,
	.layer-card.error {
		cursor: default;
	}
	.layer-card.paywall { border-color: rgba(232, 75, 58, 0.35); }
	.layer-card.error { border-color: rgba(232, 75, 58, 0.55); }
	.layer-eye-icon {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		color: var(--accent);
	}
	.layer-card.dim .layer-eye-icon {
		color: var(--muted-fg);
	}
	.layer-spinner {
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		border: 1.5px solid rgba(232, 236, 240, 0.2);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	.layer-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.layer-title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.layer-title {
		font-weight: 500;
		color: var(--fg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.layer-subtitle {
		font-size: 11px;
		color: var(--muted-fg);
		line-height: 1.4;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.layer-badge {
		font-family: var(--font-mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(240, 199, 100, 0.12);
		color: rgba(240, 199, 100, 0.85);
		flex-shrink: 0;
	}

	/* Sidebar wrapper — pinned, flex sibling of canvas-area. */
	.panel-wrap {
		position: relative;
		flex-shrink: 0;
		display: flex;
		transition: width 220ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (max-width: 880px) {
		.panel-wrap {
			border-top: 1px solid var(--border);
			max-height: 40vh;
			transition: none;
		}
	}
	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 5px;
		cursor: ew-resize;
		z-index: 25;
		background-color: transparent;
		transition: background-color 150ms;
	}
	.resize-handle:hover,
	.resize-handle.active {
		background-color: var(--accent);
		opacity: 0.6;
	}
	.panel-toggle {
		position: absolute;
		top: 18px;
		left: -14px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background-color: var(--card);
		border: 1px solid var(--border);
		color: var(--fg);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		z-index: 30;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		transition: background-color 150ms;
	}
	.panel-toggle:hover {
		background-color: var(--surface-2);
	}
	.panel-toggle.open {
		left: -14px;
	}
	.panel-toggle:not(.open) {
		left: -28px;
		background-color: var(--card);
	}

	.panel {
		flex: 1;
		background-color: #0b1620;
		border-left: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}
	@media (max-width: 880px) {
		.panel {
			border-left: none;
			border-top: 1px solid var(--border);
		}
	}
	.panel-content {
		flex: 1;
		overflow-y: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.side-sec {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.side-eyebrow {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted-fg);
	}
	/* Source/Acquisition table — each row gets a 1px bottom rule, the last
	 * one drops it. Matches the bordered metadata table in the source
	 * material's right panel. */
	.meta-list { display: flex; flex-direction: column; }
	.meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--border);
		font-size: 12px;
		line-height: 1.4;
	}
	.meta-row:last-child {
		border-bottom: none;
	}
	.meta-k { color: var(--muted-fg); flex-shrink: 0; }
	.meta-v {
		color: var(--fg);
		font-family: var(--font-mono);
		font-feature-settings: 'tnum' on, 'lnum' on;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.meta-v.warn {
		color: #e8b34b;
	}
	.orient-warning {
		margin-top: 8px;
		padding: 8px 10px;
		font-size: 11px;
		line-height: 1.5;
		color: rgba(232, 179, 75, 0.92);
		background-color: rgba(232, 179, 75, 0.06);
		border: 1px solid rgba(232, 179, 75, 0.18);
		border-radius: var(--radius);
	}

	/* "New scan" action in the TopBar — same ghost-button treatment as the 2D
	 * viewer's matching action so both viewers share the visual language. */
	.new-scan-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 18px;
		background-color: transparent;
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 13px;
		font-weight: 500;
		font-family: var(--font-sans);
		cursor: pointer;
		transition: background-color 150ms, border-color 150ms, transform 100ms;
	}
	.new-scan-btn:hover {
		background-color: var(--surface-2);
		border-color: var(--border-hover);
	}
	.new-scan-btn:active {
		transform: translateY(1px);
	}
</style>
