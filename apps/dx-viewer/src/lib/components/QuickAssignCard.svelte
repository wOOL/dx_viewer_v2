<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { studies } from '$lib/stores/studies.svelte';
	import { assignablePatients, foldDiacritics } from '$lib/patients';
	import {
		MAX_NAME_LENGTH,
		serverErrorMessage,
		resolveErrorMessage,
		operationErrorKey
	} from '$lib/forms';
	import { todayLocalISO, validateDobISO, MIN_DOB_ISO } from '$lib/date';
	import { MAX_SEARCH_LENGTH } from '$lib/limits';
	import type { StoredPatient } from '$lib/types';
	import { UserPlus, Users, Check, X } from 'lucide-svelte';

	// Offers to give a quick scan a real patient identity, file it under an existing
	// patient, or keep it as-is. Remounted per patient (keyed by parent), so plain
	// $state fields below reset cleanly without a state-resetting $effect.
	let { patient }: { patient: StoredPatient } = $props();

	type Mode = 'idle' | 'name' | 'existing';
	let mode = $state<Mode>('idle');
	let busy = $state(false);
	// Surface a failed save instead of silently re-enabling the button — a clinician
	// who names/files a quick patient must know if it didn't actually persist.
	let err = $state('');
	let nameVal = $state('');
	let dobVal = $state('');
	let search = $state('');
	let selectedId = $state('');

	const targets = $derived(assignablePatients(studies.patients, patient.id));
	const candidates = $derived(
		targets.filter((p) => {
			const q = foldDiacritics(search.trim());
			return !q || foldDiacritics(p.name).includes(q);
		})
	);

	function openName() {
		nameVal = patient.name ?? '';
		dobVal = patient.dob ? patient.dob.slice(0, 10) : '';
		mode = 'name';
	}
	function openExisting() {
		search = '';
		selectedId = '';
		mode = 'existing';
	}

	async function doName(e: SubmitEvent) {
		e.preventDefault();
		if (!nameVal.trim() || busy) return;
		// `min`/`max` block the picker, but a typed/pasted out-of-range date can
		// still reach here — guard the submit too before writing the patient DOB.
		// Mirrors the new-study upload form: both a future floor AND a sane past
		// floor (a year-0001 / absurd-past DOB would otherwise flow into the chart
		// + printout). See validateDobISO.
		const dobCheck = validateDobISO(dobVal);
		if (dobCheck === 'future') {
			err = $_('upload.errFutureDob');
			return;
		}
		if (dobCheck === 'tooOld') {
			err = $_('upload.errDobTooOld');
			return;
		}
		busy = true;
		err = '';
		try {
			await studies.renamePatient(patient.id, { name: nameVal, dob: dobVal || undefined });
			mode = 'idle';
		} catch (e2) {
			err = $_(operationErrorKey(e2, 'quickassign.saveFailed'));
		} finally {
			busy = false;
		}
	}
	async function doKeep() {
		if (busy) return;
		busy = true;
		err = '';
		try {
			await studies.setQuick(patient.id, false);
		} catch (e2) {
			err = $_(operationErrorKey(e2, 'quickassign.saveFailed'));
		} finally {
			busy = false;
		}
	}
	async function doMerge() {
		if (!selectedId || busy) return;
		// Merging is destructive — it MOVES every study onto the target and DELETES this
		// quick patient. Confirm first (named) so a misclick on "Assign" can't silently
		// lose the record. Every other destructive action in the app confirms.
		const target = studies.patients.find((p) => p.id === selectedId);
		const targetName = target?.name || $_('quickassign.searchPlaceholder');
		if (!confirm($_('quickassign.mergeConfirm', { values: { name: targetName } }))) return;
		busy = true;
		err = '';
		const toId = selectedId;
		try {
			await studies.mergePatientInto(patient.id, toId);
			await goto(resolve('/(app)/patients/[patientId]', { patientId: toId }));
		} catch (e2) {
			// mergePatientInto throws a localized message on a partial move
			// (quickassign.mergeIncomplete); for any other failure map by status rather
			// than leaking a raw English .message.
			const raw = (e2 as { status?: number; message?: string })?.message;
			err =
				typeof (e2 as { status?: number })?.status === 'number'
					? resolveErrorMessage(serverErrorMessage(e2), $_, {
							status: (e2 as { status: number }).status
						})
					: raw || $_('quickassign.saveFailed');
		} finally {
			busy = false;
		}
	}
</script>

<div class="wrap" data-testid="quick-assign-banner">
	<div class="card">
		{#if mode === 'idle'}
			<div class="row">
				<span class="badge">{$_('quickassign.badge')}</span>
				<p class="prompt">{$_('quickassign.prompt', { values: { name: patient.name } })}</p>
			</div>
			<div class="actions">
				<button type="button" class="btn primary" data-testid="qa-name" onclick={openName}>
					<UserPlus size={15} />{$_('quickassign.nameIt')}
				</button>
				<button type="button" class="btn" data-testid="qa-existing" onclick={openExisting}>
					<Users size={15} />{$_('quickassign.addExisting')}
				</button>
				<button
					type="button"
					class="btn ghost"
					data-testid="qa-keep"
					onclick={doKeep}
					disabled={busy}
				>
					{$_('quickassign.keep')}
				</button>
			</div>
		{:else if mode === 'name'}
			<form class="panel" onsubmit={doName}>
				<label class="field">
					<span>{$_('quickassign.nameLabel')}</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input type="text" bind:value={nameVal} autofocus required maxlength={MAX_NAME_LENGTH} />
				</label>
				<label class="field">
					<span>{$_('quickassign.dobLabel')}</span>
					<input type="date" min={MIN_DOB_ISO} max={todayLocalISO()} bind:value={dobVal} />
				</label>
				<div class="actions">
					<button type="submit" class="btn primary" disabled={busy || !nameVal.trim()}>
						<Check size={15} />{$_('quickassign.save')}
					</button>
					<button type="button" class="btn ghost" onclick={() => (mode = 'idle')} disabled={busy}>
						{$_('quickassign.cancel')}
					</button>
				</div>
			</form>
		{:else}
			<div class="panel">
				<div class="title">{$_('quickassign.existingTitle')}</div>
				{#if targets.length === 0}
					<p class="empty">{$_('quickassign.noPatients')}</p>
				{:else}
					<input
						type="search"
						class="search"
						maxlength={MAX_SEARCH_LENGTH}
						bind:value={search}
						placeholder={$_('quickassign.searchPlaceholder')}
					/>
					<ul class="list">
						{#each candidates as p (p.id)}
							<li>
								<button
									type="button"
									class="cand"
									class:sel={selectedId === p.id}
									onclick={() => (selectedId = p.id)}
								>
									<span class="cname">{p.name}</span>
									{#if p.dob}<span class="cdob">{p.dob.slice(0, 10)}</span>{/if}
								</button>
							</li>
						{:else}
							<li class="empty">{$_('quickassign.noMatches')}</li>
						{/each}
					</ul>
				{/if}
				<div class="actions">
					<button
						type="button"
						class="btn primary"
						onclick={doMerge}
						disabled={busy || !selectedId}
					>
						<Check size={15} />{$_('quickassign.assign')}
					</button>
					<button type="button" class="btn ghost" onclick={() => (mode = 'idle')} disabled={busy}>
						<X size={15} />{$_('quickassign.cancel')}
					</button>
				</div>
			</div>
		{/if}
		{#if err}
			<p class="err" role="alert">{err}</p>
		{/if}
	</div>
</div>

<style>
	.wrap {
		position: fixed;
		left: 50%;
		bottom: 1.25rem;
		transform: translateX(-50%);
		z-index: 70;
		width: min(34rem, calc(100vw - 2rem));
		pointer-events: none;
	}
	.card {
		pointer-events: auto;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.9rem 1rem;
		border-radius: var(--radius-card);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.badge {
		flex-shrink: 0;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--color-primary);
		background: var(--color-primary-tint);
	}
	.prompt {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-fg-1);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.45rem 0.85rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-2);
		color: var(--color-fg-1);
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn:hover:not(:disabled) {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
	.btn.primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-on-primary);
	}
	.btn.primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
		border-color: var(--color-primary-hover);
		color: var(--color-on-primary);
	}
	.btn.ghost {
		background: transparent;
		border-color: transparent;
		color: var(--color-fg-2);
	}
	.btn.ghost:hover:not(:disabled) {
		color: var(--color-fg-0);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--color-fg-0);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.78rem;
		color: var(--color-fg-2);
	}
	.field input,
	.search {
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-0);
		color: var(--color-fg-0);
		font-size: 0.9rem;
	}
	.field input:focus,
	.search:focus {
		outline: 2px solid var(--color-ring);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 11rem;
		overflow-y: auto;
	}
	.cand {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border-radius: var(--radius-control);
		border: 1px solid var(--color-border);
		background: var(--color-bg-2);
		color: var(--color-fg-1);
		font-size: 0.85rem;
		cursor: pointer;
		text-align: left;
	}
	.cand:hover {
		border-color: var(--color-border-hover);
		color: var(--color-fg-0);
	}
	.cand.sel {
		border-color: var(--color-primary);
		background: var(--color-primary-tint);
		color: var(--color-fg-0);
	}
	.cname {
		font-weight: 600;
	}
	.cdob {
		font-size: 0.75rem;
		color: var(--color-fg-2);
	}
	.empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-fg-2);
	}
	.err {
		margin: 0.6rem 0 0;
		font-size: 0.8rem;
		color: var(--color-danger);
	}
</style>
