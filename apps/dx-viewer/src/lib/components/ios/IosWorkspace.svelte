<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Loader2 } from 'lucide-svelte';
	import { _, locale } from 'svelte-i18n';
	import { runIosSeg } from '$lib/ai';
	import { operationErrorKey } from '$lib/forms';
	import { formatDisplayDate } from '$lib/date';
	import { studies } from '$lib/stores/studies.svelte';
	import { statsFromBlob } from '@be-certain/imaging-3d/gltfStats';
	import { meshDisplayName } from '@be-certain/imaging-3d/meshLabel';
	import type { Patient, Study } from '$lib/types';
	import Volume3D from '$lib/components/cbct/Volume3D.svelte';
	import IosToolRail from '$lib/components/ios/IosToolRail.svelte';
	import ToothChart from '$lib/components/cbct/ToothChart.svelte';
	import { localDb } from '$lib/db/localDb';
	import { debouncedSave } from '$lib/debouncedSave';
	import { auth } from '$lib/stores/auth.svelte';
	import PaywallModal from '$lib/components/PaywallModal.svelte';
	import { segLoadOutcome, shouldPaywall } from '@be-certain/imaging-3d/segGate';

	interface Props {
		patient: Patient;
		study: Study;
		patientId: string;
	}
	let { patient, study, patientId }: Props = $props();

	// PHI masking removed — the IOS workspace (header + screenshot filename) shows the real name.
	const displayName = $derived(patient.name);
	const displayInitials = $derived(patient.initials);
	let glbBlob = $state<Blob | null>(null);
	// Raw scan mesh (original .obj) shown before any AI segmentation exists.
	let rawBlob = $state<Blob | null>(null);
	let rawLoading = $state(false);
	let processing = $state(false);
	let progress = $state('');
	let error = $state('');
	// D6: set true when the post-inference saveSegmentation rejects (size cap / token /
	// 5xx). The seg renders this session, but without a persisted file the next visit
	// re-shows the Run-seg CTA → a silent re-bill. We surface a non-blocking retry badge;
	// the computed GLB is still held in `glbBlob`, so Retry re-saves it without re-running
	// the paid inference.
	let segSaveFailed = $state(false);
	let segSaveRetrying = $state(false);
	// Subscription paywall (A1): "Run segmentation" fires a billable AI call
	// (/api/ai/ios_seg_inference), so gate it like the 2D X-ray paths.
	let paywallOpen = $state(false);
	let paywallReason = $state('No Subscription');
	// AbortController for the onMount scan/seg fetches (V5): the route remounts on
	// {#key study.id} and the user can navigate away mid-load — abort in-flight
	// fetches on destroy and skip any results that resolve after teardown.
	let destroyed = false;
	const loadAbort = new AbortController();
	let viewerRef = $state<Volume3D | undefined>(undefined);
	let meshStats = $state<{
		count: number;
		totalTriangles: number;
		bbox?: { x: number; y: number; z: number };
		meshInfos?: {
			name: string;
			color: [number, number, number];
			triangles: number;
			bbox: { x: number; y: number; z: number };
			center?: { x: number; y: number; z: number };
			fdi?: number;
		}[];
	} | null>(null);
	let wireframe = $state(false);
	let selectedTooth = $state<number | null>(null);
	let measureMode = $state(false);
	let measureCount = $state(0);
	// Per-(user, study) IOS state — surface measurements + hidden meshes. LOCAL-FIRST:
	// stored in IndexedDB (`iosState` store, mirroring the PB `ios_state` collection 1:1
	// for backup). Replaces the old localStorage + PB sync.
	let hiddenMeshes = $state<string[]>([]);
	let measureRestored = $state(false);
	// True only once the saved state has been READ back (row or no row). Saves are
	// gated on it: an early Layers/arch toggle would otherwise persist measures:[] +
	// the bare toggle, and a read resolving AFTER that write restores the clobbered
	// row — the clinician's saved measurements would be permanently wiped.
	let stateHydrated = false;
	let stateLoadRetried = false;
	let currentMeasures: MeasureSeg[] = [];
	type MeasureSeg = { a: [number, number, number]; b: [number, number, number] };

	// SPA navigation to a different IOS study reuses this component (the route's
	// dynamic [studyId] only changes the prop). Reset the per-study guards so the
	// new study's state actually restores. Flush (not drop) any pending save first —
	// its payload was snapshotted at schedule time, so it persists the PREVIOUS
	// study's data under the previous study's id.
	let lastStudyId = $state('');
	$effect(() => {
		if (study.id && study.id !== lastStudyId) {
			lastStudyId = study.id;
			saver.flush();
			measureRestored = false;
			stateHydrated = false;
			stateLoadRetried = false;
			measureCount = 0;
			currentMeasures = [];
			hiddenMeshes = [];
		}
	});

	const saver = debouncedSave();
	function scheduleSave() {
		if (typeof window === 'undefined' || !auth.user) return;
		// Gate EVERY save on the restore having completed — see stateHydrated above.
		if (!stateHydrated) return;
		// Snapshot the payload now: a flush may fire during a study switch/unmount.
		const userId = auth.user.id;
		const studyId = study.id;
		const fields = {
			measures: currentMeasures.map((s) => ({ a: [...s.a], b: [...s.b] }) as MeasureSeg),
			hiddenMeshes: [...hiddenMeshes]
		};
		saver.schedule(async () => {
			try {
				await localDb.upsertIosState(userId, studyId, fields);
			} catch (e) {
				console.warn('ios_state save failed', e);
			}
		});
	}

	onDestroy(() => {
		// FLUSH (not drop) a pending save — a measurement drawn <350ms before
		// navigating away must persist (payload snapshotted at schedule time; the
		// IndexedDB write completes after teardown).
		saver.flush();
		// Drop this study's cached object URLs so the mesh/segmentation blobs aren't
		// pinned in memory for the rest of the session.
		studies.invalidateRecordCache(study.id);
		// Abort any in-flight scan/seg fetch + flag torn-down so post-await state
		// writes (glbBlob/rawBlob/error) are skipped (V5).
		destroyed = true;
		loadAbort.abort();
	});

	function persistMeasures(segs: MeasureSeg[]) {
		measureCount = segs.length;
		currentMeasures = segs;
		scheduleSave();
	}

	// Replay saved measurements once the mesh is ready (called from onstats).
	async function restoreMeasures() {
		if (measureRestored) return;
		measureRestored = true;
		if (!auth.user) return;
		try {
			const rec = await localDb.getIosState(auth.user.id, study.id);
			// Read complete (row or not) → saves may persist from here on.
			stateHydrated = true;
			if (!rec) return;
			const segs = Array.isArray(rec.measures) ? (rec.measures as MeasureSeg[]) : [];
			if (segs.length) {
				currentMeasures = segs;
				viewerRef?.loadMeasurements(segs);
				measureCount = segs.length;
			}
			if (Array.isArray(rec.hiddenMeshes)) hiddenMeshes = rec.hiddenMeshes;
		} catch (e) {
			// Save gate (stateHydrated) stays CLOSED after a failed read. ONE delayed
			// retry — a transient failure would otherwise keep it closed all session
			// (measurements made after it would silently never persist). Reset the
			// once-guard so the retry can re-enter.
			console.warn('ios_state load failed', e);
			if (!stateLoadRetried) {
				stateLoadRetried = true;
				measureRestored = false;
				setTimeout(() => void restoreMeasures(), 1500);
			}
		}
	}

	function toggleMesh(name: string) {
		if (hiddenMeshes.includes(name)) hiddenMeshes = hiddenMeshes.filter((x) => x !== name);
		else hiddenMeshes = [...hiddenMeshes, name];
		scheduleSave();
	}

	function rgbCss(c: [number, number, number]) {
		return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
	}

	// Grouped layer toggles (All / Upper / Lower) — DiagnoCat exposes arch groups; we derive
	// them from each tooth's FDI (upper 11–28, lower 31–48). "Crowns" ≈ All for an intraoral
	// scan (all surfaces are crowns); Tongue/Gingiva are AI-limited (no separate mesh).
	function meshFdi(name: string): number {
		const m = name.match(/(\d+)/);
		return m ? Number(m[1]) : 0;
	}
	function setLayerGroup(group: 'all' | 'upper' | 'lower') {
		const names = (meshStats?.meshInfos ?? []).map((m) => m.name);
		let hidden: string[] = [];
		if (group === 'upper')
			hidden = names.filter((n) => meshFdi(n) >= 31 && meshFdi(n) <= 48); // hide lower
		else if (group === 'lower') hidden = names.filter((n) => meshFdi(n) >= 11 && meshFdi(n) <= 28); // hide upper
		hiddenMeshes = hidden;
		scheduleSave();
	}
	const activeGroup = $derived.by(() => {
		const names = (meshStats?.meshInfos ?? []).map((m) => m.name);
		if (hiddenMeshes.length === 0) return 'all';
		const upper = names.filter((n) => meshFdi(n) >= 11 && meshFdi(n) <= 28);
		const lower = names.filter((n) => meshFdi(n) >= 31 && meshFdi(n) <= 48);
		const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
		if (lower.length && eq(hiddenMeshes, lower)) return 'upper';
		if (upper.length && eq(hiddenMeshes, upper)) return 'lower';
		return null; // individual selection
	});

	// Detect which jaw(s) are present. FDIs 11-28 = upper, 31-48 = lower.
	const archLabel = $derived.by(() => {
		if (!meshStats) return '—';
		const fdis = (meshStats.meshInfos ?? []).map((m) => m.fdi).filter((f): f is number => !!f);
		if (fdis.length === 0) return '—';
		const upper = fdis.some((f) => f >= 11 && f <= 28);
		const lower = fdis.some((f) => f >= 31 && f <= 48);
		if (upper && lower) return $_('ios.both');
		if (upper) return $_('ios.upper');
		if (lower) return $_('ios.lower');
		return '—';
	});

	// IOS segmentation identifies teeth but detects no pathology, so there are no
	// per-tooth findings to color the chart — every present tooth is Healthy.
	// (Previously this seeded every segmented tooth severity:'low', making the whole
	// chart read "Mild" instead of "Healthy" — the IOS analog of the CBCT bug fixed
	// for CbctWorkspace in #31. The chart still renders all positions, clickable for
	// tooth-pick highlighting.)
	const toothFindingsForChart: Record<number, { severity: 'low' | 'med' | 'high'; count: number }> =
		{};

	onMount(async () => {
		// LOCAL-FIRST: study.segmentationUrl / imageDataUrl are resolved lazily and are
		// undefined right after a refresh, so a SEGMENTED study would otherwise look raw and
		// re-offer "Run AI segmentation". Detect the cached seg / raw mesh from the local DB
		// (freshFileUrl reads the blob if present) rather than those fields.
		const segUrl = (await studies.freshFileUrl(study, 'segmentation')) ?? study.segmentationUrl;
		const rawUrl = segUrl
			? undefined
			: ((await studies.freshFileUrl(study, 'image')) ?? study.imageDataUrl);
		if (segUrl) {
			try {
				const url = segUrl;
				const resp = await fetch(url, { signal: loadAbort.signal });
				if (destroyed) return;
				// V5: a REAL HTTP error (403 expired token, 500…) must NOT silently fall
				// back to the empty "Run AI Segmentation" CTA as if no seg existed — surface
				// a retry banner. A 404 (genuinely absent) falls through (glbBlob stays null
				// → the run-CTA shows, which is correct when the file truly isn't there).
				const outcome = segLoadOutcome(resp);
				if (outcome === 'error') {
					error = $_('ios.segLoadFailed');
					return;
				}
				if (outcome === 'absent') return;
				const blob = await resp.blob();
				if (destroyed) return;
				glbBlob = blob;
				const s = await statsFromBlob(blob);
				if (destroyed) return;
				if (s) meshStats = s;
			} catch (err) {
				if (destroyed || (err as Error)?.name === 'AbortError') return;
				console.warn('Failed to load cached segmentation', err);
				error = $_('ios.segLoadFailed');
			}
		} else if (rawUrl) {
			// No segmentation yet — show the raw intraoral scan immediately (DiagnoCat
			// shows the scan first; segmentation is an optional overlay step).
			rawLoading = true;
			try {
				const url = rawUrl;
				const resp = await fetch(url, { signal: loadAbort.signal });
				if (destroyed) return;
				if (segLoadOutcome(resp) === 'error') {
					error = $_('ios.scanLoadFailed');
					return;
				}
				rawBlob = await resp.blob();
			} catch (err) {
				if (destroyed || (err as Error)?.name === 'AbortError') return;
				console.warn('Failed to load raw scan mesh', err);
				error = $_('ios.scanLoadFailed');
			} finally {
				if (!destroyed) rawLoading = false;
			}
		}
	});

	async function runSegmentation() {
		if (processing) return; // guard re-entry: don't fire a second concurrent inference on a double-click
		// LOCAL-FIRST: resolve the raw mesh from the local DB (study.imageDataUrl is lazy/undefined).
		const meshUrl = (await studies.freshFileUrl(study, 'image')) ?? study.imageDataUrl;
		if (!meshUrl) {
			error = $_('ios.runErrNoMesh');
			return;
		}
		// A1: this fires a BILLABLE AI call (/api/ai/ios_seg_inference). Gate it
		// proactively on the subscription — open the soft paywall and return WITHOUT
		// calling the AI, mirroring the 2D X-ray upload paths.
		if (shouldPaywall(auth.hasActiveSubscription)) {
			paywallReason = 'No Subscription';
			paywallOpen = true;
			return;
		}
		processing = true;
		error = '';
		try {
			progress = $_('ios.runReadingMesh');
			const resp = await fetch(meshUrl, { signal: loadAbort.signal });
			const blob = await resp.blob();
			const filename = study.originalFilename ?? 'input.obj';
			const file = new File([blob], filename, { type: blob.type });

			progress = $_('ios.runRunningSeg');
			// D5: thread the abort signal so navigating away mid-run cancels this
			// minutes-long BILLABLE call (mirrors the source-download fetch above).
			const out = await runIosSeg(file, loadAbort.signal);
			if (destroyed) return;
			glbBlob = new Blob([out], { type: 'model/gltf-binary' });
			const s = await statsFromBlob(glbBlob).catch(() => null);
			if (destroyed) return;
			if (s) meshStats = s;
			progress = $_('ios.runSavingSeg');
			// D6: surface a non-blocking retry badge on a failed save (don't just
			// console.warn) — otherwise the next visit re-shows the Run-seg CTA and the
			// user unknowingly re-runs (re-bills) the inference.
			try {
				await studies.saveSegmentation(study.id, glbBlob, 'pred_seg.glb');
				segSaveFailed = false;
			} catch (saveErr) {
				console.warn('Failed to persist segmentation', saveErr);
				if (!destroyed) segSaveFailed = true;
			}
		} catch (err) {
			// navigated away mid-run — skip error/paywall UI. We check `destroyed` too:
			// apiFetch wraps a thrown fetch-abort as ApiError(0) (losing the AbortError
			// name), so the unmount-abort is otherwise indistinguishable from a network
			// error; `destroyed` is set before loadAbort.abort() in onDestroy (D5).
			if (destroyed || (err as Error)?.name === 'AbortError') return;
			const m = err as { status?: number; body?: { message?: string }; message?: string };
			// Defense in depth (A1): a backend 403 means the subscription lapsed/was
			// never valid even if the client cache said otherwise — open the paywall
			// instead of the raw 403 message, mirroring the X-ray siblings.
			if (shouldPaywall(auth.hasActiveSubscription, m.status)) {
				paywallReason = m.body?.message || 'No Subscription';
				paywallOpen = true;
			} else {
				// Localized: backend non-403 messages are raw English-technical (A1) — never show them.
				error = $_(operationErrorKey(err, 'ios.runFailed'));
			}
		} finally {
			processing = false;
		}
	}

	// D6: re-attempt the post-inference save using the GLB we still hold in `glbBlob`
	// — no second (billable) inference. Clears the badge on success.
	async function retrySegSave() {
		if (!glbBlob || segSaveRetrying) return;
		segSaveRetrying = true;
		try {
			await studies.saveSegmentation(study.id, glbBlob, 'pred_seg.glb');
			if (!destroyed) segSaveFailed = false;
		} catch (e) {
			console.warn('Segmentation save retry failed', e);
		} finally {
			if (!destroyed) segSaveRetrying = false;
		}
	}

	function fmtDate(iso: string) {
		return formatDisplayDate(iso, $locale ?? undefined);
	}

	function setView(v: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom') {
		viewerRef?.setView(v);
	}

	// D3: clearing measurements is destructive + durable (the empty list is debounce-
	// persisted to PB/localStorage), and surface measurements aren't re-derivable — so
	// confirm, matching every other destructive action in the app (delete-study / cancel-
	// sub). Only nag when there's something to lose (the rail button only shows when
	// measureCount>0, but guard defensively). clearMeasurements() fires onmeasurechange
	// with the empty list, which persists the clear.
	function clearMeasurements() {
		if (measureCount > 0 && !confirm($_('ios.clearMeasureConfirm'))) return;
		viewerRef?.clearMeasurements();
		measureMode = false;
	}
</script>

<!-- Top bar -->
<div class="flex items-center gap-4 border-b border-border bg-bg-1 px-6 py-2">
	<button
		class="text-fg-2 hover:text-fg-0"
		onclick={() => goto(resolve('/(app)/patients/[patientId]', { patientId }))}
		aria-label={$_('viewer.back')}
	>
		<ArrowLeft size={16} />
	</button>
	<div class="flex items-center gap-2">
		<div
			class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-bg-0"
		>
			{displayInitials}
		</div>
		<span class="text-sm font-medium text-fg-0">{displayName}</span>
	</div>
	<div class="ml-3 flex items-center gap-2">
		<span class="text-xs tracking-wider text-fg-2 uppercase">IOS</span>
		<span class="text-fg-2">•</span>
		<span class="text-sm text-fg-1">{fmtDate(study.capturedAt)}</span>
	</div>

	<div class="flex-1"></div>

	{#if !glbBlob && !processing}
		<button
			class="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary"
			onclick={runSegmentation}
		>
			{$_('ios.runSegmentation')}
		</button>
	{/if}
</div>

<div class="flex min-h-0 flex-1 overflow-hidden">
	<IosToolRail
		onorient={setView}
		onreset={() => viewerRef?.resetView()}
		onwireframe={() => (wireframe = !wireframe)}
		onscreenshot={() => {
			const url = viewerRef?.captureScreenshot();
			if (!url) return;
			const a = document.createElement('a');
			a.download = `${(displayName || 'patient').replace(/\s+/g, '_')}_IOS_${study.id}.png`;
			a.href = url;
			a.click();
		}}
		{wireframe}
		{measureMode}
		hasMeasurements={measureCount > 0}
		onmeasure={() => (measureMode = !measureMode)}
		onclearmeasure={clearMeasurements}
	/>

	<main class="relative flex-1 bg-black">
		{#if processing || rawLoading}
			<div class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-0/85">
				<Loader2 size={40} class="animate-spin text-primary" />
				<div class="text-sm text-fg-1">{processing ? progress : $_('ios.loadingScan')}</div>
			</div>
		{/if}
		{#if !glbBlob && !rawBlob && !processing && !rawLoading}
			<!-- Nothing to display (no scan + no segmentation, or the scan failed to load) -->
			<div
				class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-0/85 text-center"
			>
				<div class="text-xl font-medium text-fg-0">{$_('ios.meshSegmentation')}</div>
				<div class="max-w-md text-sm text-fg-2">
					{$_('ios.segmentationPrompt')}
				</div>
				<button
					class="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-bg-0 hover:bg-primary"
					onclick={runSegmentation}
				>
					{$_('ios.runSegmentation')}
				</button>
				{#if error}
					<div class="mt-2 text-xs text-danger" role="alert">{error}</div>
				{/if}
			</div>
		{/if}

		{#if rawBlob && !glbBlob && !processing}
			<!-- Raw scan is displayed; segmentation not yet run. Non-blocking hint. -->
			<div
				class="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-bg-1/80 px-3 py-1 text-xs text-fg-2"
			>
				{$_('ios.rawScanHint')}
			</div>
		{/if}

		{#if error && (glbBlob || rawBlob)}
			<div
				class="bg-danger-500/90 absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-md px-3 py-1.5 text-xs text-white"
				role="alert"
			>
				{error}
			</div>
		{/if}

		<!-- D6: the seg computed but the (paid) result couldn't be persisted — warn so the
		     user knows it won't survive a revisit, and offer a Retry that re-saves the
		     held GLB (no second inference). Non-blocking, top-center. -->
		{#if segSaveFailed}
			<div
				class="bg-warning-500/90 absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-1.5 text-xs text-bg-0"
				role="status"
			>
				<span>{$_('ios.segSaveFailed')}</span>
				<button
					type="button"
					class="rounded bg-bg-0/20 px-2 py-0.5 font-semibold hover:bg-bg-0/30 disabled:opacity-50"
					onclick={retrySegSave}
					disabled={segSaveRetrying}
				>
					{$_('common.retry')}
				</button>
			</div>
		{/if}

		<Volume3D
			bind:this={viewerRef}
			gltfBlob={glbBlob}
			objBlob={rawBlob}
			{hiddenMeshes}
			{wireframe}
			{selectedTooth}
			onselecttooth={(fdi) => (selectedTooth = fdi)}
			onopentooth={(fdi) => (selectedTooth = fdi)}
			hoverLabels
			{measureMode}
			onmeasurechange={(segs) => persistMeasures(segs)}
			onexitmeasure={() => (measureMode = false)}
			onstats={(s) => {
				meshStats = s;
				restoreMeasures();
			}}
		/>
	</main>

	<aside
		class="flex w-[290px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-bg-1 p-3 text-sm"
	>
		<section class="rounded-md border border-border bg-bg-2/40 p-3">
			<div class="mb-2 font-semibold text-fg-0">{$_('ios.meshStats')}</div>
			<div class="grid grid-cols-2 gap-1 text-xs text-fg-2">
				<div class="flex justify-between">
					<span>{$_('ios.teeth')}</span><span class="text-fg-0">{meshStats?.count ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span>{$_('ios.arch')}</span><span class="text-fg-0">{archLabel}</span>
				</div>
				<div class="col-span-2 flex justify-between">
					<span>{$_('ios.triangles')}</span><span class="text-fg-0"
						>{meshStats?.totalTriangles?.toLocaleString($locale ?? undefined) ?? '—'}</span
					>
				</div>
			</div>
		</section>

		<section class="rounded-md border border-border bg-bg-2/40 p-3">
			<div class="mb-2 font-semibold text-fg-0">{$_('ios.layers')}</div>
			{#if meshStats?.meshInfos?.length}
				<!-- Arch group toggles (DiagnoCat-style). Tongue/Gingiva omitted — our IOS
				     segmentation has no separate gingiva/tongue mesh (AI-limited). -->
				<div class="mb-2 flex gap-1">
					{#each ['all', 'upper', 'lower'] as g (g)}
						<button
							class="flex-1 rounded border px-2 py-1 text-[11px] transition {activeGroup === g
								? 'border-primary bg-primary/20 text-primary'
								: 'border-border text-fg-2 hover:bg-bg-2'}"
							aria-pressed={activeGroup === g}
							onclick={() => setLayerGroup(g as 'all' | 'upper' | 'lower')}>{$_('ios.' + g)}</button
						>
					{/each}
				</div>
				<div class="flex max-h-64 flex-col gap-1 overflow-y-auto text-xs">
					{#each meshStats.meshInfos as m (m.name)}
						<label class="flex items-center justify-between text-fg-1">
							<span class="flex min-w-0 items-center gap-2">
								<span
									class="size-3 shrink-0 rounded-sm border border-bg-0/40"
									style:background={rgbCss(m.color)}
								></span>
								<span class="truncate">{meshDisplayName(m.name, $_)}</span>
							</span>
							<input
								type="checkbox"
								checked={!hiddenMeshes.includes(m.name)}
								onchange={() => toggleMesh(m.name)}
								class="checkbox shrink-0"
							/>
						</label>
					{/each}
				</div>
			{:else}
				<div class="text-xs text-fg-2">{$_('ios.layersHint')}</div>
			{/if}
		</section>

		<ToothChart
			findingsByTooth={toothFindingsForChart}
			highlightTooth={selectedTooth != null ? [selectedTooth] : []}
			onpick={(t) => (selectedTooth = selectedTooth === t ? null : t)}
			dense
		/>
	</aside>

	<!-- A1: subscription paywall for the billable "Run segmentation" AI call. -->
	<PaywallModal bind:open={paywallOpen} reason={paywallReason} />
</div>

<style>
	.checkbox {
		accent-color: var(--color-primary);
	}
</style>
