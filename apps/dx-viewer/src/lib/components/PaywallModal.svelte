<script lang="ts">
	import { Lock, Sparkles } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { focusTrap } from '$lib/focusTrap';

	interface Props {
		open: boolean;
		reason?: string;
		onClose?: () => void;
	}
	let { open = $bindable(false), reason = 'No Subscription', onClose }: Props = $props();

	function close() {
		open = false;
		onClose?.();
	}

	function toBilling() {
		close();
		goto(resolve('/(app)/billing'));
	}

	const titleText = $derived.by(() => {
		if (reason === 'Inactive Subscription') return $_('paywall.titleInactive');
		if (reason.includes('Expired')) return $_('paywall.titleExpired');
		return $_('paywall.titleRequired');
	});

	// Escape closes the soft paywall — matches the dismiss buttons + backdrop click,
	// and matches the a11y guidance that modal dialogs should be Esc-dismissible
	// (ConsentModal is the deliberate exception — that one CAN'T be dismissed).
	function handleKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

<svelte:window onkeydown={handleKey} />

{#if open}
	<button
		class="fixed inset-0 z-[70] bg-bg-0/80 backdrop-blur-sm"
		onclick={close}
		aria-label={$_('common.close')}
	></button>
	<div
		use:focusTrap
		role="dialog"
		aria-modal="true"
		aria-labelledby="paywall-title"
		class="fixed top-1/2 left-1/2 z-[71] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-bg-1 shadow-2xl"
	>
		<div class="bg-gradient-to-br from-primary/15 to-accent/15 p-6">
			<div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-bg-1">
				<Lock size={22} class="text-primary" />
			</div>
			<h3 id="paywall-title" class="text-lg font-semibold text-fg-0">{titleText}</h3>
			<p class="mt-1 text-sm text-fg-2">
				{#if reason.includes('Expired')}
					{$_('paywall.descExpired')}
				{:else if reason === 'Inactive Subscription'}
					{$_('paywall.descInactive')}
				{:else}
					{$_('paywall.descRequired')}
				{/if}
			</p>
		</div>
		<div class="space-y-3 px-6 py-5">
			<div class="rounded-lg bg-bg-2 p-3 text-sm">
				<div class="mb-1 flex items-center gap-1.5 font-medium text-fg-0">
					<Sparkles size={14} class="text-accent" />
					{$_('paywall.proFeatures')}
				</div>
				<ul class="list-disc space-y-1 pl-5 text-xs text-fg-1">
					<li>{$_('paywall.feat1')}</li>
					<li>{$_('paywall.feat2')}</li>
					<li>{$_('paywall.feat3')}</li>
				</ul>
			</div>
			<div class="flex justify-end gap-2 pt-2">
				<button class="btn-secondary" onclick={close}>{$_('common.notNow')}</button>
				<button class="btn-primary" onclick={toBilling}>{$_('common.viewPlans')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.btn-primary {
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
	.btn-primary:hover {
		background: var(--color-primary-hover);
	}
	.btn-secondary {
		background: var(--color-bg-2);
		border: 1px solid var(--color-border);
		color: var(--color-fg-1);
		font-weight: 500;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: 0.4rem;
		cursor: pointer;
	}
	.btn-secondary:hover {
		color: var(--color-fg-0);
		border-color: var(--color-border-hover);
	}
</style>
