<script lang="ts">
	// LOCAL-FIRST "Local data" Labs card — backup / restore / export / import / merge.
	// Patient data lives in this browser's IndexedDB; these four controls move it to/from
	// the server or a file. Restore and Import open a PREVIEW DIALOG (MergeRestoreDialog)
	// built from a dry-run merge plan: Merge (non-destructive union) is always available;
	// the destructive Replace stays behind the canRestore gate (local empty or older than
	// the backup), so unbacked-up work is never silently lost.
	import { _, locale } from 'svelte-i18n';
	import { UploadCloud, DownloadCloud, FileDown, FileUp, Loader2 } from 'lucide-svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { studies } from '$lib/stores/studies.svelte';
	import { localDb } from '$lib/db/localDb';
	import {
		backupToServer,
		restoreFromServer,
		mergeFromServer,
		planMergeFromServer
	} from '$lib/backup/online';
	import {
		exportToZip,
		importFromZip,
		isDamagedArchiveError,
		mergeFromZip,
		planMergeFromZip,
		planSalvageFromZip,
		type SalvageInfo
	} from '$lib/backup/zip';
	import { canRestore } from '$lib/backup/gate';
	import type { MergePlan } from '$lib/backup/merge';
	import MergeRestoreDialog from './MergeRestoreDialog.svelte';

	type Busy = '' | 'backup' | 'restore' | 'export' | 'import' | 'merge';
	let busy = $state<Busy>('');
	let message = $state('');
	let isError = $state(false);
	let lastBackupAt = $state<number | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	// Preview-dialog state. `pendingFile` keeps the picked zip for the apply step (the
	// preview only stream-read its head). `dialogDamage` switches the dialog into the
	// damaged-archive salvage mode (merge-only).
	let dialogOpen = $state(false);
	let dialogPlan = $state<MergePlan | null>(null);
	let dialogSource = $state<'server' | 'file'>('server');
	let dialogReplaceOk = $state(false);
	let dialogDamage = $state<SalvageInfo | null>(null);
	let pendingFile: File | null = null;

	$effect(() => {
		const uid = auth.user?.id;
		if (!uid) return;
		void localDb.getBackupPointer(uid).then((p) => (lastBackupAt = p?.at ?? null));
	});

	const lastBackupLabel = $derived(
		lastBackupAt
			? $_('settings.localData.lastBackup', {
					values: { time: new Date(lastBackupAt).toLocaleString($locale ?? undefined) }
				})
			: $_('settings.localData.never')
	);

	function setMsg(key: string, error = false, values?: Record<string, number>) {
		message = $_(key, values ? { values } : undefined);
		isError = error;
	}

	function mapError(e: unknown): string {
		const msg = e instanceof Error ? e.message : '';
		if (msg === 'no server backup') return 'settings.localData.noBackup';
		if (msg === 'not enough storage') return 'settings.localData.storageFull';
		// The in-lock TOCTOU re-check refused a Replace whose preview-time verdict went
		// stale (writes landed while the dialog sat open) — nothing was overwritten.
		if (msg === 'local-newer') return 'settings.localData.localNewer';
		return 'settings.localData.failed';
	}

	async function doBackup() {
		if (busy || !auth.user) return;
		busy = 'backup';
		message = '';
		try {
			const ptr = await backupToServer(auth.user.id);
			lastBackupAt = ptr.at;
			setMsg('settings.localData.backupDone');
		} catch (e) {
			console.warn('backup failed', e);
			setMsg('settings.localData.failed', true);
		} finally {
			busy = '';
		}
	}

	/** Open the preview dialog for a dry-run plan: Replace stays gated; Merge is always on.
	 *  In salvage mode (`damage`) Replace is forced off — never wipe good local data on
	 *  the strength of a damaged archive. */
	async function openPreview(plan: MergePlan, source: 'server' | 'file', damage?: SalvageInfo) {
		const uid = auth.user!.id;
		const localEmpty = await localDb.isEmpty(uid);
		const localDataVersion = await localDb.getDataVersion(uid);
		dialogReplaceOk =
			!damage &&
			canRestore({
				localEmpty,
				localDataVersion,
				backupDataVersion: plan.backupDataVersion
			}).ok;
		dialogDamage = damage ?? null;
		dialogPlan = plan;
		dialogSource = source;
		dialogOpen = true;
	}

	/** The strict zip path failed with a broken-archive error → offer the merge-only
	 *  salvage preview instead of a dead-end failure message. Rethrows when even the
	 *  manifest is unrecoverable (genuinely nothing to salvage). */
	async function openSalvagePreview(file: File): Promise<void> {
		const { plan, salvage } = await planSalvageFromZip(auth.user!.id, file);
		pendingFile = file;
		await openPreview(plan, 'file', salvage);
	}

	async function doRestore() {
		if (busy || !auth.user) return;
		busy = 'restore';
		message = '';
		try {
			// Dry-run plan from the server METADATA only (no blob downloads) — feeds both
			// the preview counts and the gate (plan.backupDataVersion is the pointer's).
			const plan = await planMergeFromServer(auth.user.id);
			await openPreview(plan, 'server');
		} catch (e) {
			console.warn('restore preview failed', e);
			setMsg(mapError(e), true);
		} finally {
			busy = '';
		}
	}

	/** The dialog's Merge action — additive diff-then-merge, never deletes local data. */
	async function doMerge(includeUpdates: boolean) {
		if (busy || !auth.user) return;
		busy = 'merge';
		message = '';
		const file = pendingFile;
		try {
			const res =
				dialogSource === 'server'
					? await mergeFromServer(auth.user.id, { includeUpdates })
					: await mergeFromZip(auth.user.id, file!, {
							includeUpdates,
							salvage: !!dialogDamage
						});
			dialogOpen = false;
			pendingFile = null;
			if (!res.applied) {
				setMsg('settings.localData.alreadyUpToDate');
				return;
			}
			// hardReload (not refresh): winning updates swapped blobs under existing ids.
			await studies.hardReload();
			const c = res.plan.counts;
			setMsg('settings.localData.mergeDone', false, {
				n:
					c.patientsAdded +
					c.studiesAdded +
					c.stateAdded +
					c.patientsUpdated +
					c.studiesUpdated +
					c.stateUpdated
			});
		} catch (e) {
			console.warn('merge failed', e);
			dialogOpen = false;
			// The light preview only reads the archive HEAD — tail damage (the common
			// truncated-download case) surfaces here, at the strict full read. Offer the
			// merge-only salvage instead of a dead-end failure.
			if (dialogSource === 'file' && !dialogDamage && file && isDamagedArchiveError(e)) {
				try {
					await openSalvagePreview(file);
					return;
				} catch (e2) {
					console.warn('salvage preview failed', e2);
				}
			}
			pendingFile = null;
			setMsg(mapError(e), true);
		} finally {
			busy = '';
		}
	}

	/** The dialog's Replace action — the original destructive full overwrite (gated). */
	async function doReplace() {
		if (busy || !auth.user) return;
		busy = dialogSource === 'server' ? 'restore' : 'import';
		message = '';
		const file = pendingFile;
		try {
			if (dialogSource === 'server') {
				await restoreFromServer(auth.user.id);
			} else {
				await importFromZip(auth.user.id, file!);
			}
			dialogOpen = false;
			pendingFile = null;
			// hardReload (not refresh): cached object URLs point at the PRE-restore blobs.
			await studies.hardReload();
			if (dialogSource === 'server') {
				lastBackupAt = (await localDb.getBackupPointer(auth.user.id))?.at ?? lastBackupAt;
			}
			// (A file import does NOT move the "last backed up" pointer — that tracks the
			// last ONLINE backup only.)
			setMsg(
				dialogSource === 'server'
					? 'settings.localData.restoreDone'
					: 'settings.localData.importDone'
			);
		} catch (e) {
			console.warn('replace failed', e);
			dialogOpen = false;
			// A damaged file discovered at Replace time gets the same merge-only salvage
			// offer (Replace itself stays refused — the archive cannot be trusted wholesale).
			if (dialogSource === 'file' && file && isDamagedArchiveError(e)) {
				try {
					await openSalvagePreview(file);
					return;
				} catch (e2) {
					console.warn('salvage preview failed', e2);
				}
			}
			pendingFile = null;
			setMsg(mapError(e), true);
		} finally {
			busy = '';
		}
	}

	async function doExport() {
		if (busy || !auth.user) return;
		busy = 'export';
		message = '';
		try {
			const blob = await exportToZip(auth.user.id);
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			const stamp = new Date().toISOString().slice(0, 10);
			a.href = url;
			a.download = `dx-viewer-backup-${stamp}.zip`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
			setMsg('settings.localData.exportDone');
		} catch (e) {
			console.warn('export failed', e);
			// The .zip container caps out near 4 GiB (no zip64) — surface the specific
			// guidance (use the online backup) instead of a generic failure.
			setMsg(
				e instanceof Error && e.message === 'export too large'
					? 'settings.localData.exportTooLarge'
					: 'settings.localData.failed',
				true
			);
		} finally {
			busy = '';
		}
	}

	function pickImportFile() {
		if (busy) return;
		fileInput?.click();
	}

	async function onImportFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-selecting the same file
		if (!file || !auth.user) return;
		busy = 'import';
		message = '';
		try {
			// Dry-run plan from the manifest at the head of the archive (validates the
			// schemaVersion + structure before anything else happens).
			const plan = await planMergeFromZip(auth.user.id, file);
			pendingFile = file;
			await openPreview(plan, 'file');
		} catch (e) {
			console.warn('import preview failed', e);
			// A broken archive gets the merge-only salvage preview instead of a dead end;
			// salvage itself rethrows when even the manifest is gone (nothing to recover).
			if (isDamagedArchiveError(e)) {
				try {
					await openSalvagePreview(file);
					return;
				} catch (e2) {
					console.warn('salvage preview failed', e2);
				}
			}
			setMsg(mapError(e), true);
		} finally {
			busy = '';
		}
	}
</script>

<section class="card">
	<h2 class="card-title">{$_('settings.localData.title')}</h2>
	<p class="card-sub">{$_('settings.localData.desc')}</p>

	<p class="mb-4 text-xs text-fg-2" data-testid="last-backup">{lastBackupLabel}</p>

	<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
		<button class="act" data-testid="backup-online" disabled={!!busy} onclick={doBackup}>
			{#if busy === 'backup'}<Loader2 size={15} class="spin" />{:else}<UploadCloud size={15} />{/if}
			{$_('settings.localData.backup')}
		</button>
		<button class="act" data-testid="restore-online" disabled={!!busy} onclick={doRestore}>
			{#if busy === 'restore'}<Loader2 size={15} class="spin" />{:else}<DownloadCloud
					size={15}
				/>{/if}
			{$_('settings.localData.restore')}
		</button>
		<button class="act" data-testid="export-file" disabled={!!busy} onclick={doExport}>
			{#if busy === 'export'}<Loader2 size={15} class="spin" />{:else}<FileDown size={15} />{/if}
			{$_('settings.localData.export')}
		</button>
		<button class="act" data-testid="import-file" disabled={!!busy} onclick={pickImportFile}>
			{#if busy === 'import'}<Loader2 size={15} class="spin" />{:else}<FileUp size={15} />{/if}
			{$_('settings.localData.import')}
		</button>
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept=".zip,application/zip"
		class="hidden"
		aria-hidden="true"
		tabindex="-1"
		onchange={onImportFile}
	/>

	{#if message}
		<!-- Errors are assertive (role=alert) so screen readers announce a failed
		     backup/restore; successes stay polite (role=status). -->
		<p
			class="mt-3 text-xs"
			class:text-danger={isError}
			class:text-fg-2={!isError}
			role={isError ? 'alert' : 'status'}
		>
			{message}
		</p>
	{/if}
</section>

<MergeRestoreDialog
	bind:open={dialogOpen}
	plan={dialogPlan}
	replaceAllowed={dialogReplaceOk}
	damage={dialogDamage}
	busy={busy === 'merge' || busy === 'restore' || busy === 'import'}
	onMerge={doMerge}
	onReplace={doReplace}
	onClose={() => {
		pendingFile = null;
		dialogDamage = null;
	}}
/>

<style>
	.card {
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 1.5rem;
	}
	.card-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--color-fg-0);
		margin: 0 0 0.25rem;
	}
	.card-sub {
		font-size: 0.85rem;
		color: var(--color-fg-2);
		margin: 0 0 1rem;
	}
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-control);
		padding: 0.6rem 0.8rem;
		color: var(--color-fg-1);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color 0.12s,
			color 0.12s;
	}
	.act:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-fg-0);
	}
	.act:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.act :global(.spin) {
		animation: lc-spin 0.8s linear infinite;
	}
	@keyframes lc-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.hidden {
		display: none;
	}
</style>
