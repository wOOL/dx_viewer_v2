<script lang="ts">
	import { Printer, Check } from 'lucide-svelte';
	import { _, locale } from 'svelte-i18n';
	import { toothDisplay } from '$lib/constants';
	import { escapeHtml } from '$lib/html';
	import ToothChart from '$lib/components/cbct/ToothChart.svelte';
	import ToothConditionsModal from '$lib/components/cbct/ToothConditionsModal.svelte';
	import ToothDetailCard from '$lib/components/cbct/ToothDetailCard.svelte';
	import PanoramicCanvas from '$lib/components/cbct/PanoramicCanvas.svelte';
	import type { CbctStore } from '@be-certain/imaging-3d/state';
	import { sliceVolume } from '@be-certain/imaging-3d/volumeLoader';
	import { onMount, onDestroy } from 'svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { browser } from '$app/environment';
	import { localDb } from '$lib/db/localDb';
	import { debouncedSave } from '$lib/debouncedSave';
	import { findingTypeLabel } from '@be-certain/imaging-3d/findingLabel';
	import { capText, MAX_COMMENT_LENGTH } from '$lib/limits';

	interface Props {
		store: CbctStore;
		findings?: {
			tooth: number;
			type: string;
			severity: 'low' | 'med' | 'high';
			confidence?: number;
		}[];
		toothFindingsForChart?: Record<number, { severity: 'low' | 'med' | 'high'; count: number }>;
		patientName?: string;
		capturedAt?: string;
		studyId?: string;
	}
	const {
		store,
		findings = [],
		toothFindingsForChart,
		patientName,
		capturedAt,
		studyId
	}: Props = $props();
	// Localised fallback — the previous hardcoded "Unknown patient" default leaked
	// English into FR/DE/ES print titles whenever a caller forwarded an empty name.
	const displayPatientName = $derived(patientName || $_('common.unknownPatient'));

	// Per-(user, study) report state — sign-off + per-tooth approvals + comments.
	// LOCAL-FIRST: the source of truth is IndexedDB (`cbctReportState` store, mirroring
	// the PB `cbct_report_state` collection 1:1 for backup). The db upsert merges by
	// (user, study), so the markups/hiddenMeshes written by CbctWorkspace and the
	// sign-off/notes written here coexist in the same row without clobbering each other.
	interface SignOff {
		by: string;
		at: number;
	}
	interface ToothNotes {
		approved: number[];
		comments: Record<number, string>;
	}
	let signedInfo = $state<SignOff | null>(null);
	let toothNotes = $state<ToothNotes>({ approved: [], comments: {} });
	let loadedFor = ''; // non-reactive guard so the load effect doesn't loop

	// Load this (user, study)'s saved report state from IndexedDB on study change. Resets
	// first so a slow load never shows the previous study's sign-off (SPA reuses this
	// component — only the [studyId] prop changes).
	$effect(() => {
		const id = studyId;
		const user = auth.user;
		if (!browser || !id || !user) return;
		if (loadedFor === id) return;
		loadedFor = id;
		// Flush (not drop) a pending save from the PREVIOUS study before resetting —
		// its payload was snapshotted at schedule time, so it persists the previous
		// study's data under the previous study's id (no clobber of the new study).
		saver.flush();
		signedInfo = null;
		toothNotes = { approved: [], comments: {} };
		void (async () => {
			try {
				const rec = await localDb.getCbctReport(user.id, id);
				if (rec && loadedFor === id) {
					signedInfo =
						rec.signedAt && rec.signedBy
							? { by: rec.signedBy, at: new Date(rec.signedAt).getTime() }
							: null;
					toothNotes = {
						approved: Array.isArray(rec.approvedTeeth) ? rec.approvedTeeth : [],
						comments:
							rec.comments && typeof rec.comments === 'object'
								? (rec.comments as Record<number, string>)
								: {}
					};
				}
			} catch (e) {
				console.warn('cbct_report_state load failed', e);
			}
		})();
	});

	const saver = debouncedSave();
	function scheduleSave() {
		if (!browser || !studyId || !auth.user) return;
		// Snapshot the payload now: a flush may fire during a study switch/unmount.
		const userId = auth.user.id;
		const id = studyId;
		const fields = {
			signedBy: signedInfo?.by ?? '',
			signedAt: signedInfo ? new Date(signedInfo.at).toISOString() : null,
			approvedTeeth: [...toothNotes.approved],
			comments: { ...toothNotes.comments } as Record<string, string>
		};
		saver.schedule(async () => {
			try {
				await localDb.upsertCbctReport(userId, id, fields);
			} catch (e) {
				console.warn('cbct_report_state save failed', e);
			}
		});
	}
	onDestroy(() => {
		// FLUSH (not drop) a pending save — a sign-off/approval/comment made <350ms
		// before navigating away must persist (payload snapshotted at schedule time;
		// the IndexedDB write completes after teardown).
		saver.flush();
	});

	function approveAndSign() {
		const by = auth.user?.name || auth.user?.email || $_('cbct.defaultSigner');
		signedInfo = { by, at: Date.now() };
		scheduleSave();
	}
	function toggleApprove(t: number) {
		const approved = toothNotes.approved.includes(t)
			? toothNotes.approved.filter((x) => x !== t)
			: [...toothNotes.approved, t];
		toothNotes = { ...toothNotes, approved };
		scheduleSave();
	}
	function setComment(t: number, text: string) {
		const comments = { ...toothNotes.comments };
		// Cap at the persist choke point (not only the <textarea maxlength>) so a pasted /
		// programmatic over-long note can't bloat the row or break the print.
		const capped = capText(text, MAX_COMMENT_LENGTH);
		if (capped) comments[t] = capped;
		else delete comments[t];
		toothNotes = { ...toothNotes, comments };
		scheduleSave();
	}

	function fmtDate(d: number | string | undefined): string {
		if (!d) return '—';
		const dt = new Date(d);
		return isNaN(dt.getTime())
			? String(d)
			: dt.toLocaleDateString($locale ?? undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});
	}

	// Compose a clean, light-themed printable report and open the browser print
	// dialog in a separate window (avoids fighting the dark workspace chrome).
	function printReport() {
		if (!browser) return;
		const t = (k: string, v?: Record<string, string | number>) =>
			$_(`cbct.${k}`, v ? { values: v } : undefined);
		const toothLabel = (n: number) => `${t('tooth')} ${toothDisplay(n)}`;
		// Severity column follows the active locale (mild/moderate/severe keys
		// already exist for the chart). Was hardcoded English in the printout.
		const severityKey = { low: 'mild', med: 'moderate', high: 'severe' } as const;
		const rows =
			findings.length === 0
				? `<tr><td colspan="3" style="padding:10px;color:#555">${escapeHtml(t('printNoFindings'))}</td></tr>`
				: [...findings]
						.sort((a, b) => a.tooth - b.tooth)
						.map(
							(f) =>
								`<tr><td>${escapeHtml(toothLabel(f.tooth))}</td><td>${escapeHtml(findingTypeLabel(f.type, $_))}</td><td>${escapeHtml(t(severityKey[f.severity]))}</td></tr>`
						)
						.join('');
		const signLine = signedInfo
			? `<p class="sign">${escapeHtml(t('printSignedBy', { name: signedInfo.by, date: fmtDate(signedInfo.at) }))}</p>`
			: `<p class="sign unsigned">${escapeHtml(t('printUnsigned'))}</p>`;
		// Clinician's per-tooth notes (added via the drill-down "Comment" action) are part
		// of the clinical record — include them in the printout. They were omitted, so a
		// printed/shared report silently dropped the clinician's own annotations. Numbers
		// follow dxv:toothNumbering (toothDisplay); note text is escaped (user input).
		const noteEntries = Object.entries(toothNotes.comments)
			.filter(([, note]) => note && note.trim())
			.sort((a, b) => Number(a[0]) - Number(b[0]));
		const notesHtml = noteEntries.length
			? `<h2 style="font-size:14px;">${escapeHtml(t('printClinicalNotes', { n: noteEntries.length }))}</h2><table><thead><tr><th>${escapeHtml(t('printColTooth'))}</th><th>${escapeHtml(t('printColNote'))}</th></tr></thead><tbody>${noteEntries
					.map(
						([toothId, note]) =>
							`<tr><td>${escapeHtml(toothLabel(Number(toothId)))}</td><td>${escapeHtml(note)}</td></tr>`
					)
					.join('')}</tbody></table>`
			: '';
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('aiReport'))} — ${escapeHtml(displayPatientName)}</title>
<style>
  body{font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px;}
  h1{font-size:20px;margin:0 0 4px;} .meta{color:#555;margin:0 0 16px;}
  table{border-collapse:collapse;width:100%;margin:8px 0 16px;}
  th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:12px;}
  th{background:#f3f4f6;}
  .sign{margin-top:24px;padding-top:12px;border-top:1px solid #ddd;}
  .unsigned{color:#a00;} .foot{color:#888;font-size:11px;margin-top:24px;}
</style></head><body>
  <h1>${escapeHtml(t('aiReport'))}</h1>
  <p class="meta">${escapeHtml(displayPatientName)} &middot; ${escapeHtml(t('printCaptured', { date: fmtDate(capturedAt) }))} &middot; ${escapeHtml(t('printPrinted', { date: fmtDate(Date.now()) }))}</p>
  <h2 style="font-size:14px;">${escapeHtml(t('printFindingsHeader', { n: findings.length }))}</h2>
  <table><thead><tr><th>${escapeHtml(t('printColTooth'))}</th><th>${escapeHtml(t('printColFinding'))}</th><th>${escapeHtml(t('printColSeverity'))}</th></tr></thead><tbody>${rows}</tbody></table>
  ${notesHtml}
  ${signLine}
  <p class="foot">${escapeHtml(t('printFooter'))}</p>
</body></html>`;
		const w = window.open('', '_blank', 'width=820,height=900');
		if (!w) {
			// Popup blocked — surface the cause so the user knows to allow popups
			// instead of clicking Print again expecting different results (#82 vein).
			alert($_('viewer.printoutPopupBlocked'));
			return;
		}
		w.document.open();
		w.document.write(html);
		w.document.close();
		w.focus();
		// Let layout settle before invoking print.
		setTimeout(() => w.print(), 250);
	}

	// Category chip label comes from `cbct.cat_<key>` at render time — `label`
	// here was a stale fallback nothing read. Color goes through --chip-color.
	const categories = [
		{ key: 'periodontal', color: '#22d3ee' },
		{ key: 'restorative', color: '#f472b6' },
		{ key: 'endo', color: '#fb923c' },
		{ key: 'surgical', color: '#facc15' }
	];

	// null = show ALL findings on load; the category chips are optional filters. (Was
	// defaulted to 'periodontal', which HID every finding on open for any study whose
	// findings aren't periodontal — and since CBCT synthesis only ever emits surgical
	// "Missing tooth" findings, EVERY segmented CBCT report opened looking empty until
	// the user clicked "Surgical". A report must never default-hide real findings.)
	let activeCategory = $state<string | null>(null);
	let selectedTeeth = $state<number[]>([]);
	let conditionsModalTooth = $state<number | null>(null);

	const selectedConditions = $derived(
		conditionsModalTooth == null
			? []
			: findings
					.filter((f) => f.tooth === conditionsModalTooth)
					.map((f) => ({
						name: findingTypeLabel(f.type, $_),
						// Real confidence only (undefined for a synthesized "Missing tooth" gap) —
						// the modal omits the pill instead of fabricating a 90%.
						confidence: f.confidence,
						category: undefined as undefined
					}))
	);

	const PERIO_KEYWORDS = /bone|periodontal|gingiv|perio|attachment/i;
	const REST_KEYWORDS = /caries|filling|crown|restoration|bridge|implant|onlay|inlay|margin/i;
	const ENDO_KEYWORDS = /pulp|root\s?canal|periapical|apex|endo|resorption/i;
	const SURG_KEYWORDS = /impact|extract|missing|fracture|cyst|tumor|surgical/i;

	function findingCategory(type: string): string {
		if (ENDO_KEYWORDS.test(type)) return 'endo';
		if (PERIO_KEYWORDS.test(type)) return 'periodontal';
		if (REST_KEYWORDS.test(type)) return 'restorative';
		if (SURG_KEYWORDS.test(type)) return 'surgical';
		return 'periodontal';
	}

	const visibleFindings = $derived(
		activeCategory ? findings.filter((f) => findingCategory(f.type) === activeCategory) : findings
	);

	function toggleTooth(t: number) {
		if (selectedTeeth.includes(t)) selectedTeeth = selectedTeeth.filter((x) => x !== t);
		else selectedTeeth = [...selectedTeeth, t];
	}

	// Sagittal preview thumbnail shown beside the panoramic. The panoramic itself is the
	// shared interactive <PanoramicCanvas> (pan/zoom, ruler-mm, MIP-slab, crosshair, overlays).
	let sliceCanvasEl = $state<HTMLCanvasElement | null>(null);

	function renderSlice() {
		const c = sliceCanvasEl;
		const v = store.volume;
		if (!c || !v) return;
		const slc = sliceVolume(v, 'sagittal', store.slice.sagittal, {
			window: store.windowVal,
			level: store.levelVal,
			invert: store.invert
		});
		c.width = slc.width;
		c.height = slc.height;
		c.getContext('2d')?.putImageData(new ImageData(slc.rgba, slc.width, slc.height), 0, 0);
	}

	// Sagittal preview tracks the crosshair slice.
	$effect(() => {
		void store.volume;
		void store.windowVal;
		void store.levelVal;
		void store.invert;
		void store.slice;
		renderSlice();
	});

	onMount(renderSlice);

	// Group findings by tooth (top N) using the category-filtered view.
	const groupedByTooth = $derived.by(() => {
		const g: Record<number, typeof findings> = {};
		for (const f of visibleFindings) {
			g[f.tooth] = g[f.tooth] || [];
			g[f.tooth].push(f);
		}
		const entries = Object.entries(g).map(([k, v]) => ({ tooth: Number(k), findings: v }));
		entries.sort((a, b) => b.findings.length - a.findings.length);
		return entries.slice(0, 4);
	});

	const findingsByTooth = $derived.by(() => {
		// Driven by real findings only — a present tooth with no finding stays
		// Healthy (gray). `toothFindingsForChart` is an optional seed (currently
		// unused; reserved for future real per-tooth severities) overlaid by
		// findings, where higher severity wins.
		const m: Record<number, { severity: 'low' | 'med' | 'high'; count: number }> = {
			...(toothFindingsForChart ?? {})
		};
		const rank = { low: 0, med: 1, high: 2 };
		for (const f of visibleFindings) {
			const cur = m[f.tooth];
			if (!cur || rank[f.severity] > rank[cur.severity]) {
				m[f.tooth] = { severity: f.severity, count: (cur?.count ?? 0) + 1 };
			} else {
				cur.count++;
			}
		}
		return m;
	});
</script>

<div class="flex h-full w-full flex-col gap-3 overflow-y-auto bg-bg-0 p-4">
	<!-- Section heading -->
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-fg-0">{$_('cbct.aiReport')}</h1>
		<div class="flex items-center gap-2">
			<button
				onclick={printReport}
				class="flex items-center gap-1 text-xs text-fg-2 hover:text-fg-0"
			>
				<Printer size={14} />
				{$_('cbct.printReport')}
			</button>
			{#if signedInfo}
				<div
					class="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success"
					title={$_('cbct.signedOn', { values: { date: fmtDate(signedInfo.at) } })}
				>
					<Check size={14} />
					{$_('cbct.signed')} · {signedInfo.by}
				</div>
			{:else}
				<button
					onclick={approveAndSign}
					class="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-bg-0 hover:bg-primary"
				>
					<Check size={14} />
					{$_('cbct.approveSign')}
				</button>
			{/if}
		</div>
	</div>

	<div class="grid min-h-0 grid-cols-2 gap-3">
		<!-- Left: big interactive panoramic (shared component) with the report's category
		     chips overlaid -->
		<div class="relative h-[460px] overflow-hidden rounded-lg border border-border bg-black">
			<PanoramicCanvas {store}>
				<div
					class="absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-bg-1/70 px-1 py-0.5 backdrop-blur-sm"
				>
					{#each categories as c (c.key)}
						<button
							class="category-chip"
							class:active={activeCategory === c.key}
							aria-pressed={activeCategory === c.key}
							style:--chip-color={c.color}
							onclick={() => (activeCategory = activeCategory === c.key ? null : c.key)}
						>
							{$_('cbct.cat_' + c.key)}
						</button>
					{/each}
				</div>
			</PanoramicCanvas>
		</div>

		<!-- Right: Other findings + Tooth detail -->
		<div class="flex flex-col gap-3">
			<!-- Other findings panel -->
			<div class="rounded-lg border border-border bg-bg-1 p-3">
				<div class="mb-2 text-sm font-semibold text-fg-0">{$_('cbct.otherFindings')}</div>
				<div class="mb-2 text-xs text-fg-2">
					{$_('cbct.noAdditional')}
				</div>
				<div class="h-32 overflow-hidden rounded-md bg-black">
					<canvas
						bind:this={sliceCanvasEl}
						class="h-full w-full object-contain [image-rendering:pixelated]"
					></canvas>
				</div>
			</div>

			<!-- Per-tooth findings: inline cards (Diagnocat-style). If the user has
			     selected teeth from the chart, show those; otherwise show the top-N
			     teeth with findings (or a single empty-state). -->
			{#if selectedTeeth.length > 0}
				{#each selectedTeeth as t (t)}
					{@const f = visibleFindings.filter((x) => x.tooth === t)}
					<ToothDetailCard
						tooth={t}
						findings={f.map((x) => ({
							name: findingTypeLabel(x.type, $_),
							severity: x.severity,
							confidence: x.confidence
						}))}
						approved={toothNotes.approved.includes(t)}
						comment={toothNotes.comments[t] ?? ''}
						onclose={() => toggleTooth(t)}
						onmore={() => (conditionsModalTooth = t)}
						onapprove={() => toggleApprove(t)}
						oncomment={(text) => setComment(t, text)}
					/>
				{/each}
			{:else if groupedByTooth.length > 0}
				{#each groupedByTooth.slice(0, 2) as t (t.tooth)}
					<ToothDetailCard
						tooth={t.tooth}
						findings={t.findings.map((x) => ({
							name: findingTypeLabel(x.type, $_),
							severity: x.severity,
							confidence: x.confidence
						}))}
						approved={toothNotes.approved.includes(t.tooth)}
						comment={toothNotes.comments[t.tooth] ?? ''}
						onclose={() => {}}
						onmore={() => (conditionsModalTooth = t.tooth)}
						onapprove={() => toggleApprove(t.tooth)}
						oncomment={(text) => setComment(t.tooth, text)}
					/>
				{/each}
			{:else}
				<div class="rounded-lg border border-border bg-bg-1 p-3 text-sm text-fg-2">
					{$_('cbct.toothLevelHint')}
				</div>
			{/if}
		</div>
	</div>

	<!-- Bottom: Tooth chart -->
	<div class="rounded-lg border border-border bg-bg-1 p-3">
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-sm font-semibold text-fg-0">{$_('cbct.teethInReport')}</h2>
			<button
				class="text-xs text-fg-2 hover:text-fg-0 disabled:opacity-40"
				disabled={selectedTeeth.length === 0}
				onclick={() => (selectedTeeth = [])}
			>
				{selectedTeeth.length > 0
					? $_('cbct.clearSelection', { values: { n: selectedTeeth.length } })
					: $_('cbct.selectTeeth')}
			</button>
		</div>
		<ToothChart {findingsByTooth} highlightTooth={selectedTeeth} onpick={toggleTooth} />
		<!-- Legend matches ToothChart.severityClass: no-finding=gray, low=blue, med=amber, high=red -->
		<div class="mt-2 flex items-center gap-3 text-xs text-fg-2">
			<span class="flex items-center gap-1"
				><span class="size-2 rounded-full bg-fg-3"></span>{$_('cbct.healthy')}</span
			>
			<span class="flex items-center gap-1"
				><span class="size-2 rounded-full bg-primary"></span>{$_('cbct.mild')}</span
			>
			<span class="flex items-center gap-1"
				><span class="bg-warning-500 size-2 rounded-full"></span>{$_('cbct.moderate')}</span
			>
			<span class="flex items-center gap-1"
				><span class="bg-danger-500 size-2 rounded-full"></span>{$_('cbct.severe')}</span
			>
		</div>
	</div>
</div>

<ToothConditionsModal
	open={conditionsModalTooth != null}
	tooth={conditionsModalTooth ?? 0}
	conditions={selectedConditions}
	onclose={() => (conditionsModalTooth = null)}
/>

<style>
	.category-chip {
		font-size: 10px;
		font-weight: 600;
		text-transform: capitalize;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: transparent;
		color: var(--chip-color, var(--color-fg-1));
		border: 1px solid transparent;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}
	.category-chip.active {
		background: var(--chip-color, var(--color-primary));
		color: var(--color-bg-0);
	}
</style>
