<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { Copy, Download, Pencil, Check, X as XIcon } from 'lucide-svelte';
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { auth } from '$lib/stores/auth.svelte';
	import { debouncedSave } from '$lib/debouncedSave';
	import {
		loadReportState,
		saveReportState,
		effectiveReportText,
		type ReportStatus
	} from '$lib/reportState';

	interface Props {
		studyId: string | undefined;
		/** The AI report markdown (inference.report) — the base shown/edited when the
		 *  clinician hasn't saved their own edit yet. */
		aiReport: string;
		/** Build + download the styled PDF. The viewer handles it (it owns the canvas +
		 *  inference); we pass the effective text + verdict so the PDF reflects edits. */
		onDownloadPdf?: (data: { text: string; status: ReportStatus }) => void;
	}
	let { studyId, aiReport, onDownloadPdf }: Props = $props();

	let editedText = $state(''); // clinician's edit ('' = unedited → fall back to aiReport)
	let status = $state<ReportStatus>('');
	let editing = $state(false);
	let draft = $state(''); // textarea buffer while editing
	let copied = $state(false);
	let syncFailed = $state(false);
	let loadedFor = ''; // non-reactive guard so the load effect doesn't loop

	const MAX = 50000;
	const effectiveText = $derived(effectiveReportText(editedText, aiReport));
	const hasReport = $derived(!!effectiveText.trim());

	function renderMd(md: string): string {
		const raw = marked.parse(md, { async: false }) as string;
		DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
			if (node.tagName === 'A') {
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer');
			}
		});
		try {
			return DOMPurify.sanitize(raw);
		} finally {
			DOMPurify.removeHook('afterSanitizeAttributes');
		}
	}

	// Load this (user, study)'s saved report state from PB on study change. Resets the
	// view first so a slow load never shows the previous study's edit.
	$effect(() => {
		const id = studyId;
		const user = auth.user;
		if (!browser || !id || !user) return;
		if (loadedFor === id) return;
		loadedFor = id;
		// Flush (not drop) a pending save from the PREVIOUS study before resetting —
		// its payload was snapshotted at schedule time, so it persists the previous
		// study's edit under the previous study's id (the old cancel-on-switch dropped
		// the last <350ms of typing instead).
		saver.flush();
		editing = false;
		editedText = '';
		status = '';
		void (async () => {
			try {
				const r = await loadReportState(id, user.id);
				if (r && loadedFor === id) {
					editedText = r.text;
					status = r.status;
				}
			} catch (e) {
				console.warn('study_report_state load failed', e);
			}
		})();
	});

	const saver = debouncedSave();
	function scheduleSave() {
		if (!browser || !studyId || !auth.user) return;
		// Snapshot the payload now: a flush may fire during a study switch/unmount.
		const payload = { studyId, userId: auth.user.id, text: editedText, status };
		saver.schedule(async () => {
			try {
				await saveReportState(payload);
				syncFailed = false;
			} catch (e) {
				console.warn('study_report_state save failed', e);
				syncFailed = true;
			}
		});
	}
	// FLUSH (not drop) on unmount — report text typed <350ms before navigating away
	// must persist (the IndexedDB write completes after teardown).
	onDestroy(() => saver.flush());

	function startEdit() {
		draft = effectiveText;
		editing = true;
	}
	function cancelEdit() {
		editing = false;
	}
	function saveEdit() {
		editedText = draft.slice(0, MAX);
		editing = false;
		scheduleSave();
	}
	function setStatus(s: ReportStatus) {
		status = status === s ? '' : s; // click the active verdict again to clear it
		scheduleSave();
	}
	async function copyReport() {
		try {
			await navigator.clipboard.writeText(effectiveText);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch (e) {
			console.warn('copy report failed', e);
		}
	}
	function downloadPdf() {
		onDownloadPdf?.({ text: effectiveText, status });
	}
</script>

<div class="flex h-full w-full flex-col bg-bg-1">
	<!-- Header + Acceptable / Unacceptable verdict -->
	<div class="border-b border-border px-3 py-2.5">
		<div class="text-[13px] font-semibold text-fg-0">{$_('viewer.diagnosticReport')}</div>
		<div class="mt-2 flex gap-1.5">
			<button
				type="button"
				class="verdict ok"
				class:on={status === 'acceptable'}
				aria-pressed={status === 'acceptable'}
				data-testid="report-acceptable"
				onclick={() => setStatus('acceptable')}
			>
				<Check size={12} />
				{$_('viewer.reportAcceptable')}
			</button>
			<button
				type="button"
				class="verdict bad"
				class:on={status === 'unacceptable'}
				aria-pressed={status === 'unacceptable'}
				data-testid="report-unacceptable"
				onclick={() => setStatus('unacceptable')}
			>
				<XIcon size={12} />
				{$_('viewer.reportUnacceptable')}
			</button>
		</div>
	</div>

	<!-- Toolbar: Edit / Copy / Download PDF -->
	<div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
		{#if editing}
			<button type="button" class="rbtn primary" data-testid="report-save" onclick={saveEdit}>
				{$_('common.save')}
			</button>
			<button type="button" class="rbtn" onclick={cancelEdit}>{$_('common.cancel')}</button>
		{:else}
			<button type="button" class="rbtn" data-testid="report-edit" onclick={startEdit}>
				<Pencil size={12} />
				{$_('viewer.editReport')}
			</button>
			<button
				type="button"
				class="rbtn"
				data-testid="report-copy"
				onclick={copyReport}
				disabled={!hasReport}
			>
				<Copy size={12} />
				{copied ? $_('viewer.copied') : $_('viewer.copyReport')}
			</button>
			<button
				type="button"
				class="rbtn primary"
				data-testid="report-download"
				onclick={downloadPdf}
				disabled={!hasReport}
			>
				<Download size={12} />
				{$_('viewer.downloadReport')}
			</button>
		{/if}
	</div>

	{#if syncFailed}
		<div class="px-3 py-1.5 text-[10px] text-warning" role="status">
			{$_('viewer.reportSyncFailed')}
		</div>
	{/if}

	<div class="flex-1 overflow-y-auto p-3">
		{#if editing}
			<textarea
				class="report-textarea"
				bind:value={draft}
				maxlength={MAX}
				aria-label={$_('viewer.editReport')}
				placeholder={$_('viewer.reportPlaceholder')}
			></textarea>
		{:else if hasReport}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMd() output is DOMPurify-sanitized (see SECURITY_REVIEW) -->
			<div class="report-prose prose max-w-none text-sm">{@html renderMd(effectiveText)}</div>
		{:else}
			<p class="text-sm text-fg-2">{$_('viewer.noReport')}</p>
		{/if}
	</div>
</div>

<style>
	.verdict {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex: 1;
		justify-content: center;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-fg-2);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.35rem 0.4rem;
		cursor: pointer;
	}
	.verdict:hover {
		color: var(--color-fg-0);
	}
	.verdict.ok.on {
		color: var(--color-success);
		border-color: var(--color-success);
		background: color-mix(in oklab, var(--color-success) 14%, transparent);
	}
	.verdict.bad.on {
		color: var(--color-danger);
		border-color: var(--color-danger);
		background: color-mix(in oklab, var(--color-danger) 14%, transparent);
	}
	.rbtn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--color-fg-1);
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}
	.rbtn:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-fg-0);
	}
	.rbtn.primary {
		color: var(--color-primary);
		border-color: var(--color-primary);
		background: var(--color-primary-tint);
	}
	.rbtn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.report-textarea {
		width: 100%;
		min-height: 60vh;
		resize: vertical;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.6rem;
		color: var(--color-fg-0);
		font-size: 0.78rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		line-height: 1.5;
		outline: none;
	}
	.report-textarea:focus {
		border-color: var(--color-primary);
	}
	/* Theme-aware report prose (same token mapping the legal pages + viewer modal use). */
	.report-prose {
		--tw-prose-body: var(--color-fg-1);
		--tw-prose-headings: var(--color-fg-0);
		--tw-prose-bold: var(--color-fg-0);
		--tw-prose-links: var(--color-primary);
		--tw-prose-counters: var(--color-fg-2);
		--tw-prose-bullets: var(--color-fg-3);
		--tw-prose-hr: var(--color-border);
		--tw-prose-quotes: var(--color-fg-1);
		--tw-prose-quote-borders: var(--color-border);
		--tw-prose-code: var(--color-fg-0);
		--tw-prose-pre-bg: var(--color-bg-2);
	}
</style>
