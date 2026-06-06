<script lang="ts">
	import { page } from '$app/state';
	import FmxGrid from '$lib/components/FmxGrid.svelte';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import Pager from '$lib/components/Pager.svelte';
	import { paginate } from '$lib/pagination';
	import { capForPrint } from '$lib/printout';
	import { formatDisplayDate } from '$lib/date';
	import { studies } from '$lib/stores/studies.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { escapeHtml } from '$lib/html';
	import {
		localDateKey,
		formatDateKey,
		countByLocalDate,
		todayLocalISO,
		MIN_DOB_ISO
	} from '$lib/date';
	import { validatePatientEdit } from '$lib/patientEdit';
	import { MAX_NAME_LENGTH } from '$lib/forms';
	import { autoTabDecision, type PatientTab } from '$lib/patientTabs';
	import { modalityLabel, hasViewableImage } from '$lib/modality';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _, locale } from 'svelte-i18n';
	import {
		ArrowLeft,
		Plus,
		Trash2,
		Calendar,
		ChevronDown,
		Image as ImageIcon,
		Camera,
		Boxes,
		Printer,
		Pencil
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import type { StoredStudy } from '$lib/types';

	const patientId = $derived(page.params.patientId);
	const patient = $derived(studies.getPatient(patientId!));

	// The bulk studies refresh omits the per-study `inference` blob (bounded-memory
	// load); fetch it lazily for THIS patient so the FMX grid's finding-dots (which
	// read `study.inference`) and the panoramic-patch derivation populate. Fire-and-
	// forget — ensureInference patches inference reactively, so the dots appear once
	// it resolves. Re-runs when the patient loads / the route's patient changes.
	$effect(() => {
		if (patient && patientId) studies.ensureInference(patientId);
	});

	// LOCAL-FIRST: the bulk refresh loads only study metadata; resolve object URLs for
	// this patient's viewable 2D images (thumbnails, photos, FMX films) from IndexedDB.
	$effect(() => {
		if (patient && patientId) studies.ensurePatientImages(patientId);
	});

	// PHI masking removed — the patient page (header + printout) always shows the real name.
	const displayName = $derived(patient?.name ?? '');
	const displayInitials = $derived(patient?.initials ?? '');
	let fmxView = $state(true);
	let tab = $state<PatientTab>('xrays');
	// Auto-pick the default tab once the studies load — and re-pick when the patient
	// changes. This component is REUSED across patient→patient navigation (same
	// [patientId] route, e.g. browser back/forward), so a plain run-once latch would
	// leave the previous patient's tab (and a stale visit-date filter) in place — a
	// patient with only X-rays could land on an empty 3D tab. `autoTabFor` records
	// which patient we last decided for; autoTabDecision re-fires when it differs.
	let autoTabFor = $state<string | null>(null);
	$effect(() => {
		const list = patient?.studies ?? [];
		const decision = autoTabDecision({
			decidedFor: autoTabFor,
			patientId: patientId ?? null,
			studyCount: list.length,
			hasXrays: list.some((s) => s.modality === 'xray' || s.modality === 'panoramic'),
			// Gated: with 3D off, never auto-surface the (now-hidden) 3D tab.
			has3d: auth.threeDEnabled && list.some((s) => s.modality === 'cbct' || s.modality === 'ios')
		});
		if (decision) {
			autoTabFor = patientId ?? null;
			tab = decision;
		}
	});

	// If the active tab's modality is disabled mid-session (a Labs/photo/3D toggle flips, or
	// a re-auth drops a flag), fall back to X-rays — the gated tab button vanishes, so the
	// user would otherwise be stranded on a now-hidden, empty tab.
	$effect(() => {
		if ((tab === 'photos' && !auth.photoEnabled) || (tab === '3d' && !auth.threeDEnabled)) {
			tab = 'xrays';
		}
	});

	// Capture-date (visit) selector — the header date button was a dead no-op with a
	// chevron. Lets you filter the patient's studies to a single capture date. Bucket
	// + label by LOCAL date (localDateKey/formatDateKey) so it matches the tiles' local
	// `fmtDate(capturedAt)` display and doesn't drift a day west of UTC (#53 vein).
	let selectedDate = $state<string | null>(null);
	let dateMenuOpen = $state(false);
	// Drop the visit-date filter (and close its menu) when switching patients — a date
	// only the previous patient had would otherwise filter the new patient to nothing,
	// making a patient with studies look empty (same carry-over reason as the tab above).
	$effect(() => {
		void patientId; // re-run on patient change
		selectedDate = null;
		dateMenuOpen = false;
	});
	// Count studies per local capture-date in ONE pass (the date menu previously
	// re-filtered the whole study list for every date row → O(studies × dates)).
	// captureDates is just the distinct keys, newest first.
	const dateCounts = $derived(countByLocalDate((patient?.studies ?? []).map((s) => s.capturedAt)));
	const captureDates = $derived([...dateCounts.keys()].sort().reverse());
	const inSelectedDate = (s: StoredStudy) =>
		!selectedDate || localDateKey(s.capturedAt) === selectedDate;

	// Panoramic studies are gated on the Panoramic opt-in (like the 3D/photo lists below):
	// with it off, panoramic studies drop out of the X-rays tab + count + FMX, matching the
	// other modality gates. Plain intraoral X-rays are always shown.
	const xrayStudies = $derived(
		(patient?.studies ?? []).filter(
			(s) =>
				(s.modality === 'xray' || (auth.panoramicEnabled && s.modality === 'panoramic')) &&
				inSelectedDate(s)
		)
	);
	// CBCT/IOS lists are EMPTY unless the user enabled 3D tools — which (since the "3D"
	// tab, its count, the auto-tab `has3d` check, and the tiles all derive from these
	// lists) hides every 3D affordance on this page in one place. The studies stay in
	// the store; flipping the Settings toggle re-reveals them with no reload.
	const cbctStudies = $derived(
		auth.threeDEnabled
			? (patient?.studies ?? []).filter((s) => s.modality === 'cbct' && inSelectedDate(s))
			: []
	);
	const iosStudies = $derived(
		auth.threeDEnabled
			? (patient?.studies ?? []).filter((s) => s.modality === 'ios' && inSelectedDate(s))
			: []
	);
	// Photos are gated behind the per-user "Show Photos" opt-in (like the 3D lists above):
	// an empty list when off hides the Photos tab, its count, and the gallery in one place.
	const photoStudies = $derived(
		auth.photoEnabled
			? (patient?.studies ?? []).filter((s) => s.modality === 'photo' && inSelectedDate(s))
			: []
	);

	// Paginate the linear X-ray grid — it mounts an <img> per study, so a patient with
	// hundreds of radiographs would flood the tab with concurrent image loads. (The FMX
	// grid is already bounded to its fixed slots; the 3D tab is icon tiles; Photos
	// paginate inside PhotoGallery.) Reset to page 1 when the patient or the visit-date
	// filter changes — the list changes underneath. paginate() also clamps for safety.
	const STUDY_PAGE_SIZE = 24;
	// Hard cap on how many studies the printout renders (the on-screen grids
	// paginate; the printout used to render the whole filtered list). Keeps a
	// huge patient from building an unbounded HTML doc + image-load storm.
	const MAX_PRINT_IMAGES = 60;
	let xrayPage = $state(0);
	$effect(() => {
		void patientId;
		void selectedDate;
		xrayPage = 0;
	});
	const pagedXrays = $derived(paginate(xrayStudies, xrayPage, STUDY_PAGE_SIZE));

	onMount(async () => {
		// Deep-link to a specific tab (e.g. after a photo upload → ?tab=photos). An
		// explicit tab wins over the auto "surface 3D if no X-rays" switch below.
		const t = page.url.searchParams.get('tab');
		// A `?tab=3d` deep-link is honoured only when 3D is enabled (otherwise the tab
		// doesn't exist) — fall back to the default X-rays tab.
		if (
			t === 'xrays' ||
			(t === 'photos' && auth.photoEnabled) ||
			(t === '3d' && auth.threeDEnabled)
		) {
			tab = t;
			// Mark this patient as already decided so the auto-switch effect leaves the
			// deep-linked tab alone (an explicit ?tab= wins over "surface 3D if no X-rays").
			autoTabFor = page.params.patientId ?? null;
		}
		// Catch the load so a transient failure doesn't reject before the redirect
		// below — otherwise `patient` stays undefined and the page is stuck on its
		// loading spinner forever. On failure we fall through to /studies, which
		// surfaces a "couldn't load / retry" panel.
		if (studies.patients.length === 0) {
			try {
				await studies.refresh();
			} catch {
				/* fall through to the redirect */
			}
		}
		if (!patient) {
			goto(resolve('/(app)/studies'));
			return;
		}
		initialLoadDone = true;
	});

	// Deleted-while-open: another tab deleting this patient now PROPAGATES (the cross-tab
	// change channel refreshes the projection) and would strand this page on its loading
	// spinner forever — leave with the same redirect once the projection settles.
	let initialLoadDone = $state(false);
	$effect(() => {
		if (initialLoadDone && !studies.loading && !patient) goto(resolve('/(app)/studies'));
	});

	const addStudyHref = $derived(`${resolve('/(app)/upload')}?patient=${patientId}`);

	function addPhoto() {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve()-built path + query string (resolve can't carry queries)
		goto(`${resolve('/(app)/upload')}?patient=${patientId}&modality=photo`);
	}

	function openStudy(s: StoredStudy) {
		if (s.modality === 'cbct')
			goto(resolve('/(app)/cbct/[patientId]/[studyId]', { patientId: patientId!, studyId: s.id }));
		else if (s.modality === 'ios')
			goto(resolve('/(app)/ios/[patientId]/[studyId]', { patientId: patientId!, studyId: s.id }));
		else
			goto(
				resolve('/(app)/viewer/[patientId]/[studyId]', { patientId: patientId!, studyId: s.id })
			);
	}

	function deleteStudy(id: string, e: Event) {
		e.stopPropagation();
		confirmDeleteStudy(id);
	}
	// Per-id in-flight guard so a study deletes at most once. A rapid double-click
	// on a tile's delete affordance otherwise fires two DELETEs — the 2nd 404s on
	// the now-deleted id and surfaces a FALSE "delete failed" alert for a delete
	// that actually succeeded. Every delete entry point on this page (the CBCT,
	// IOS and X-ray tiles via deleteStudy, plus PhotoGallery's onDelete) funnels
	// through confirmDeleteStudy, so guarding here covers all of them.
	let deletingIds = $state<Record<string, boolean>>({});
	// Event-free variant for PhotoGallery's onDelete (it passes just the id).
	async function confirmDeleteStudy(id: string) {
		if (deletingIds[id]) return;
		if (!confirm($_('viewer.deleteStudyConfirm'))) return;
		deletingIds[id] = true;
		try {
			await studies.deleteStudy(id);
		} catch (err) {
			// deleteStudy is PB-first, so on failure the study stays in the list (state
			// stays consistent) — but tell the clinician it didn't delete rather than
			// only logging it (#82/#103 silent-failure vein).
			console.error(err);
			alert($_('common.deleteStudyFailed'));
		} finally {
			delete deletingIds[id];
		}
	}

	// --- Edit patient (name + DOB) --------------------------------------------
	// EVERY patient can be edited — not just an auto-created `quick` one. A named
	// patient previously had no way to fix a mistyped name, and DOB was never
	// editable anywhere (a wrong DOB was uncorrectable). The form drives the store's
	// renamePatient(name, dob) (optimistic + rollback-on-failure); validation is the
	// shared validatePatientEdit (name required, DOB optional + bounds), so the rules
	// match the upload + quick-assign DOB entry points.
	const studyCount = $derived(patient?.studies.length ?? 0);
	let editing = $state(false);
	let editName = $state('');
	let editDob = $state('');
	let editError = $state(''); // localized message (already resolved), '' = none
	let savingEdit = $state(false);
	let nameInputEl = $state<HTMLInputElement | null>(null);

	function openEdit() {
		// Prefill from the current patient (a quick patient starts effectively blank —
		// its name is an auto-generated placeholder the clinician is meant to replace).
		editName = patient?.quick ? '' : (patient?.name ?? '');
		editDob = patient?.dob ?? '';
		editError = '';
		editing = true;
		// Move focus into the name field once the panel renders (a11y + ergonomics).
		queueMicrotask(() => nameInputEl?.focus());
	}

	function cancelEdit() {
		editing = false;
		editError = '';
	}

	async function saveEdit() {
		if (savingEdit || !patientId) return;
		// Single source of truth for the rules (also unit-tested in isolation).
		const result = validatePatientEdit({ name: editName, dob: editDob });
		if (!result.ok) {
			editError = $_(result.key);
			return;
		}
		savingEdit = true;
		editError = '';
		try {
			// Pass dob as the (possibly empty) string so clearing a DOB persists ('' →
			// the store maps it to null). renamePatient trims the name + throws on PB
			// failure (optimistic update is rolled back inside the store).
			await studies.renamePatient(patientId, { name: result.name, dob: result.dob });
			editing = false;
		} catch (err) {
			console.error(err);
			editError = $_('quickassign.saveFailed');
		} finally {
			savingEdit = false;
		}
	}

	// --- Delete patient -------------------------------------------------------
	// Wires the store's deletePatient (previously DEAD CODE — no UI reached it), so a
	// mistakenly-created patient can be removed. PB cascade-deletes the patient's
	// studies (relation cascadeDelete:true) AND the store prunes local caches. This
	// is DESTRUCTIVE and hits the real backend, so it's gated behind a confirm() that
	// names the study count, an in-flight guard (no double-delete), and only redirects
	// on success.
	let deleting = $state(false);
	async function deletePatientNow() {
		if (deleting || !patientId) return;
		if (!confirm($_('patient.deleteConfirm', { values: { count: studyCount } }))) return;
		deleting = true;
		try {
			await studies.deletePatient(patientId);
			// Back to the patient list (the dashboard) — the same destination as this
			// page's "back" affordance + the load-failure fallback. The just-deleted
			// patient no longer exists, so we must leave its detail route.
			goto(resolve('/(app)/studies'));
		} catch (err) {
			console.error(err);
			alert($_('patient.deleteFailed'));
			deleting = false;
		}
	}

	// A protected-file URL with a missing/expired token 404s; degrade the X-ray
	// tile to a labelled placeholder instead of a broken-image glyph (mirrors the
	// help page's hideBroken). The hidden `.tile-ph` sibling is revealed in place.
	function hideBroken(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
		const ph = img.nextElementSibling as HTMLElement | null;
		if (ph?.classList.contains('tile-ph')) {
			ph.classList.remove('hidden');
			ph.classList.add('flex');
		}
	}

	// `utc` for DOB (stored as a UTC-midnight calendar date) so it doesn't display
	// the previous day for viewers west of UTC; capture timestamps stay local.
	function fmtDate(iso: string, utc = false) {
		// Shared guarded formatter (→ "—" for a malformed/missing date, not "Invalid Date").
		return formatDisplayDate(iso, $locale ?? undefined, {
			year: 'numeric',
			month: 'short',
			day: '2-digit',
			...(utc ? { timeZone: 'UTC' } : {})
		});
	}

	// Patient Printout (the header button was a dead no-op): compose a light-themed
	// study overview for the current patient (respecting the date filter) and open
	// the browser print dialog in a new window.
	function printPatient() {
		if (!patient) return;
		const list = patient.studies.filter(inSelectedDate);
		// Cap the printout so a patient with thousands of studies can't build an
		// unbounded HTML doc + that many concurrent protected-image loads (the
		// on-screen grids paginate at STUDY_PAGE_SIZE; the printout ignored that).
		// When capped, the header tells the user to narrow the date filter.
		const { shown, omitted } = capForPrint(list, MAX_PRINT_IMAGES);
		const tiles = shown
			.map((s) => {
				const label = modalityLabel(s.modality, $_);
				// escapeHtml on the URL too — PB URLs are well-formed today, but a
				// future PB-side filename change (or a custom file uploaded with an
				// unusual name) could otherwise inject into the src attribute. Treat
				// every interpolation into hand-built HTML as untrusted.
				// CBCT/IOS `imageDataUrl` is a raw volume/mesh (.nii.gz / .obj …), not a
				// bitmap — an <img> for it prints BROKEN. Show the modality placeholder
				// instead (the on-screen 3D tiles already use a label, not an <img>).
				const inner =
					s.imageDataUrl && hasViewableImage(s.modality)
						? `<img src="${escapeHtml(s.imageDataUrl)}" alt="">`
						: `<div class="ph">${escapeHtml(label.toUpperCase())}</div>`;
				return `<figure class="tile">${inner}<figcaption>${escapeHtml(label)} · ${fmtDate(s.capturedAt)}</figcaption></figure>`;
			})
			.join('');
		const scope = selectedDate ? fmtDate(selectedDate) : $_('common.printAllDates');
		const title = $_('common.printPatientTitle', { values: { name: displayName } });
		const dobChunk = patient.dob
			? escapeHtml($_('common.printDob', { values: { date: fmtDate(patient.dob, true) } })) +
				' &middot; '
			: '';
		const printed = $_('common.printPrinted', {
			values: { date: fmtDate(new Date().toISOString()) }
		});
		const studyCount = $_('studies.studyCount', { values: { count: list.length } });
		// When the list overflowed the cap, tell the reader only the first N are
		// shown and to narrow the date filter for the rest.
		const capNotice =
			omitted > 0
				? `<p class="cap">${escapeHtml(
						$_('common.printCapNotice', { values: { shown: shown.length, total: list.length } })
					)}</p>`
				: '';
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;}
  h1{font-size:20px;margin:0 0 2px;} .meta{color:#555;margin:0 0 16px;font-size:12px;}
  .cap{color:#a15c00;background:#fff7e6;border:1px solid #ffd591;border-radius:4px;padding:6px 10px;margin:0 0 14px;font-size:12px;}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
  .tile{margin:0;border:1px solid #ddd;border-radius:6px;overflow:hidden;background:#000;}
  .tile img{width:100%;height:120px;object-fit:cover;display:block;}
  .tile .ph{height:120px;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:12px;background:#1a1a1a;}
  figcaption{font-size:10px;color:#444;background:#fff;padding:3px 6px;text-transform:capitalize;}
  .foot{color:#888;font-size:11px;margin-top:20px;}
  @media print{ @page{margin:10mm;} }
</style></head><body>
  <h1>${escapeHtml(displayName)}</h1>
  <p class="meta">${dobChunk}${escapeHtml(studyCount)} &middot; ${escapeHtml(scope)} &middot; ${escapeHtml(printed)}</p>
  ${capNotice}
  <div class="grid">${tiles || `<p>${escapeHtml($_('common.printNoStudies'))}</p>`}</div>
  <p class="foot">${escapeHtml($_('common.printGeneratedBy'))}</p>
</body></html>`;
		const w = window.open('', '_blank', 'width=940,height=1100');
		if (!w) {
			// Popup blocked — surface the cause (#82 vein).
			alert($_('viewer.printoutPopupBlocked'));
			return;
		}
		w.document.open();
		w.document.write(html);
		w.document.close();
		w.focus();
		setTimeout(() => w.print(), 350);
	}
</script>

{#if patient}
	<!-- Pearl-style viewer top bar -->
	<header class="flex h-12 items-center gap-3 border-b border-border bg-bg-0 px-4">
		<button
			onclick={() => goto(resolve('/(app)/studies'))}
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
				<input type="checkbox" bind:checked={fmxView} class="pearl-switch" />
			</label>
		{/if}

		<div class="relative ml-1">
			<button
				onclick={() => (dateMenuOpen = !dateMenuOpen)}
				aria-expanded={dateMenuOpen}
				class="flex items-center gap-1.5 rounded-full border bg-bg-2 px-3 py-1 text-xs text-fg-1 transition hover:border-primary"
				class:border-primary={selectedDate || dateMenuOpen}
				class:border-border={!selectedDate && !dateMenuOpen}
			>
				<Calendar size={12} class="text-fg-2" />
				{selectedDate
					? formatDateKey(selectedDate, $locale ?? undefined)
					: fmtDate(patient.lastCapture)}
				<ChevronDown size={10} />
			</button>
			{#if dateMenuOpen}
				<button
					type="button"
					aria-label={$_('common.close')}
					class="fixed inset-0 z-40 cursor-default"
					onclick={() => (dateMenuOpen = false)}
				></button>
				<div
					class="absolute left-0 z-50 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border bg-bg-1 py-1 shadow-xl"
				>
					<button
						class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-bg-2"
						class:text-primary={!selectedDate}
						class:text-fg-1={selectedDate}
						onclick={() => {
							selectedDate = null;
							dateMenuOpen = false;
						}}
					>
						{$_('viewer.allDates')}
						<span class="text-fg-3">{patient.studies.length}</span>
					</button>
					{#each captureDates as d (d)}
						<button
							class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-bg-2"
							class:text-primary={selectedDate === d}
							class:text-fg-1={selectedDate !== d}
							onclick={() => {
								selectedDate = d;
								dateMenuOpen = false;
							}}
						>
							{formatDateKey(d, $locale ?? undefined)}
							<span class="text-fg-3">
								{dateCounts.get(d) ?? 0}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex-1"></div>

		<!-- X-rays / 3D / Photos tabs (centered) -->
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
			{#if cbctStudies.length + iosStudies.length > 0}
				<button
					class="tab-pill"
					class:active={tab === '3d'}
					aria-pressed={tab === '3d'}
					onclick={() => (tab = '3d')}
				>
					<Boxes size={11} />
					{$_('viewer.threeD')} ({cbctStudies.length + iosStudies.length})
				</button>
			{/if}
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

		<!-- eslint-disable svelte/no-navigation-without-resolve -- addStudyHref is resolve()-built + query string (resolve can't carry queries) -->
		<a
			href={addStudyHref}
			class="flex items-center gap-1.5 rounded bg-bg-2 px-2.5 py-1 text-xs text-fg-1 transition hover:bg-bg-3"
		>
			<Plus size={12} />
			{$_('viewer.addStudy')}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->

		<button
			type="button"
			data-testid="patient-edit-btn"
			onclick={openEdit}
			class="flex items-center gap-1.5 rounded bg-bg-2 px-2.5 py-1 text-xs text-fg-1 transition hover:bg-bg-3"
		>
			<Pencil size={12} />
			{patient.quick ? $_('patient.nameThis') : $_('patient.edit')}
		</button>

		<button
			type="button"
			data-testid="patient-delete-btn"
			onclick={deletePatientNow}
			disabled={deleting}
			aria-label={$_('patient.delete')}
			class="flex items-center gap-1.5 rounded bg-bg-2 px-2.5 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<Trash2 size={12} />
			{$_('patient.delete')}
		</button>

		<button
			type="button"
			onclick={printPatient}
			class="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
		>
			<Printer size={12} />
			{$_('viewer.printout')}
		</button>
	</header>

	{#if editing}
		<!-- Inline edit panel (name + DOB) — mirrors the page's inline patterns rather
		     than a modal. Reachable for EVERY patient (the header Edit / Name-this btn). -->
		<div class="border-b border-border bg-bg-1 px-4 py-3">
			<form
				class="flex flex-wrap items-end gap-3"
				onsubmit={(e) => {
					e.preventDefault();
					saveEdit();
				}}
			>
				<label class="flex flex-col gap-1 text-[11px] text-fg-2">
					{$_('patient.nameLabel')}
					<input
						bind:this={nameInputEl}
						bind:value={editName}
						data-testid="patient-edit-name"
						type="text"
						autocomplete="off"
						maxlength={MAX_NAME_LENGTH}
						class="w-56 rounded border border-border bg-bg-2 px-2 py-1 text-sm text-fg-0 focus:border-primary focus:outline-none"
					/>
				</label>
				<label class="flex flex-col gap-1 text-[11px] text-fg-2">
					{$_('patient.dobLabel')}
					<input
						bind:value={editDob}
						data-testid="patient-edit-dob"
						type="date"
						min={MIN_DOB_ISO}
						max={todayLocalISO()}
						class="rounded border border-border bg-bg-2 px-2 py-1 text-sm text-fg-0 focus:border-primary focus:outline-none"
					/>
				</label>
				<button
					type="submit"
					data-testid="patient-edit-save"
					disabled={savingEdit}
					class="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					{$_('common.save')}
				</button>
				<button
					type="button"
					data-testid="patient-edit-cancel"
					onclick={cancelEdit}
					class="rounded bg-bg-2 px-3 py-1.5 text-xs text-fg-1 transition hover:bg-bg-3"
				>
					{$_('common.cancel')}
				</button>
				{#if editError}
					<span data-testid="patient-edit-error" role="alert" class="text-xs text-danger">
						{editError}
					</span>
				{/if}
			</form>
		</div>
	{/if}

	<main class="flex-1 overflow-y-auto bg-bg-0">
		{#if tab === '3d' && auth.threeDEnabled}
			<div class="p-6">
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
					{#each cbctStudies as s (s.id)}
						<div class="group relative">
							<button
								class="flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-border bg-bg-2 p-0 text-left transition hover:border-primary"
								onclick={() => openStudy(s)}
							>
								<div
									class="flex h-24 w-full items-center justify-center bg-bg-3 text-3xl text-fg-3 group-hover:text-fg-1"
								>
									🦷
								</div>
								<div class="px-3 pb-3">
									<div class="text-sm font-medium text-fg-0">{$_('viewer.cbctAi')}</div>
									<div class="text-xs text-fg-3">{fmtDate(s.capturedAt)}</div>
									{#if s.segmentationUrl}
										<div class="mt-1 text-[10px] text-primary">● {$_('viewer.segmented')}</div>
									{/if}
								</div>
							</button>
							<button
								class="absolute top-1 right-1 z-10 rounded bg-bg-1/70 p-1 text-fg-2 opacity-0 transition group-hover:opacity-100 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
								onclick={(e) => deleteStudy(s.id, e)}
								disabled={deletingIds[s.id]}
								aria-label={$_('viewer.delete')}
							>
								<Trash2 size={12} />
							</button>
						</div>
						{#if s.segmentationUrl}
							<button
								class="group flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-bg-2 p-0 text-left transition hover:border-primary"
								onclick={() => {
									goto(
										resolve('/(app)/cbct/[patientId]/[studyId]?view=volume', {
											patientId: patientId!,
											studyId: s.id
										})
									);
								}}
							>
								<div
									class="flex h-24 w-full items-center justify-center bg-gradient-to-br from-bg-3 to-bg-2 text-3xl text-fg-3 group-hover:text-fg-1"
								>
									🧊
								</div>
								<div class="px-3 pb-3">
									<div class="text-sm font-medium text-fg-0">{$_('viewer.model3d')}</div>
									<div class="text-xs text-fg-3">{fmtDate(s.capturedAt)}</div>
									<div class="mt-1 text-[10px] text-primary">● {$_('viewer.fromCbct')}</div>
								</div>
							</button>
						{/if}
					{/each}
					{#each iosStudies as s (s.id)}
						<div class="group relative">
							<button
								class="flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-border bg-bg-2 p-0 text-left transition hover:border-primary"
								onclick={() => openStudy(s)}
							>
								<div
									class="flex h-24 w-full items-center justify-center bg-bg-3 text-3xl text-fg-3 group-hover:text-fg-1"
								>
									📷
								</div>
								<div class="px-3 pb-3">
									<div class="text-sm font-medium text-fg-0">{$_('viewer.ios')}</div>
									<div class="text-xs text-fg-3">{fmtDate(s.capturedAt)}</div>
									{#if s.segmentationUrl}
										<div class="mt-1 text-[10px] text-primary">● {$_('viewer.segmented')}</div>
									{/if}
								</div>
							</button>
							<button
								class="absolute top-1 right-1 z-10 rounded bg-bg-1/70 p-1 text-fg-2 opacity-0 transition group-hover:opacity-100 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
								onclick={(e) => deleteStudy(s.id, e)}
								disabled={deletingIds[s.id]}
								aria-label={$_('viewer.delete')}
							>
								<Trash2 size={12} />
							</button>
						</div>
					{/each}
				</div>
			</div>
		{:else if tab === 'xrays' && fmxView && auth.panoramicEnabled}
			<FmxGrid studies={xrayStudies} onOpen={openStudy} />
		{:else if tab === 'xrays'}
			<!-- Linear list view -->
			<div class="grid grid-cols-2 gap-3 p-6 pb-0 sm:grid-cols-3 lg:grid-cols-5">
				{#each pagedXrays.items as s (s.id)}
					<div class="study-tile group relative aspect-[4/3] overflow-hidden rounded-lg">
						<button
							class="absolute inset-0 z-0"
							onclick={() => openStudy(s)}
							aria-label={$_('viewer.openStudy')}
						></button>
						{#if s.imageDataUrl}
							<img
								src={s.imageDataUrl}
								alt=""
								loading="lazy"
								class="pointer-events-none h-full w-full object-cover"
								onerror={hideBroken}
							/>
							<div
								class="tile-ph pointer-events-none absolute inset-0 hidden items-center justify-center bg-bg-2 text-[10px] font-medium text-fg-3"
							>
								{modalityLabel(s.modality, $_)}
							</div>
						{/if}
						<div
							class="pointer-events-none absolute right-1 bottom-1 left-1 flex justify-between text-[10px] text-white"
						>
							<span>{fmtDate(s.capturedAt)}</span>
							<span>{modalityLabel(s.modality, $_)}</span>
						</div>
						<button
							class="absolute top-1 right-1 z-10 rounded bg-bg-1/70 p-1 text-fg-2 opacity-0 transition group-hover:opacity-100 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
							onclick={(e) => deleteStudy(s.id, e)}
							disabled={deletingIds[s.id]}
							aria-label={$_('viewer.delete')}
						>
							<Trash2 size={12} />
						</button>
					</div>
				{/each}
			</div>
			<div class="px-6 pb-6">
				<Pager
					page={pagedXrays.page}
					pageCount={pagedXrays.pageCount}
					total={pagedXrays.total}
					onpage={(p) => (xrayPage = p)}
				/>
			</div>
		{:else if tab === 'photos'}
			<PhotoGallery photos={photoStudies} onDelete={confirmDeleteStudy} onAdd={addPhoto} />
		{/if}
	</main>
{:else}
	<div class="flex h-full items-center justify-center">
		<span class="spinner text-3xl text-fg-2"></span>
	</div>
{/if}

<style>
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
		border-color: var(--color-border-hover);
	}
	.study-tile {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		cursor: pointer;
	}
	.study-tile:hover {
		border-color: var(--color-primary);
	}
</style>
