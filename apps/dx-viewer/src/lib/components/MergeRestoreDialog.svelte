<script lang="ts">
	// Restore-options preview dialog — the diff-then-merge UX. Opened by LocalDataCard
	// after the cheap metadata read (server rows / zip manifest head) with a DRY-RUN
	// MergePlan. Two actions: Merge (non-destructive union, always available — the escape
	// hatch for the gate's "local-newer" dead-end) and Replace (destructive full overwrite,
	// enabled only when the canRestore gate passes). This dialog IS the confirmation
	// surface — it replaces the old bare confirm() prompts. The preview plan is advisory
	// display only; the apply step re-plans inside the backup lock.
	import { _ } from 'svelte-i18n';
	import { GitMerge, Loader2, RefreshCw, TriangleAlert } from 'lucide-svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { modalityLabel } from '$lib/modality';
	import { isPlanEmpty, stripUpdates, type MergePlan } from '$lib/backup/merge';
	import type { SalvageInfo } from '$lib/backup/zip';

	interface Props {
		open: boolean;
		plan: MergePlan | null;
		/** canRestore verdict for the destructive Replace action. */
		replaceAllowed: boolean;
		/** Damaged-archive salvage mode: warning + casualty list, and Replace is FORCED
		 *  off regardless of the gate — never wipe good local data for a damaged file. */
		damage?: SalvageInfo | null;
		busy?: boolean;
		onMerge?: (includeUpdates: boolean) => void;
		onReplace?: () => void;
		onClose?: () => void;
	}
	let {
		open = $bindable(false),
		plan,
		replaceAllowed,
		damage = null,
		busy = false,
		onMerge,
		onReplace,
		onClose
	}: Props = $props();

	// "Also update N items where the backup is newer" — default ON (the device-migration
	// case wants the other device's newer edits); the count makes it visible, never silent.
	// WRITABLE $derived: the checkbox bind reassigns it freely, and it RESETS to ON whenever
	// `open` changes — the dialog instance is long-lived (LocalDataCard renders it
	// unconditionally; only the inner content is gated on `open`), so an uncheck from a
	// previous, cancelled preview must not leak into the next merge as a silent adds-only
	// downgrade.
	let includeUpdates = $derived.by(() => {
		void open;
		return true;
	});

	const updatesCount = $derived(
		plan ? plan.counts.patientsUpdated + plan.counts.studiesUpdated + plan.counts.stateUpdated : 0
	);
	// With the toggle OFF the effective plan is adds-only — Merge disables when THAT is empty.
	const mergeIsNoop = $derived(!plan || isPlanEmpty(includeUpdates ? plan : stripUpdates(plan)));

	function close() {
		if (busy) return;
		open = false;
		onClose?.();
	}

	function handleKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if open && plan}
	<button
		class="fixed inset-0 z-[70] bg-bg-0/80 backdrop-blur-sm"
		onclick={close}
		aria-label={$_('common.close')}
	></button>
	<div
		use:focusTrap
		role="dialog"
		aria-modal="true"
		aria-labelledby="merge-dialog-title"
		data-testid="merge-dialog"
		class="fixed top-1/2 left-1/2 z-[71] flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-bg-1 shadow-2xl"
	>
		<div class="shrink-0 p-6 pb-4">
			<div class="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-bg-2">
				<GitMerge size={20} class="text-primary" />
			</div>
			<h3 id="merge-dialog-title" class="text-lg font-semibold text-fg-0">
				{$_('settings.localData.mergeTitle')}
			</h3>
			<p class="mt-1 text-sm text-fg-2">{$_('settings.localData.mergeIntro')}</p>
		</div>

		<!-- min-h-0 + overflow-y-auto: the casualty/duplicates lists are UNBOUNDED (a badly
		     truncated backup can lose hundreds of studies) — the body scrolls internally so
		     the action buttons below never leave the viewport. -->
		<div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 text-sm text-fg-1">
			{#if damage}
				<div
					class="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
					data-testid="merge-damage"
				>
					<TriangleAlert size={16} class="mt-0.5 shrink-0 text-danger" />
					<div>
						<p class="font-medium text-fg-0">
							{$_('settings.localData.damagedIntro', {
								values: { lost: damage.lost.length, total: damage.totalStudies }
							})}
						</p>
						{#if damage.lost.length > 0}
							<p class="mt-1 text-fg-2">{$_('settings.localData.damagedLost')}</p>
							<ul class="list-disc pl-4 text-fg-1">
								{#each damage.lost as d, i (i)}
									<li>{d.name} ({modalityLabel(d.modality, $_)})</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
			{/if}
			<p data-testid="merge-adds">
				{$_('settings.localData.mergeAdds', {
					values: {
						patients: plan.counts.patientsAdded,
						studies: plan.counts.studiesAdded,
						state: plan.counts.stateAdded
					}
				})}
			</p>
			{#if updatesCount > 0}
				<label class="flex cursor-pointer items-start gap-2">
					<input
						type="checkbox"
						bind:checked={includeUpdates}
						data-testid="merge-updates-toggle"
						class="mt-0.5"
					/>
					<span>{$_('settings.localData.mergeUpdates', { values: { n: updatesCount } })}</span>
				</label>
			{/if}
			{#if plan.counts.unchanged > 0}
				<p class="text-fg-2">
					{$_('settings.localData.mergeUnchanged', { values: { n: plan.counts.unchanged } })}
				</p>
			{/if}
			{#if plan.counts.suppressed > 0}
				<p class="text-fg-2" data-testid="merge-suppressed">
					{$_('settings.localData.mergeSuppressed', { values: { n: plan.counts.suppressed } })}
				</p>
			{/if}
			{#if plan.counts.filesToFetch > 0}
				<p class="text-fg-2">
					{$_('settings.localData.mergeFiles', { values: { n: plan.counts.filesToFetch } })}
				</p>
			{/if}
			{#if plan.possibleDuplicates.length > 0}
				<div class="rounded-lg bg-bg-2 p-3 text-xs" data-testid="merge-duplicates">
					<p class="mb-1 font-medium text-fg-0">{$_('settings.localData.mergeDuplicates')}</p>
					<ul class="list-disc space-y-0.5 pl-4 text-fg-1">
						{#each plan.possibleDuplicates as d (d.backupId)}
							<li>{d.name}{d.dob ? ` (${d.dob})` : ''}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<!-- The honest framing line: merge never deletes anything on this device. -->
			<p class="text-xs text-fg-2">{$_('settings.localData.mergeNoDelete')}</p>
		</div>

		<div class="shrink-0 px-6 py-5">
			<div class="flex flex-wrap justify-end gap-2">
				<button class="btn-secondary" data-testid="merge-cancel" disabled={busy} onclick={close}>
					{$_('common.cancel')}
				</button>
				<button
					class="btn-danger"
					data-testid="replace-confirm"
					disabled={busy || !replaceAllowed || !!damage}
					onclick={() => onReplace?.()}
				>
					{#if busy}<Loader2 size={14} class="spin" />{:else}<RefreshCw size={14} />{/if}
					{$_('settings.localData.replaceButton')}
				</button>
				<button
					class="btn-primary"
					data-testid="merge-confirm"
					disabled={busy || mergeIsNoop}
					onclick={() => onMerge?.(includeUpdates)}
				>
					{#if busy}<Loader2 size={14} class="spin" />{:else}<GitMerge size={14} />{/if}
					{$_('settings.localData.mergeButton')}
				</button>
			</div>
			<p class="mt-2 text-right text-xs text-fg-2">
				{#if damage}
					{$_('settings.localData.damagedReplaceBlocked')}
				{:else if replaceAllowed}
					{$_('settings.localData.replaceWarning')}
				{:else}
					{$_('settings.localData.replaceBlockedLocalNewer')}
				{/if}
			</p>
		</div>
	</div>
{/if}

<style>
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-secondary {
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-weight: 500;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
	.btn-secondary:hover:not(:disabled) {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.btn-danger {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--color-bg-2);
		border: 1px solid var(--color-danger);
		color: var(--color-danger);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
	.btn-danger:hover:not(:disabled) {
		background: var(--color-danger);
		color: var(--color-on-primary);
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.btn-primary :global(.spin),
	.btn-danger :global(.spin) {
		animation: mrd-spin 0.8s linear infinite;
	}
	@keyframes mrd-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
