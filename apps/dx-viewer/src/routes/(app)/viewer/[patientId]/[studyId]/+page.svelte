<script lang="ts">
	import { page } from '$app/state';
	import XrayCanvas from '$lib/components/XrayCanvas.svelte';
	import FindingsPanel from '$lib/components/FindingsPanel.svelte';
	import ReportPanel from '$lib/components/ReportPanel.svelte';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import FmxNavigator from '$lib/components/FmxNavigator.svelte';
	import { studies } from '$lib/stores/studies.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _, locale } from 'svelte-i18n';
	import {
		ArrowLeft,
		ChevronLeft,
		ChevronRight,
		ZoomIn,
		ZoomOut,
		Maximize2,
		FileText,
		RotateCw,
		SunMedium,
		Hash,
		ImageDown,
		RefreshCw,
		Calendar,
		Image as ImageIcon,
		Camera,
		FlipHorizontal,
		FlipVertical,
		Search,
		Sparkles,
		Contrast,
		Square,
		PenTool,
		X as XIcon
	} from 'lucide-svelte';
	import { DISEASE_CLASSES, PEARL_FINDING_TAXONOMY } from '$lib/constants';
	import type { InferenceResponse, UserEdits } from '$lib/types';
	import {
		withEffectiveDetections,
		normalizeUserEdits,
		effectiveDetections
	} from '$lib/detections';
	import { clearHidden, hideAi, removeAdded } from '$lib/detectEdit';
	import { onMount } from 'svelte';
	import { buildReportPdf } from '$lib/reportPdf';
	import type { ReportStatus } from '$lib/reportState';
	import logoUrl from '$lib/assets/logo.png';
	import { history } from '$lib/stores/history.svelte';
	import { formatDisplayDate } from '$lib/date';
	import { arrowNavIntent } from '$lib/keyboard';
	import { prefs } from '$lib/stores/prefs.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { userInitials } from '$lib/initials';
	import { formatDecimal } from '$lib/number';
	import { hasViewableImage } from '$lib/modality';
	import { studyRoutePath } from '$lib/studyRoute';

	const patientId = $derived(page.params.patientId);
	const studyId = $derived(page.params.studyId);
	const patient = $derived(studies.getPatient(patientId!));
	const study = $derived(studies.getStudy(patientId!, studyId!));

	// The bulk studies refresh omits the per-study `inference` blob (bounded-memory
	// load); fetch it lazily for THIS patient so the AI overlay (XrayCanvas), the
	// FindingsPanel counts, and the FmxNavigator finding-dots populate. Fire-and-
	// forget: ensureInference patches inference reactively, so the overlay appears
	// as soon as it resolves (a brief no-overlay flash is acceptable). Re-runs when
	// the patient becomes available (after refresh) or the route's patient changes.
	$effect(() => {
		if (patient && patientId) studies.ensureInference(patientId);
	});

	// LOCAL-FIRST: resolve the object URL for this patient's 2D images from IndexedDB so
	// the XrayCanvas (and the FMX navigator films) have an `imageDataUrl` to render.
	$effect(() => {
		if (patient && patientId) studies.ensurePatientImages(patientId);
	});

	// A study whose modality is not a 2D raster image (CBCT / IOS) cannot be shown
	// in <XrayCanvas> — its `image` is a raw volume/mesh (.nii.gz / .obj …), which
	// would load as a broken bitmap and trip the canvas's misleading "couldn't load
	// this image / check your connection" retry panel (which can never succeed).
	// Such a URL is reachable by bookmark, typed address, or a hand-edited id, so
	// redirect to the correct 3D viewer instead (guarded against redirect loops:
	// only fires for a genuinely non-2D modality, and only once per study id).
	const wrongModality = $derived(!!study && !hasViewableImage(study.modality));
	const correctRoute = $derived(
		study ? studyRoutePath(study.modality, study.patientId, study.id) : ''
	);
	let redirectedFor = $state('');
	$effect(() => {
		if (wrongModality && study && redirectedFor !== study.id) {
			redirectedFor = study.id;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- correctRoute derives from the resolve()-backed studyRoutePath
			void goto(correctRoute, { replaceState: true });
		}
	});

	let recordedId = '';
	$effect(() => {
		if (patient && study && study.id !== recordedId) {
			recordedId = study.id;
			history.record({
				patientId: patientId!,
				studyId: study.id,
				patientName: patient.name,
				modality: study.modality,
				kind: 'viewer'
			});
		}
	});
	const allStudies = $derived(patient?.studies ?? []);
	// Panoramic gated on the Panoramic opt-in (matches the patient page) — with it off,
	// panoramic studies drop out of the X-ray prev/next set + FMX.
	const xrayStudies = $derived(
		allStudies.filter(
			(s) => s.modality === 'xray' || (auth.panoramicEnabled && s.modality === 'panoramic')
		)
	);
	// Photos gated behind the per-user "Show Photos" opt-in (empty when off → tab hidden).
	const photoStudies = $derived(
		auth.photoEnabled ? allStudies.filter((s) => s.modality === 'photo') : []
	);
	const currentIdx = $derived(xrayStudies.findIndex((s) => s.id === studyId));

	// The in-viewer PHI toggle + masking was removed (clinician request) — the 2D viewer
	// always shows the real patient name/initials. (Still used by the header + the report PDF.)
	const displayName = $derived(patient?.name ?? '');
	const displayInitials = $derived(patient?.initials ?? '');
	// Tooth numbering is a GLOBAL preference (one number everywhere — #126), so the
	// in-viewer FDI checkbox sets the shared reactive pref directly rather than keeping
	// a local mirror + write-back. `fdi` is derived from it, so toggling the checkbox
	// updates this viewer's overlay AND the chart/report/3D layers in lock-step (and any
	// other open tab). The checkbox's onchange (below) calls prefs.setToothNumbering.
	const fdi = $derived(prefs.toothNumbering === 'fdi');
	// Confidence threshold from Settings — hide AI findings below this score. Reads the
	// shared reactive pref so a Settings/other-tab change live-updates the overlay +
	// findings panel (parseConfThreshold already NaN-guards/clamps it inside the store).
	const confThreshold = $derived(prefs.confThreshold);
	let fmxView = $state(false);
	// Right-hand panel: AI Analysis (diagnostic results) vs the Report tab (editable
	// report + Acceptable/Unacceptable + copy + download PDF). The old report modal was
	// replaced by this tab so the report lives where the screenshots show it.
	let sideTab = $state<'analysis' | 'report'>('analysis');
	let showAdjust = $state(false);
	let brightness = $state(1);
	let contrast = $state(1);
	let saturate = $state(1);
	let sharpness = $state(0);
	let toolMode = $state<'pan' | 'magnify'>('pan');
	// Detection-editor draw mode mirror (drives + reflects XrayCanvas.setEditMode).
	let editDrawMode = $state<'off' | 'rect' | 'free'>('off');
	// Single-select tools (requested): the active "tool" is at most one of magnify /
	// rect-draw / free-draw at a time. Selecting any one deselects the others — so the
	// magnifier and an edit-draw mode can never be active together. `pan` + `editDrawMode
	// === 'off'` is the neutral (no-tool) state.
	function setEdit(m: 'off' | 'rect' | 'free') {
		editDrawMode = editDrawMode === m ? 'off' : m;
		if (editDrawMode !== 'off') toolMode = 'pan'; // entering a draw mode deselects magnify
		canvasRef?.setEditMode(editDrawMode);
	}
	function toggleMagnify() {
		toolMode = toolMode === 'magnify' ? 'pan' : 'magnify';
		if (toolMode === 'magnify' && editDrawMode !== 'off') {
			// Selecting magnify deselects any active edit-draw tool.
			editDrawMode = 'off';
			canvasRef?.setEditMode('off');
		}
	}
	// The clinician's initials, tagged onto any detection THEY add (instead of a
	// fabricated AI confidence %). Reactive so it's correct after a same-session re-login.
	const annotationInitials = $derived(userInitials(auth.user));
	let tab = $state<'xrays' | 'photos'>('xrays');
	// If Photos is disabled mid-session (the tab button is gated away), fall back to X-rays
	// so the user isn't stranded on a now-hidden, empty Photos tab.
	$effect(() => {
		if (tab === 'photos' && !auth.photoEnabled) tab = 'xrays';
	});
	let canvasRef = $state<XrayCanvas | undefined>(undefined);

	let layers = $state({
		bboxes: true,
		toothNumbers: true,
		anatomy: false,
		diseaseSeg: true,
		measurements: false,
		visibleClasses: new Set<number>(DISEASE_CLASSES.map((c) => c.id))
	});

	// Keep these slider values in sync with XrayCanvas's own per-study reset (the
	// canvas resets its rotation/flip/invert/brightness/… when studyKey changes;
	// here we mirror the brightness/contrast/saturate/sharpness slider UI back to
	// defaults so the sliders don't show stale values from the previous study).
	let lastAdjustStudyId = '';
	$effect(() => {
		const id = study?.id;
		if (id && id !== lastAdjustStudyId) {
			lastAdjustStudyId = id;
			brightness = 1;
			contrast = 1;
			saturate = 1;
			sharpness = 0;
			// Mirror the canvas's per-study editor reset so the toolbar's draw-mode chip
			// doesn't stay "active" after switching studies (the canvas drops editMode +
			// any pending disease-pick on the same study change).
			editDrawMode = 'off';
		}
	});

	const inference = $derived.by(() => {
		if (!study) return null;
		return (study.inference ?? null) as InferenceResponse | null;
	});

	// The clinician's detection edits for this study (hide/add/resize), lazy-loaded with
	// the inference. The EDITOR (XrayCanvas) works against the raw inference + these edits;
	// every read-only consumer (findings panel, counts, printout) reads the EFFECTIVE
	// inference below, which composites AI − hidden + added + resizes — so a hidden box
	// drops from the counts/by-tooth/report and an added one appears, all from one place.
	const userEdits = $derived((study?.userEdits ?? null) as UserEdits | null);
	const effectiveInference = $derived(withEffectiveDetections(inference, userEdits));

	function addPhoto() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()-built path + query string (resolve can't carry queries)
		goto(`${resolve('/(app)/upload')}?patient=${patientId}&modality=photo`);
	}

	async function persistEdits(edits: UserEdits) {
		if (!study) return;
		try {
			await studies.saveUserEdits(study.id, edits);
		} catch (err) {
			console.error('saveUserEdits failed', err);
			editError = $_('detect.saveFailed');
			setTimeout(() => (editError = ''), 4000);
		}
	}
	let editError = $state('');

	// Hiding an AI detection drops it from the render, so it can't be hovered to un-hide —
	// without a restore path a finding hidden by accident (or later disagreed with) is lost
	// from the clinician's view permanently (`hidden` persists across reload). This button
	// appears whenever findings are hidden and restores them all (the AI stays pristine).
	const hiddenCount = $derived(userEdits ? normalizeUserEdits(userEdits).hidden.length : 0);
	function restoreHidden() {
		if (!userEdits) return;
		void persistEdits(clearHidden(normalizeUserEdits(userEdits)));
	}

	function prevStudy() {
		if (currentIdx > 0 && xrayStudies[currentIdx - 1]) {
			goto(
				resolve('/(app)/viewer/[patientId]/[studyId]', {
					patientId: patientId!,
					studyId: xrayStudies[currentIdx - 1]!.id
				})
			);
		}
	}
	function nextStudy() {
		if (currentIdx < xrayStudies.length - 1 && xrayStudies[currentIdx + 1]) {
			goto(
				resolve('/(app)/viewer/[patientId]/[studyId]', {
					patientId: patientId!,
					studyId: xrayStudies[currentIdx + 1]!.id
				})
			);
		}
	}

	onMount(async () => {
		if (studies.patients.length === 0) {
			// Catch so a transient load failure falls through to the redirect below
			// instead of stranding the viewer on its loading spinner (see #56).
			try {
				await studies.refresh();
			} catch {
				/* fall through to the redirect */
			}
		}
		if (!study) {
			goto(resolve('/(app)/studies'));
			return;
		}
		initialLoadDone = true;
	});

	// Deleted-while-open: another tab deleting this study now PROPAGATES (the cross-tab
	// change channel refreshes the projection), flipping the template to its {:else}
	// spinner FOREVER. Leave with the same redirect instead of stranding the clinician.
	// Gated on initialLoadDone (the spinner is correct during the initial load) and on
	// !studies.loading (don't fire mid-refresh).
	let initialLoadDone = $state(false);
	$effect(() => {
		if (initialLoadDone && !studies.loading && !study) goto(resolve('/(app)/studies'));
	});

	// Hide/remove a single finding from the Diagnostic Results list (the per-row control).
	// The panel emits the detection's index into the EFFECTIVE inference; map it back to the
	// AI index / added id via the same compositor the panel reads, then persist the edit
	// (a hidden AI finding is recoverable via the "Restore hidden" tool).
	function editFinding(effIndex: number) {
		const dets = effectiveDetections(inference, userEdits, 0);
		const d = dets[effIndex];
		if (!d) return;
		const cur = normalizeUserEdits(userEdits);
		if (d.source === 'user' && d.addedId) void persistEdits(removeAdded(cur, d.addedId));
		else if (d.aiIndex != null) void persistEdits(hideAi(cur, d.aiIndex));
	}

	// Build + download the styled PDF report (one-click). Uses the live canvas (base image
	// + annotated composite), the AI's rendered tooth-numbering/segmentation thumbnails, and
	// the report text/verdict from the Report tab.
	let pdfBusy = $state(false);
	async function exportReportPdf(payload: { text: string; status: ReportStatus }) {
		if (pdfBusy || !study) return;
		pdfBusy = true;
		try {
			const b64 = (v: string | undefined) => (v ? `data:image/jpeg;base64,${v}` : null);
			const legend = PEARL_FINDING_TAXONOMY.map((r) => ({
				label: $_('taxonomy.' + r.key),
				color: r.color
			})).filter((l) => !!l.label);
			await buildReportPdf({
				patientName: displayName,
				dob: patient?.dob ?? '',
				dentist: auth.user?.name || auth.user?.email || '',
				analysisDate: fmtDate(study.capturedAt),
				images: {
					original: canvasRef?.getBaseImageDataUrl() ?? study.imageDataUrl ?? null,
					toothNumbers: b64(inference?.tooth_numbers),
					segmentation: b64(inference?.segmentation),
					annotated: canvasRef?.getCompositeDataUrl() ?? b64(inference?.detection)
				},
				legend,
				reportMarkdown: payload.text,
				status: payload.status,
				logo: logoUrl,
				strings: {
					patientLabel: $_('viewer.reportPatientName'),
					dobLabel: $_('viewer.reportDob'),
					dentistLabel: $_('viewer.reportDentistName'),
					analysisLabel: $_('viewer.reportAnalysisDate'),
					notSpecified: $_('viewer.reportNotSpecified'),
					xrayImagesHeading: $_('viewer.reportXrayImages'),
					originalCaption: $_('viewer.reportOriginal'),
					toothNumberingCaption: $_('viewer.reportToothNumbering'),
					segmentationCaption: $_('viewer.reportSegmentation'),
					analysisHeading: $_('viewer.reportAnalysisDiagnostics'),
					reportHeading: $_('viewer.reportRadiographic'),
					disclaimer: $_('viewer.reportDisclaimer'),
					fileBase: `${displayName.replace(/\s+/g, '_')}_${$_('viewer.reportFileTag')}`
				}
			});
		} catch (err) {
			console.error('report PDF export failed', err);
			alert($_('viewer.reportPdfFailed'));
		} finally {
			pdfBusy = false;
		}
	}

	function fmtDate(iso: string) {
		return formatDisplayDate(iso, $locale ?? undefined);
	}

	// PhotoGallery's lightbox (on the photos tab) opens its own arrow-key handler
	// to step prev/next photo. Without this check the viewer ALSO consumed the
	// arrow and navigated to a different X-ray study at the same time — the user
	// hit → expecting "next photo" and ended up on a different study with no
	// lightbox. Both modals declare role="dialog" aria-modal="true", so this is
	// the cheapest cross-component coordination.
	function hasOpenChildModal(): boolean {
		if (typeof document === 'undefined') return false;
		return !!document.querySelector('[role="dialog"][aria-modal="true"]');
	}

	function handleKeydown(e: KeyboardEvent) {
		// Close the adjust popover on Escape (standard modal UX).
		if (e.key === 'Escape') {
			if (showAdjust) showAdjust = false;
			return;
		}
		// Left/Right arrows step through the patient's X-rays (standard viewer UX —
		// the #44 keyboard-nav parity gap), unless a child modal is open or the user is
		// typing / adjusting a control (e.g. a slider, or the report editor textarea).
		const intent = arrowNavIntent(e.key, {
			blocked: hasOpenChildModal(),
			target: e.target
		});
		if (!intent) return;
		e.preventDefault();
		if (intent === 'prev') prevStudy();
		else nextStudy();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if patient && study && wrongModality}
	<!-- 3D study opened in the 2D route (bookmark / typed / hand-edited id). The
	     redirect $effect above sends the user to the correct viewer; this panel is
	     the visible fallback (and avoids flashing XrayCanvas's misleading image-load
	     error in the moment before navigation completes). -->
	<div class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
		<p class="max-w-md leading-relaxed text-fg-1">{$_('viewer.wrongModality')}</p>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- correctRoute derives from the resolve()-backed studyRoutePath -->
		<a class="open-3d-cta" href={correctRoute}>{$_('viewer.openIn3d')}</a>
	</div>
{:else if patient && study}
	<!-- Pearl-style viewer top bar -->
	<header class="flex h-12 items-center gap-3 border-b border-border bg-bg-0 px-4">
		<button
			onclick={() => goto(resolve('/(app)/patients/[patientId]', { patientId: patientId! }))}
			aria-label={$_('viewer.back')}
			class="text-fg-2 hover:text-fg-0"
		>
			<ArrowLeft size={16} />
		</button>
		<div class="flex items-center gap-2">
			<div
				class="flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-fg-0"
				style:background="color-mix(in oklab, {patient.ringColors[0]} 22%, var(--color-bg-2))"
				style:border="1px solid color-mix(in oklab, {patient.ringColors[0]} 45%, transparent)"
			>
				{displayInitials}
			</div>
			<span class="text-sm font-medium text-fg-0">{displayName}</span>
		</div>

		<!-- FMX is gated behind the Panoramic opt-in — without panoramic there is no FMX. -->
		{#if auth.panoramicEnabled}
			<label class="ml-3 flex items-center gap-1.5">
				<span class="text-[11px] text-fg-2 uppercase">{$_('viewer.fmx')}</span>
				<input
					type="checkbox"
					bind:checked={fmxView}
					class="pearl-switch"
					onchange={() =>
						fmxView && goto(resolve('/(app)/patients/[patientId]', { patientId: patientId! }))}
				/>
			</label>
		{/if}

		<!-- Capture-date display (informational — not a control; the viewer navigates
		     studies via prev/next, so this is a label, not a clickable button). -->
		<div
			class="ml-1 flex items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3 py-1 text-xs text-fg-1"
		>
			<Calendar size={12} class="text-fg-2" />
			{fmtDate(study.capturedAt)}
		</div>

		<div class="flex-1"></div>

		<!-- X-rays / Photos tabs (centered) -->
		<div class="flex gap-1">
			<button
				class="tab-pill"
				class:active={tab === 'xrays'}
				aria-pressed={tab === 'xrays'}
				onclick={() => (tab = 'xrays')}
			>
				<ImageIcon size={11} />
				{$_('viewer.xrays')} ({xrayStudies.length})
			</button>
			{#if auth.photoEnabled}
				<button
					class="tab-pill"
					class:active={tab === 'photos'}
					aria-pressed={tab === 'photos'}
					onclick={() => (tab = 'photos')}
				>
					<Camera size={11} />
					{$_('viewer.photos')} ({photoStudies.length})
				</button>
			{/if}
		</div>

		<div class="flex-1"></div>
	</header>

	<div class="flex min-h-0 flex-1">
		<!-- Vertical tool icons strip — docked on the LEFT (between the nav and the canvas). -->
		<div
			class="flex w-[44px] flex-col items-center gap-0.5 border-r border-border bg-bg-0 py-2 text-fg-2"
		>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.zoom(1.25)}
				aria-label={$_('viewer.zoomIn')}
				title={$_('viewer.zoomIn')}><ZoomIn size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.zoom(0.8)}
				aria-label={$_('viewer.zoomOut')}
				title={$_('viewer.zoomOut')}><ZoomOut size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.reset()}
				aria-label={$_('viewer.fitScreen')}
				title={$_('viewer.fitScreen')}><Maximize2 size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.actualSize()}
				aria-label={$_('viewer.actualSize')}
				title={$_('viewer.actualSize')}><span class="text-[9px] font-semibold">1:1</span></button
			>
			<button
				class="tool-btn"
				class:active={toolMode === 'magnify'}
				aria-pressed={toolMode === 'magnify'}
				onclick={toggleMagnify}
				aria-label={$_('viewer.magnifier')}
				title={$_('viewer.magnifier')}><Search size={14} /></button
			>
			<div class="my-1 h-px w-5 bg-border"></div>
			<!-- Detection editor: draw a rectangle / freeform region to ADD a detection,
			     or hover an existing one to hide/resize it. -->
			<button
				class="tool-btn"
				class:active={editDrawMode === 'rect'}
				aria-pressed={editDrawMode === 'rect'}
				data-testid="detect-add-rect"
				onclick={() => setEdit('rect')}
				aria-label={$_('detect.addRect')}
				title={$_('detect.addRect')}><Square size={14} /></button
			>
			<button
				class="tool-btn"
				class:active={editDrawMode === 'free'}
				aria-pressed={editDrawMode === 'free'}
				data-testid="detect-add-free"
				onclick={() => setEdit('free')}
				aria-label={$_('detect.addFree')}
				title={$_('detect.addFree')}><PenTool size={14} /></button
			>
			{#if editDrawMode !== 'off'}
				<button
					class="tool-btn active"
					data-testid="detect-done"
					onclick={() => setEdit('off')}
					aria-label={$_('detect.done')}
					title={$_('detect.done')}><XIcon size={14} /></button
				>
			{/if}
			{#if hiddenCount > 0}
				<!-- Recovery path: restore findings hidden via the canvas's hide affordance
				     (otherwise a hidden finding can't be un-hidden — it isn't rendered to hover). -->
				<button
					class="tool-btn relative"
					data-testid="detect-restore-hidden"
					onclick={restoreHidden}
					aria-label={$_('detect.restoreHidden', { values: { n: hiddenCount } })}
					title={$_('detect.restoreHidden', { values: { n: hiddenCount } })}
				>
					<RefreshCw size={14} />
					<span
						class="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-bg-0"
						>{hiddenCount}</span
					>
				</button>
			{/if}
			<div class="my-1 h-px w-5 bg-border"></div>
			<!-- One rotation control (90° clockwise per click) — the duplicate rotate-left
			     button was removed per the clinician feedback ("only have one way for
			     rotation"). Both mirror controls (flip H + flip V) are kept. -->
			<button
				class="tool-btn"
				onclick={() => canvasRef?.rotateBy(90)}
				aria-label={$_('viewer.rotate')}
				title={$_('viewer.rotate')}><RotateCw size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.toggleFlipH()}
				aria-label={$_('viewer.flipH')}
				title={$_('viewer.flipH')}><FlipHorizontal size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.toggleFlipV()}
				aria-label={$_('viewer.flipV')}
				title={$_('viewer.flipV')}><FlipVertical size={14} /></button
			>
			<div class="my-1 h-px w-5 bg-border"></div>
			<button
				class="tool-btn"
				class:active={showAdjust}
				aria-pressed={showAdjust}
				onclick={() => (showAdjust = !showAdjust)}
				aria-label={$_('viewer.adjust')}
				title={$_('viewer.adjust')}><SunMedium size={14} /></button
			>
			<button
				class="tool-btn"
				onclick={() => canvasRef?.toggleInvert()}
				aria-label={$_('viewer.invert')}
				title={$_('viewer.invert')}><ImageDown size={14} /></button
			>
			<div class="my-1 h-px w-5 bg-border"></div>
			<button
				class="tool-btn"
				class:active={layers.toothNumbers}
				aria-pressed={layers.toothNumbers}
				onclick={() => (layers = { ...layers, toothNumbers: !layers.toothNumbers })}
				aria-label={$_('viewer.toothNumbersTool')}
				title={$_('viewer.toothNumbersTool')}><Hash size={14} /></button
			>
			<button
				class="tool-btn"
				class:active={layers.anatomy}
				aria-pressed={layers.anatomy}
				onclick={() => (layers = { ...layers, anatomy: !layers.anatomy })}
				aria-label={$_('viewer.anatomyTool')}
				title={$_('viewer.anatomyTool')}><Sparkles size={14} /></button
			>
			<div class="my-1 h-px w-5 bg-border"></div>
			<button
				class="tool-btn"
				onclick={() => {
					// Keep the adjustment-panel sliders in sync with the canvas reset,
					// otherwise they keep showing stale values after a full reset.
					brightness = 1;
					contrast = 1;
					saturate = 1;
					sharpness = 0;
					canvasRef?.resetAdjustments();
				}}
				aria-label={$_('viewer.resetAdjustments')}
				title={$_('viewer.reset')}><RefreshCw size={14} /></button
			>
			<!-- The in-viewer FDI / Universal tooth-numbering switch was removed per the
			     clinician feedback ("remove tooth numbering system switch"). The numbering
			     system is still configurable once, in Settings (default Universal); every
			     view follows that single preference. -->
		</div>

		<!-- Main image area -->
		<div class="relative flex flex-1 flex-col">
			<!-- Tiny back-to-FMX chevron pinned to the left edge (FMX gated on Panoramic). -->
			{#if auth.panoramicEnabled}
				<button
					class="back-fmx absolute top-1/2 left-0 z-10 -translate-y-1/2"
					onclick={() => goto(resolve('/(app)/patients/[patientId]', { patientId: patientId! }))}
					aria-label={$_('viewer.fullFmx')}
				>
					<ChevronLeft size={14} />
				</button>
			{/if}
			{#if xrayStudies.length > 1}
				<button
					class="nav-arrow left-2"
					onclick={prevStudy}
					disabled={currentIdx <= 0}
					aria-label={$_('viewer.prevStudy')}><ChevronLeft size={20} /></button
				>
				<button
					class="nav-arrow right-2"
					onclick={nextStudy}
					disabled={currentIdx >= xrayStudies.length - 1}
					aria-label={$_('viewer.nextStudy')}><ChevronRight size={20} /></button
				>
			{/if}
			{#if auth.panoramicEnabled && tab === 'xrays' && (xrayStudies.length > 1 || xrayStudies.some((s) => s.modality === 'panoramic' && (s.inference?.extra?.number_result?.result?.labels?.length ?? 0) > 0))}
				<!-- FMX navigator: a mini full-mouth map showing which frame this is; hover
				     to expand to thumbnails with finding dots, click a frame to open it.
				     Also shown for a single-panoramic patient — the patches derived from
				     the pano give the same anatomical overview the multi-X-ray FMX does. -->
				<div class="absolute top-2 left-1/2 z-10 -translate-x-1/2">
					<FmxNavigator
						studies={xrayStudies}
						currentStudyId={study.id}
						onPick={(s) => {
							if (s.id !== study.id)
								goto(
									resolve('/(app)/viewer/[patientId]/[studyId]', {
										patientId: patientId!,
										studyId: s.id
									})
								);
						}}
					/>
				</div>
			{/if}
			<XrayCanvas
				bind:this={canvasRef}
				imageUrl={study.imageDataUrl ?? ''}
				studyKey={study.id}
				inference={effectiveInference}
				rawInference={inference}
				edits={userEdits}
				{layers}
				{fdi}
				{confThreshold}
				userInitials={annotationInitials}
				bind:toolMode
				onEditsChange={persistEdits}
			/>
			{#if editError}
				<!-- A failed detection-edit save was SILENT: editError was set in
				     persistEdits' catch but never rendered (eslint no-unused-vars
				     surfaced it pre-deploy). The clinician must know the edit didn't
				     persist. -->
				<div
					class="bg-danger-500/90 absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-md px-3 py-2 text-xs text-bg-0"
					role="alert"
				>
					{editError}
				</div>
			{/if}
			{#if showAdjust}
				<div
					class="absolute top-3 right-3 z-20 w-64 rounded-xl border border-border bg-bg-1 p-3 shadow-2xl"
				>
					<div class="mb-2 flex items-center justify-between text-xs font-semibold text-fg-1">
						<span>{$_('viewer.imageAdjustments')}</span>
						<button
							class="text-fg-2 hover:text-fg-0"
							aria-label={$_('common.close')}
							onclick={() => (showAdjust = false)}>×</button
						>
					</div>
					<div class="space-y-3">
						<div>
							<div
								class="mb-1 flex items-center justify-between text-[10px] tracking-wide text-fg-2 uppercase"
							>
								<span><SunMedium size={11} class="-mt-0.5 inline" /> {$_('viewer.brightness')}</span
								>
								<span class="font-mono text-fg-1"
									>{formatDecimal(brightness, $locale ?? undefined)}</span
								>
							</div>
							<input
								type="range"
								min="0.3"
								max="2.5"
								step="0.05"
								aria-label={$_('viewer.brightness')}
								bind:value={brightness}
								oninput={() => canvasRef?.setBrightness(brightness)}
								class="w-full accent-primary"
							/>
						</div>
						<div>
							<div
								class="mb-1 flex items-center justify-between text-[10px] tracking-wide text-fg-2 uppercase"
							>
								<span><Contrast size={11} class="-mt-0.5 inline" /> {$_('viewer.contrast')}</span>
								<span class="font-mono text-fg-1"
									>{formatDecimal(contrast, $locale ?? undefined)}</span
								>
							</div>
							<input
								type="range"
								min="0.3"
								max="2.5"
								step="0.05"
								aria-label={$_('viewer.contrast')}
								bind:value={contrast}
								oninput={() => canvasRef?.setContrast(contrast)}
								class="w-full accent-primary"
							/>
						</div>
						<div>
							<div
								class="mb-1 flex items-center justify-between text-[10px] tracking-wide text-fg-2 uppercase"
							>
								<span>✨ {$_('viewer.sharpness')}</span>
								<span class="font-mono text-fg-1"
									>{formatDecimal(sharpness, $locale ?? undefined)}</span
								>
							</div>
							<input
								type="range"
								min="0"
								max="3"
								step="0.1"
								aria-label={$_('viewer.sharpness')}
								bind:value={sharpness}
								oninput={() => canvasRef?.setSharpness(sharpness)}
								class="w-full accent-primary"
							/>
						</div>
						<div>
							<div
								class="mb-1 flex items-center justify-between text-[10px] tracking-wide text-fg-2 uppercase"
							>
								<span>🎨 {$_('viewer.saturation')}</span>
								<span class="font-mono text-fg-1"
									>{formatDecimal(saturate, $locale ?? undefined)}</span
								>
							</div>
							<input
								type="range"
								min="0"
								max="3"
								step="0.05"
								aria-label={$_('viewer.saturation')}
								bind:value={saturate}
								oninput={() => canvasRef?.setSaturate(saturate)}
								class="w-full accent-primary"
							/>
						</div>
						<button
							class="w-full rounded border border-border py-1 text-xs text-fg-2 hover:text-fg-0"
							onclick={() => {
								brightness = 1;
								contrast = 1;
								saturate = 1;
								sharpness = 0;
								canvasRef?.setBrightness(1);
								canvasRef?.setContrast(1);
								canvasRef?.setSaturate(1);
								canvasRef?.setSharpness(0);
							}}
						>
							{$_('viewer.reset')}
						</button>
					</div>
				</div>
			{/if}
			{#if xrayStudies.length > 1}
				<div
					class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-bg-1/80 px-3 py-1 text-[11px] text-fg-2 backdrop-blur"
				>
					{currentIdx + 1} / {xrayStudies.length}
				</div>
			{/if}
			{#if tab === 'photos'}
				<!-- Patient camera photos (modality 'photo'): a scrollable gallery with a
				     lightbox + delete, or an empty state with an "Add photo" shortcut. -->
				<div class="absolute inset-0 z-30 overflow-y-auto bg-bg-0">
					<PhotoGallery
						photos={photoStudies}
						onDelete={async (id) => {
							if (!confirm($_('viewer.deleteStudyConfirm'))) return;
							try {
								await studies.deleteStudy(id);
							} catch (err) {
								// Sibling of the patient-page delete (#117): surface the failure
								// instead of swallowing it silently.
								console.error(err);
								alert($_('common.deleteStudyFailed'));
							}
						}}
						onAdd={addPhoto}
					/>
				</div>
			{/if}
		</div>

		<!-- Right panel: AI Analysis (diagnostic results) ↔ Report tabs -->
		<div class="flex w-[290px] flex-shrink-0 flex-col border-l border-border">
			<div class="side-tabs" role="tablist" aria-label={$_('viewer.rightPanel')}>
				<button
					type="button"
					role="tab"
					class="side-tab"
					class:active={sideTab === 'analysis'}
					aria-selected={sideTab === 'analysis'}
					onclick={() => (sideTab = 'analysis')}
				>
					<Sparkles size={12} />
					{$_('viewer.aiAnalysisTab')}
				</button>
				<button
					type="button"
					role="tab"
					class="side-tab"
					class:active={sideTab === 'report'}
					aria-selected={sideTab === 'report'}
					onclick={() => (sideTab = 'report')}
				>
					<FileText size={12} />
					{$_('viewer.report')}
				</button>
			</div>
			<div class="min-h-0 flex-1">
				{#if sideTab === 'analysis'}
					<FindingsPanel
						inference={effectiveInference}
						{layers}
						{confThreshold}
						onLayersChange={(l) => (layers = l)}
						onHighlight={(indices) => canvasRef?.setHighlight(indices)}
						onEditFinding={editFinding}
					/>
				{:else}
					<ReportPanel
						studyId={study.id}
						aiReport={inference?.report ?? ''}
						onDownloadPdf={exportReportPdf}
					/>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<div class="flex h-full items-center justify-center">
		<span class="spinner text-3xl text-fg-2"></span>
	</div>
{/if}

<style>
	.tool-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 0.3rem;
		color: var(--color-fg-2);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.tool-btn:hover {
		background: var(--color-bg-3);
		color: var(--color-fg-0);
	}
	.tool-btn.active {
		background: color-mix(in oklab, var(--color-primary) 16%, transparent);
		color: var(--color-primary);
	}
	.nav-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 5;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(15, 17, 24, 0.7);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		cursor: pointer;
	}
	.nav-arrow:hover:not(:disabled) {
		background: var(--color-bg-3);
		color: var(--color-fg-0);
	}
	.nav-arrow:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}
	.back-fmx {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 40px;
		background: var(--color-bg-2);
		color: var(--color-fg-2);
		border-radius: 0 0.3rem 0.3rem 0;
		border: 1px solid var(--color-border);
		border-left: none;
		cursor: pointer;
	}
	.back-fmx:hover {
		background: var(--color-bg-3);
		color: var(--color-fg-0);
	}
	.pearl-switch {
		appearance: none;
		width: 28px;
		height: 16px;
		background: var(--color-bg-3);
		border-radius: 8px;
		position: relative;
		cursor: pointer;
		transition: background 0.2s;
	}
	.pearl-switch::after {
		content: '';
		position: absolute;
		left: 2px;
		top: 2px;
		width: 12px;
		height: 12px;
		background: white;
		border-radius: 50%;
		transition: left 0.2s;
	}
	.pearl-switch:checked {
		background: var(--color-primary);
	}
	.pearl-switch:checked::after {
		left: 14px;
	}
	.tab-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--color-fg-2);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		cursor: pointer;
	}
	.tab-pill.active {
		color: var(--color-fg-0);
		background: var(--color-bg-3);
		border-color: rgba(255, 255, 255, 0.3);
	}
	.tab-pill:hover:not(.active) {
		color: var(--color-fg-1);
	}
	.open-3d-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--color-primary);
		color: var(--color-bg-0);
		font-weight: 600;
		font-size: 0.9rem;
		padding: 0.55rem 1.1rem;
		border-radius: 0.5rem;
		text-decoration: none;
	}
	/* Right-panel tab strip (AI Analysis ↔ Report). */
	.side-tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-0);
	}
	.side-tab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		flex: 1;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-fg-2);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.35rem 0.4rem;
		cursor: pointer;
	}
	.side-tab:hover:not(.active) {
		color: var(--color-fg-1);
	}
	.side-tab.active {
		color: var(--color-primary);
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
	}
</style>
