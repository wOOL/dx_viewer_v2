<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Loader2, Maximize2, Minimize2 } from 'lucide-svelte';
	import { _, locale } from 'svelte-i18n';
	import { operationErrorKey } from '$lib/forms';
	import { formatDisplayDate } from '$lib/date';
	import JSZip from 'jszip';
	import { runCbctSeg } from '$lib/ai';
	import { studies } from '$lib/stores/studies.svelte';
	import type { Patient, Study } from '$lib/types';
	import { createCbctState } from '@be-certain/imaging-3d/state';
	import { loadVolumeFromBlob, maxSliceIndex } from '@be-certain/imaging-3d/volumeLoader';
	import { sliceStepIntent } from '$lib/keyboard';
	import {
		statsFromBlob,
		deriveToothMapping,
		layerSortRank
	} from '@be-certain/imaging-3d/gltfStats';
	import { computeAnatomyCounts } from '@be-certain/imaging-3d/anatomyCounts';
	import MprPane from '$lib/components/cbct/MprPane.svelte';
	import PanoramicView from '$lib/components/cbct/PanoramicView.svelte';
	import Volume3D from '$lib/components/cbct/Volume3D.svelte';
	import CbctToolRail from '$lib/components/cbct/CbctToolRail.svelte';
	import CbctFindings from '$lib/components/cbct/CbctFindings.svelte';
	import CbctReport from '$lib/components/cbct/CbctReport.svelte';
	import ToothConditionsModal from '$lib/components/cbct/ToothConditionsModal.svelte';
	import { findingTypeLabel } from '@be-certain/imaging-3d/findingLabel';
	import { toothDisplay } from '$lib/constants';
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

	const store = createCbctState();
	// PHI masking removed — the CBCT workspace (header + report) always shows the real name.
	const displayName = $derived(patient.name);
	const displayInitials = $derived(patient.initials);
	let gltfBlob = $state<Blob | null>(null);
	let processing = $state(false);
	let progress = $state('');
	let error = $state('');
	let volumeLoaded = $state(false);
	// D6: set true when the post-inference saveSegmentation rejects (size cap / token /
	// 5xx). The seg renders this session, but without a persisted file the next visit
	// re-shows the Run-seg CTA → a silent re-bill. We surface a non-blocking retry badge
	// and hold the computed zip so Retry re-saves WITHOUT re-running the paid inference.
	let segSaveFailed = $state(false);
	let lastSegBlob: Blob | null = null;
	let segSaveRetrying = $state(false);
	// Subscription paywall (A1): "Run segmentation" fires a billable AI call, so —
	// like the 2D X-ray paths — gate it proactively on the active subscription and
	// also translate a backend 403 into the soft paywall (defense in depth).
	let paywallOpen = $state(false);
	let paywallReason = $state('No Subscription');
	// AbortController for the segmentation/volume fetches (V5). The route remounts on
	// {#key study.id} and the user can navigate away mid-load (a minutes-long call),
	// so abort in-flight fetches on destroy and ignore any results that resolve after.
	let destroyed = false;
	const loadAbort = new AbortController();
	let volume3DRef = $state<Volume3D | undefined>(undefined);
	// 3D tooth-click selection (#44): single-click highlights the tooth, double-click opens
	// its per-tooth Conditions modal. FDI-keyed, shared by both Volume3D instances.
	let selectedTooth = $state<number | null>(null);
	let conditionsTooth = $state<number | null>(null);
	// MPR pane maximize (1×1 ↔ 2×2). null = 2×2 grid; otherwise that pane fills the area.
	let maximizedPane = $state<'axial' | 'sagittal' | 'coronal' | 'volume' | null>(null);

	// Per-(user, study) CBCT state — MPR markups (linear/angle/annotation) + hidden
	// meshes. LOCAL-FIRST: stored in IndexedDB (`cbctReportState` store, mirroring the PB
	// `cbct_report_state` collection 1:1 for backup). The db upsert merges by (user,
	// study), so these markups/hiddenMeshes coexist with the sign-off/notes written by
	// CbctReport in the same row.
	// True only once the saved state has been READ back (row or no row). Saves are
	// gated on it: persisting before the read completes would overwrite the saved
	// markups/hiddenMeshes with the component's empty defaults — and a read resolving
	// AFTER that write restores the clobbered row (permanent loss).
	let markupsRestored = $state(false);
	let markupsLoadStarted = false; // non-reactive: the read runs once per study

	// SPA navigation to a different CBCT study reuses this route component (the
	// dynamic [studyId] only changes the prop). Reset per-study guards so the new
	// study actually loads — without this, markupsRestored stayed true from the
	// previous study and the new one never pulled its state. Flush (not drop) any
	// pending save first — its payload was snapshotted at schedule time, so it
	// persists the PREVIOUS study's data under the previous study's id.
	let lastStudyId = $state('');
	$effect(() => {
		if (study.id && study.id !== lastStudyId) {
			lastStudyId = study.id;
			saver.flush();
			markupsRestored = false;
			markupsLoadStarted = false;
			markupsLoadRetried = false;
			hiddenMeshes = [];
		}
	});

	function applyMarkups(raw: unknown) {
		if (!raw || typeof raw !== 'object') return;
		try {
			// store.loadMarkups validates internally; cast through unknown so we
			// don't have to re-declare CbctMeasurement/CbctAngle/CbctAnnotation here.
			store.loadMarkups(raw as Parameters<typeof store.loadMarkups>[0]);
		} catch {
			/* malformed payload — ignore */
		}
	}

	// Restore markups + hidden meshes from IndexedDB as soon as the volume parses.
	$effect(() => {
		if (!volumeLoaded || !browser || !auth.user) return;
		if (markupsLoadStarted) return;
		markupsLoadStarted = true;
		void loadFromDb();
	});

	let markupsLoadRetried = false;
	async function loadFromDb() {
		if (!browser || !auth.user) return;
		try {
			const rec = await localDb.getCbctReport(auth.user.id, study.id);
			// Read complete (row or not) → saves may persist from here on.
			markupsRestored = true;
			if (!rec) return;
			if (rec.markups) applyMarkups(rec.markups);
			if (Array.isArray(rec.hiddenMeshes)) hiddenMeshes = rec.hiddenMeshes;
		} catch (e) {
			// Keep the save gate CLOSED — after a failed read, persisting the empty
			// defaults would overwrite saved markups we never saw. ONE delayed retry: a
			// transient first-read failure would otherwise keep the gate closed for the
			// whole session (markups drawn after it would silently never persist).
			console.warn('cbct_report_state load (markups) failed', e);
			if (!markupsLoadRetried) {
				markupsLoadRetried = true;
				setTimeout(() => void loadFromDb(), 1500);
			}
		}
	}

	const saver = debouncedSave();
	function scheduleSave() {
		if (!browser || !auth.user) return;
		// Gate EVERY save (markup effect + mesh toggles) on the restore having
		// completed — see markupsRestored above.
		if (!markupsRestored) return;
		// Snapshot the payload now: a flush may fire during a study switch/unmount.
		const userId = auth.user.id;
		const studyId = study.id;
		const fields = {
			markups: {
				measurements: $state.snapshot(store.measurements),
				angles: $state.snapshot(store.angles),
				annotations: $state.snapshot(store.annotations)
			},
			hiddenMeshes: [...hiddenMeshes]
		};
		saver.schedule(async () => {
			try {
				await localDb.upsertCbctReport(userId, studyId, fields);
			} catch (e) {
				console.warn('cbct_report_state save (markups) failed', e);
			}
		});
	}
	onDestroy(() => {
		// FLUSH (not drop) a pending save — a markup drawn <350ms before navigating
		// away must persist. The payload was snapshotted at schedule time, so it is
		// this study's data; the IndexedDB write completes after teardown.
		saver.flush();
		// Drop this study's cached object URLs so the volume/segmentation blobs
		// (85–300 MB each) aren't pinned in memory for the rest of the session.
		studies.invalidateRecordCache(study.id);
		// Abort any in-flight segmentation/volume fetch + flag torn-down so post-await
		// state writes (gltfBlob/volumeLoaded/error) are skipped (V5).
		destroyed = true;
		loadAbort.abort();
	});

	$effect(() => {
		// Touch the markup arrays so the effect re-runs when they change.
		void store.measurements;
		void store.angles;
		void store.annotations;
		if (!markupsRestored || !browser) return;
		scheduleSave();
	});
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

	const toothMapping = $derived.by(() => {
		if (!meshStats || !meshStats.meshInfos || meshStats.meshInfos.length === 0) {
			return { byFdi: {} as Record<number, number>, jawMeshes: [], canalMeshes: [] };
		}
		return deriveToothMapping({
			count: meshStats.count,
			totalTriangles: meshStats.totalTriangles,
			bbox: meshStats.bbox,
			meshInfos: meshStats.meshInfos
		});
	});

	// Reverse-map mesh name → semantic label for the Layers panel. Each mesh
	// is exactly one of: a tooth (with FDI), a jaw, a canal, or unmapped (fall
	// back to the prettified mesh name).
	const meshNameLabel = $derived.by(() => {
		const labels: Record<string, string> = {};
		if (!meshStats?.meshInfos) return labels;
		const infos = meshStats.meshInfos;
		for (const [fdiStr, idx] of Object.entries(toothMapping.byFdi)) {
			const m = infos[idx as number];
			// Render the number in the active numbering preference (default Universal),
			// matching the chart / overlays / report — not raw FDI (vein #17/#37/#77).
			if (m) labels[m.name] = `${$_('cbct.tooth')} ${toothDisplay(Number(fdiStr))}`;
		}
		toothMapping.jawMeshes.forEach((idx, i) => {
			const m = infos[idx];
			if (m)
				labels[m.name] =
					toothMapping.jawMeshes.length > 1 ? `${$_('cbct.jaw')} ${i + 1}` : $_('cbct.jaw');
		});
		toothMapping.canalMeshes.forEach((idx, i) => {
			const m = infos[idx];
			if (m) labels[m.name] = `${$_('cbct.canal')} ${i + 1}`;
		});
		return labels;
	});

	// Sort rank for the Layers list (jaws → teeth in FDI order → canals → unmapped),
	// derived from the geometry classification — the AI's generic VTK mesh names
	// ("Mesh N") can't be band-sorted by prefix, so a name-based sort fell back to
	// alphabetical (Canal/Jaw/Tooth, teeth string-ordered). See layerSortRank.
	const meshSortRank = $derived(layerSortRank(meshStats?.meshInfos ?? [], toothMapping));

	// NOTE: we deliberately do NOT seed the tooth-chart with a per-present-tooth
	// "low" entry. The segmentation gives anatomy, not pathology, so marking every
	// detected tooth "Mild" over-calls — every tooth then reads blue and "Healthy"
	// (gray) is never shown. The chart is driven purely by real findings below
	// (CbctReport overlays them); a present tooth with no finding renders Healthy.

	// Coarse synthesized findings derived from the segmentation (no real AI per-
	// tooth labels). We surface "missing tooth" entries for FDI slots that don't
	// have a matching mesh in `toothMapping.byFdi`. Anatomic structure counts go
	// in the anatomy section already; this populates the findings list so the
	// Perio/Restorative/Endo categories aren't all "No findings".
	const synthesizedFindings = $derived.by(() => {
		if (!meshStats || meshStats.count === 0) return [];
		const present = new Set(Object.keys(toothMapping.byFdi).map(Number));
		// Suppress missing-tooth synthesis when the scan itself looks partial:
		//   - <8 teeth detected → not enough resolution to call anything "missing"
		//   - <2 jaws detected → likely a partial-arch scan; missing slots aren't
		//     missing teeth, they're outside the scan ROI.
		if (present.size < 8) return [];
		if (toothMapping.jawMeshes.length < 2) return [];
		const allFdi = [
			18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42,
			41, 31, 32, 33, 34, 35, 36, 37, 38
		];
		const findings: {
			tooth: number;
			type: string;
			severity: 'low' | 'med' | 'high';
			confidence?: number;
		}[] = [];
		for (const fdi of allFdi) {
			if (!present.has(fdi)) {
				findings.push({ tooth: fdi, type: 'Missing tooth (segmentation gap)', severity: 'med' });
			}
		}
		return findings;
	});
	// Restored from IndexedDB by loadFromDb() once the volume parses.
	let hiddenMeshes = $state<string[]>([]);
	let reduceNoise = $state(false);

	function toggleMesh(name: string) {
		if (hiddenMeshes.includes(name)) hiddenMeshes = hiddenMeshes.filter((x) => x !== name);
		else hiddenMeshes = [...hiddenMeshes, name];
		scheduleSave();
	}

	// Anatomy counts derived from the segmentation. Numbers come straight from the
	// shared deriveToothMapping(): jaws are the 2 largest meshes by bbox volume,
	// Anatomic structure counts (teeth / jaws / canals) for the sidebar. Pure logic +
	// the no-sinus rationale live in computeAnatomyCounts (unit-tested). Sinus is NOT
	// reported — the model has no sinus class, so a "Sinus: 0" row would mislead.
	const anatomyCounts = $derived(
		!meshStats
			? { teeth: 0, jaws: 0, canals: 0 }
			: computeAnatomyCounts(
					meshStats.count,
					Object.keys(toothMapping.byFdi).length,
					toothMapping.jawMeshes.length,
					toothMapping.canalMeshes.length
				)
	);

	onMount(async () => {
		// Allow ?view=mpr|volume|panoramic|report to deep-link a tab.
		const sp = new URLSearchParams(window.location.search);
		const v = sp.get('view');
		if (v === 'mpr' || v === 'volume' || v === 'panoramic' || v === 'report') {
			store.layoutMode = v;
		}
		await tryLoadCachedSegmentation();
		await tryLoadVolume();
	});

	// Pre-parse mesh stats from a blob (GLTF JSON or GLB binary). Populates the
	// right sidebar before Volume3D mounts.
	async function preParseStats(blob: Blob) {
		try {
			const s = await statsFromBlob(blob);
			if (s) meshStats = s;
		} catch (e) {
			console.warn('preParseStats failed', e);
		}
	}

	async function tryLoadCachedSegmentation() {
		// LOCAL-FIRST: study.segmentationUrl is lazy/undefined after refresh; detect the cached
		// seg from the local DB so a SEGMENTED study doesn't look raw + re-offer "Run AI seg".
		const url = (await studies.freshFileUrl(study, 'segmentation')) ?? study.segmentationUrl;
		if (!url) return;
		try {
			progress = $_('cbct.runLoadingCached');
			const resp = await fetch(url, { signal: loadAbort.signal });
			if (destroyed) return;
			// V5: a REAL HTTP error (403 expired token, 500…) must NOT silently fall
			// back to the empty "Run AI Segmentation" CTA as if no seg existed — surface
			// a retry banner. A 404 (genuinely absent) does fall through to the CTA.
			const outcome = segLoadOutcome(resp);
			if (outcome === 'error') {
				error = $_('cbct.segLoadFailed');
				progress = '';
				return;
			}
			if (outcome === 'absent') {
				progress = '';
				return;
			}
			const blob = await resp.blob();
			if (destroyed) return;
			if (blob.size === 0) {
				progress = '';
				return;
			}
			// Cached blob is either a zip (cbct, preferred) or a raw GLTF/GLB.
			// Detect by reading the first 4 bytes — zip starts with `PK\x03\x04`.
			const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
			const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
			if (isZip) {
				const zip = await JSZip.loadAsync(blob);
				const name = Object.keys(zip.files).find((n) => n.endsWith('.gltf') || n.endsWith('.glb'));
				const gltfFile = name ? zip.file(name) : null;
				if (gltfFile) {
					const buf = await gltfFile.async('arraybuffer');
					const extracted = new Blob([buf], {
						type: name?.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json'
					});
					gltfBlob = extracted;
					await preParseStats(extracted);
				}
			} else {
				gltfBlob = blob;
				await preParseStats(blob);
			}
			progress = '';
		} catch (err) {
			if (destroyed || (err as Error)?.name === 'AbortError') return;
			// A thrown failure (network down, or a non-ok response surfaced by a future
			// fetch wrapper) is a real error, not "no segmentation" — show the banner.
			console.warn('Cached segmentation load failed', err);
			error = $_('cbct.segLoadFailed');
			progress = '';
		}
	}

	async function tryLoadVolume() {
		// LOCAL-FIRST: study.imageDataUrl is lazy/undefined after refresh; detect the raw
		// volume from the local DB.
		const url = (await studies.freshFileUrl(study, 'image')) ?? study.imageDataUrl;
		if (!url) return;
		const filename = study.originalFilename ?? 'input.nii.gz';
		try {
			progress = $_('cbct.runParsingVolume');
			const resp = await fetch(url, { signal: loadAbort.signal });
			if (destroyed) return;
			if (segLoadOutcome(resp) === 'error') {
				error = $_('cbct.volumeLoadFailed');
				progress = '';
				return;
			}
			const blob = await resp.blob();
			if (destroyed) return;
			const vol = await loadVolumeFromBlob(blob, filename);
			if (destroyed) return;
			store.setVolume(vol);
			volumeLoaded = true;
			progress = '';
		} catch (err) {
			if (destroyed || (err as Error)?.name === 'AbortError') return;
			console.warn('Volume parse failed', err);
			error = `${$_('cbct.volumeParseFailed')}: ${(err as Error).message}`;
			progress = '';
		}
	}

	async function runSegmentation() {
		if (processing) return; // guard re-entry: a double-click (or the 3D-pane CTA, reachable mid-run) must not fire a second concurrent inference
		// LOCAL-FIRST: resolve the raw volume from the local DB (study.imageDataUrl is lazy).
		const sourceUrl = (await studies.freshFileUrl(study, 'image')) ?? study.imageDataUrl;
		if (!sourceUrl) {
			error = $_('cbct.runErrNoFile');
			return;
		}
		// A1: this fires a BILLABLE AI call (/api/ai/cbct_seg_inference). Gate it
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
			progress = $_('cbct.runDownloadingSource');
			const resp = await fetch(sourceUrl, { signal: loadAbort.signal });
			const blob = await resp.blob();
			const filename = study.originalFilename ?? 'input.nii.gz';
			const file = new File([blob], filename, { type: blob.type });

			if (!volumeLoaded) {
				progress = $_('cbct.runParsingVolume');
				const vol = await loadVolumeFromBlob(blob, filename);
				store.setVolume(vol);
				volumeLoaded = true;
			}

			progress = $_('cbct.runRunningSeg');
			// D5: thread the abort signal so navigating away mid-run cancels this
			// minutes-long BILLABLE call (mirrors the source-download fetch above).
			const zipBlob = await runCbctSeg(file, { seg_only: true }, loadAbort.signal);
			// D5: torn down while the seg ran — skip every post-await state write
			// (gltfBlob/processing/error) so a unit that's gone can't mutate (matches
			// the IOS sibling's post-runIosSeg guard).
			if (destroyed) return;

			// Persist the original zip — Go's mime sniff sees `application/zip`,
			// which is in the PB allowlist. GLTF as a JSON file would be sniffed
			// as `text/plain` and rejected unless we also allow that.
			progress = $_('cbct.runSavingSeg');
			// D6: a failed save after a PAID inference is the save-side analog of the
			// V5 load-side bug — the seg shows THIS session but the next visit shows the
			// Run-seg CTA again, so the user unknowingly RE-RUNS (re-bills) the inference.
			// Keep the computed blob + surface a non-blocking "couldn't save — retry" badge
			// instead of only console.warn. (Hold the blob so Retry needs no re-inference.)
			lastSegBlob = zipBlob;
			try {
				await studies.saveSegmentation(study.id, zipBlob, 'pred_seg.zip');
				segSaveFailed = false;
			} catch (saveErr) {
				console.warn('Failed to persist segmentation', saveErr);
				if (!destroyed) segSaveFailed = true;
			}

			progress = $_('cbct.runUnpacking');
			const zip = await JSZip.loadAsync(zipBlob);

			let gltfFile = zip.file('pred_seg.gltf');
			if (!gltfFile) {
				const candidates = Object.keys(zip.files).filter(
					(n) => n.endsWith('.gltf') || n.endsWith('.glb')
				);
				if (candidates[0]) gltfFile = zip.file(candidates[0]);
			}
			if (!gltfFile) {
				error = $_('cbct.runErrNoGltf');
				processing = false;
				return;
			}

			const gltfArrayBuffer = await gltfFile.async('arraybuffer');
			gltfBlob = new Blob([gltfArrayBuffer], { type: 'model/gltf+json' });
			progress = $_('cbct.runRendering3D');
		} catch (err) {
			// navigated away mid-run — skip error/paywall UI. We check `destroyed` too:
			// apiFetch wraps a thrown fetch-abort as ApiError(0) (losing the AbortError
			// name), so the unmount-abort is otherwise indistinguishable from a network
			// error; `destroyed` is set before loadAbort.abort() in onDestroy (D5).
			if (destroyed || (err as Error)?.name === 'AbortError') return;
			const m = err as { status?: number; body?: { message?: string }; message?: string };
			// Defense in depth (A1): the server is the source of truth — a 403 means the
			// subscription lapsed/was never valid even if the client cache said otherwise.
			// Open the paywall instead of dumping the raw 403 message, mirroring the X-ray
			// siblings (upload/+page.svelte, GlobalDropZone.svelte).
			if (shouldPaywall(auth.hasActiveSubscription, m.status)) {
				paywallReason = m.body?.message || 'No Subscription';
				paywallOpen = true;
			} else {
				// Localized: backend non-403 messages are raw English-technical (A1) — never show them.
				error = $_(operationErrorKey(err, 'cbct.runFailed'));
			}
		} finally {
			processing = false;
		}
	}

	// D6: re-attempt the post-inference save using the blob we still hold — no second
	// (billable) inference. Clears the badge on success; leaves it on continued failure.
	async function retrySegSave() {
		if (!lastSegBlob || segSaveRetrying) return;
		segSaveRetrying = true;
		try {
			await studies.saveSegmentation(study.id, lastSegBlob, 'pred_seg.zip');
			if (!destroyed) segSaveFailed = false;
		} catch (e) {
			console.warn('Segmentation save retry failed', e);
		} finally {
			if (!destroyed) segSaveRetrying = false;
		}
	}

	// D8: re-attempt the initial load after a seg-load / volume-parse failure. Without
	// this the error banner was a dead end — the Run-seg CTA is gated on `volumeLoaded`
	// (still false) so it never appeared, even though the message says "please retry".
	// Clear the error first, then re-run the same onMount sequence (seg cache, then the
	// raw volume). Guarded so a tap during an in-flight run doesn't stack loads.
	async function retryLoad() {
		if (processing) return;
		error = '';
		await tryLoadCachedSegmentation();
		await tryLoadVolume();
	}

	function fmtDate(iso: string) {
		return formatDisplayDate(iso, $locale ?? undefined);
	}

	function resetAll() {
		// D3: a view-reset (W/L, zoom, crosshair, camera, pane pan/zoom) is non-destructive
		// and the user expects it to always work — so do it unconditionally. Clearing the
		// markups, however, is destructive + durable (the empty list debounce-persists) and
		// markups aren't re-derivable, so confirm THAT part only. On cancel we still reset
		// the view but KEEP the annotations (best long-term: a view-reset shouldn't destroy
		// a clinician's measurements). Matches every other destructive action's confirm.
		store.resetWL();
		store.zoom = 1;
		store.crosshair = true;
		store.resetMprViews(); // reset each MPR pane's local pan/zoom
		volume3DRef?.resetView();
		const hasMarkups =
			store.measurements.length > 0 || store.angles.length > 0 || store.annotations.length > 0;
		if (!hasMarkups || confirm($_('cbct.clearMarkupsConfirm'))) {
			store.clearMarkups(); // drop measurements/angles/annotations
		}
	}

	// #44 keyboard nav: Up/Down scrub slices of the pane under the cursor (store.activeAxis,
	// set on pane mouseenter) — the standard CBCT shortcut alongside wheel/crosshair. Only in
	// the MPR layout, and never while the conditions modal is open or a control is focused.
	function handleKeydown(e: KeyboardEvent) {
		if (store.layoutMode !== 'mpr' || !store.volume) return;
		const step = sliceStepIntent(e.key, { blocked: conditionsTooth != null, target: e.target });
		if (!step) return;
		e.preventDefault();
		const ax = store.activeAxis;
		const max = maxSliceIndex(store.volume, ax);
		const next = Math.max(0, Math.min(max, store.slice[ax] + step));
		store.slice = { ...store.slice, [ax]: next };
	}
</script>

<svelte:window onkeydown={handleKeydown} />

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
		<span class="text-xs tracking-wider text-fg-2 uppercase">{$_('viewer.cbctAi')}</span>
		<span class="text-fg-2">•</span>
		<span class="text-sm text-fg-1">{fmtDate(study.capturedAt)}</span>
	</div>

	<!-- View mode tabs -->
	<div class="ml-4 flex items-center gap-1 rounded-md bg-bg-2 p-1">
		<button
			class="tab-btn"
			class:active={store.layoutMode === 'mpr'}
			aria-pressed={store.layoutMode === 'mpr'}
			onclick={() => (store.layoutMode = 'mpr')}
		>
			{$_('cbct.viewMpr')}
		</button>
		<button
			class="tab-btn"
			class:active={store.layoutMode === 'volume'}
			aria-pressed={store.layoutMode === 'volume'}
			onclick={() => (store.layoutMode = 'volume')}
		>
			{$_('cbct.view3d')}
		</button>
		<button
			class="tab-btn"
			class:active={store.layoutMode === 'panoramic'}
			aria-pressed={store.layoutMode === 'panoramic'}
			onclick={() => (store.layoutMode = 'panoramic')}
		>
			{$_('cbct.viewPanoramic')}
		</button>
		<button
			class="tab-btn"
			class:active={store.layoutMode === 'report'}
			aria-pressed={store.layoutMode === 'report'}
			onclick={() => (store.layoutMode = 'report')}
		>
			{$_('cbct.viewReport')}
		</button>
	</div>

	<div class="flex-1"></div>

	{#if !gltfBlob && volumeLoaded && !processing}
		<button
			class="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary"
			onclick={runSegmentation}
		>
			{$_('cbct.runSegmentation')}
		</button>
	{/if}
</div>

<!-- Body: tool rail + main + findings -->
<div class="flex min-h-0 flex-1 overflow-hidden">
	<CbctToolRail {store} onresetAll={resetAll} />

	<main class="relative flex-1 bg-black">
		{#if processing}
			<div class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-bg-0/85">
				<Loader2 size={40} class="animate-spin text-primary" />
				<div class="text-sm text-fg-1">{progress}</div>
				<div class="text-xs text-fg-2">{$_('cbct.largeVolumes')}</div>
			</div>
		{:else if !error && !volumeLoaded && !(store.layoutMode === 'volume' && gltfBlob)}
			<!-- The 3D volume view only needs the segmentation mesh (gltfBlob); it does NOT need
			     the raw grayscale volume (that's for MPR/panoramic). onMount loads the seg first,
			     then the much larger raw volume (~10-20s). Gating this full-screen overlay on
			     !volumeLoaded alone kept the ready 3D model hidden behind "Loading CBCT…" until
			     that unrelated volume parse finished. The extra clause hides it early in volume
			     view once the mesh is ready (Volume3D shows its own spinner meanwhile) — while
			     still clearing on !volumeLoaded so the "Run AI Segmentation" CTA appears when a
			     volume has no segmentation yet. The volume keeps loading in the background. -->
			<div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-bg-0/90">
				<Loader2 size={40} class="animate-spin text-primary" />
				<div class="text-sm text-fg-1">{progress || $_('cbct.loadingCbct')}</div>
			</div>
		{/if}

		{#if error}
			<div
				class="bg-danger-500/90 absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-2 text-xs text-bg-0"
				role="alert"
			>
				<span>{error}</span>
				<!-- D8: a retry so the volume-parse / seg-load error isn't a dead end (the
				     Run-seg CTA is gated on volumeLoaded, which stays false on failure). -->
				<button
					type="button"
					class="rounded bg-bg-0/20 px-2 py-0.5 font-semibold hover:bg-bg-0/30 disabled:opacity-50"
					onclick={retryLoad}
					disabled={processing}
				>
					{$_('common.retry')}
				</button>
			</div>
		{/if}

		<!-- D6: the seg computed but the (paid) result couldn't be persisted — warn so the
		     user knows it won't survive a revisit, and offer a Retry that re-saves the
		     held blob (no second inference). Non-blocking; sits below the error banner. -->
		{#if segSaveFailed}
			<div
				class="bg-warning-500/90 absolute top-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md px-3 py-2 text-xs text-bg-0"
				class:top-14={!!error}
				role="status"
			>
				<span>{$_('cbct.segSaveFailed')}</span>
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

		{#snippet maxBtn(pane: 'axial' | 'sagittal' | 'coronal' | 'volume')}
			<button
				class="absolute top-1 right-1 z-20 rounded bg-bg-0/70 p-1 text-fg-2 transition hover:text-fg-0"
				title={maximizedPane === pane ? $_('cbct.restore2x2') : $_('cbct.maximizePane')}
				aria-label={maximizedPane === pane ? $_('cbct.restoreLayout') : $_('cbct.maximizePane')}
				onclick={() => (maximizedPane = maximizedPane === pane ? null : pane)}
			>
				{#if maximizedPane === pane}<Minimize2 size={13} />{:else}<Maximize2 size={13} />{/if}
			</button>
		{/snippet}

		{#if store.layoutMode === 'mpr'}
			<div
				class="grid h-full w-full gap-px bg-border {maximizedPane
					? 'grid-cols-1 grid-rows-1'
					: 'grid-cols-2 grid-rows-2'}"
			>
				<div class="relative bg-black" class:hidden={maximizedPane && maximizedPane !== 'axial'}>
					<MprPane axis="axial" {store} label={$_('cbct.axial')} />
					{@render maxBtn('axial')}
				</div>
				<div class="relative bg-black" class:hidden={maximizedPane && maximizedPane !== 'sagittal'}>
					<MprPane axis="sagittal" {store} label={$_('cbct.sagittal')} />
					{@render maxBtn('sagittal')}
				</div>
				<div class="relative bg-black" class:hidden={maximizedPane && maximizedPane !== 'coronal'}>
					<MprPane axis="coronal" {store} label={$_('cbct.coronal')} />
					{@render maxBtn('coronal')}
				</div>
				<div class="relative bg-black" class:hidden={maximizedPane && maximizedPane !== 'volume'}>
					{#if gltfBlob}
						<Volume3D
							bind:this={volume3DRef}
							{gltfBlob}
							{hiddenMeshes}
							{reduceNoise}
							fdiByMeshIndex={toothMapping.byFdi}
							{selectedTooth}
							onselecttooth={(fdi) => (selectedTooth = fdi)}
							onopentooth={(fdi) => {
								selectedTooth = fdi;
								if (fdi != null) conditionsTooth = fdi;
							}}
							onstats={(s) => (meshStats = s)}
						/>
					{:else}
						<div
							class="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center"
						>
							<div class="text-sm text-fg-1">{$_('cbct.seg3dTitle')}</div>
							<div class="text-xs text-fg-2">{$_('cbct.seg3dDesc')}</div>
							{#if volumeLoaded}
								<button
									class="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary"
									onclick={runSegmentation}
								>
									{$_('cbct.runSegmentation')}
								</button>
							{/if}
						</div>
					{/if}
					{@render maxBtn('volume')}
				</div>
			</div>
		{:else if store.layoutMode === 'volume'}
			<div class="h-full w-full">
				{#if gltfBlob}
					<Volume3D
						bind:this={volume3DRef}
						{gltfBlob}
						{hiddenMeshes}
						{reduceNoise}
						fdiByMeshIndex={toothMapping.byFdi}
						{selectedTooth}
						onselecttooth={(fdi) => (selectedTooth = fdi)}
						onopentooth={(fdi) => {
							selectedTooth = fdi;
							if (fdi != null) conditionsTooth = fdi;
						}}
						orientGizmo
						onstats={(s) => (meshStats = s)}
					/>
				{:else}
					<div class="flex h-full w-full flex-col items-center justify-center gap-3">
						<div class="text-lg text-fg-1">{$_('cbct.volume3dTitle')}</div>
						<div class="max-w-sm text-center text-sm text-fg-2">
							{$_('cbct.volume3dDesc')}
						</div>
						{#if volumeLoaded}
							<button
								class="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-bg-0 hover:bg-primary"
								onclick={runSegmentation}
							>
								{$_('cbct.runSegmentation')}
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{:else if store.layoutMode === 'panoramic'}
			<div class="h-full w-full">
				<PanoramicView {store} />
			</div>
		{:else}
			<CbctReport
				{store}
				findings={synthesizedFindings}
				patientName={displayName}
				capturedAt={study.capturedAt}
				studyId={study.id}
			/>
		{/if}
	</main>

	{#if store.layoutMode !== 'report'}
		<CbctFindings
			{store}
			findings={synthesizedFindings}
			{anatomyCounts}
			meshInfos={meshStats?.meshInfos ?? []}
			{meshNameLabel}
			{meshSortRank}
			{hiddenMeshes}
			{reduceNoise}
			ontoggleMesh={toggleMesh}
			ontoggleReduceNoise={() => (reduceNoise = !reduceNoise)}
		/>
	{/if}

	<!-- #44: double-clicking a tooth in the 3D view opens its per-tooth conditions. -->
	<ToothConditionsModal
		tooth={conditionsTooth ?? 0}
		open={conditionsTooth != null}
		conditions={conditionsTooth != null
			? synthesizedFindings
					.filter((f) => f.tooth === conditionsTooth)
					// Pass the REAL confidence (undefined for a synthesized "Missing tooth"
					// gap, which has none) — the modal omits the pill rather than fabricate a %.
					.map((f) => ({ name: findingTypeLabel(f.type, $_), confidence: f.confidence }))
			: []}
		onclose={() => (conditionsTooth = null)}
	/>

	<!-- A1: subscription paywall for the billable "Run segmentation" AI call. -->
	<PaywallModal bind:open={paywallOpen} reason={paywallReason} />
</div>

<style>
	.tab-btn {
		padding: 0.25rem 0.75rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-fg-2);
		background: transparent;
		border: none;
		cursor: pointer;
		font-weight: 500;
	}
	.tab-btn:hover {
		color: var(--color-fg-0);
	}
	.tab-btn.active {
		background: var(--color-bg-1);
		color: var(--color-fg-0);
	}
</style>
