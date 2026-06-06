<script lang="ts">
	import { auth } from '$lib/stores/auth.svelte';
	import { resolve } from '$app/paths';
	import { _ } from 'svelte-i18n';
	import { ShieldCheck, FileText, Loader2 } from 'lucide-svelte';
	import { focusTrap } from '$lib/focusTrap';
	import { serverErrorMessage, resolveErrorMessage } from '$lib/forms';

	let loading = $state(false);
	let error = $state('');

	// A2: show ONLY when the gate has resolved to a confirmed "not consented"
	// ('consent'). Previously this was `consentOk === false`, which (combined with
	// the layout always setting ready=true) meant a FAILED check left consentOk=null
	// → modal hidden → app accessible with no recorded consent (fail OPEN). Gating on
	// the resolved 'consent' state keeps the modal hidden during 'pending'/'error'
	// (the layout shows a spinner / retry block instead) and shown only when needed.
	const show = $derived(auth.isLoggedIn && auth.consentGate === 'consent');

	async function agree() {
		loading = true;
		error = '';
		try {
			await auth.agreeConsent();
		} catch (err) {
			// A PB ClientResponseError always has a truthy English `.message`, so the
			// old `?? $_('consent.errFailed')` fallback was dead and leaked raw English.
			// Map by status to a localized message instead (network vs request vs server).
			const m = serverErrorMessage(err);
			const status = (err as { status?: number })?.status;
			error = resolveErrorMessage(m, $_, status != null ? { status } : undefined);
		} finally {
			loading = false;
		}
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-[80] flex items-center justify-center bg-bg-0/85 px-4 backdrop-blur-sm"
	>
		<div
			use:focusTrap
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="consent-title"
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full bg-primary-tint text-primary"
				>
					<ShieldCheck size={20} />
				</div>
				<div>
					<h3 id="consent-title" class="text-lg font-bold text-fg-0">{$_('legal.termsTitle')}</h3>
					<p class="text-xs text-fg-2">{$_('consent.subtitle')}</p>
				</div>
			</div>

			<div
				class="max-h-[300px] overflow-y-auto rounded-lg border border-border bg-bg-2 p-4 text-sm"
			>
				<div class="mb-3 flex items-center gap-2">
					<FileText size={14} class="text-fg-2" />
					<span class="text-xs tracking-wide text-fg-2 uppercase"
						>{$_('consent.latestVersion')}</span
					>
				</div>
				<!-- Legal body follows the UI locale — see /terms + /privacy. -->
				<div class="legal-prose prose text-sm">
					<p>{$_('consent.body')}</p>
					<p class="mt-3 text-xs text-fg-2">{$_('consent.confirmIntro')}</p>
					<ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-fg-1">
						<li>{$_('consent.confirm1')}</li>
						<li>{$_('consent.confirm2')}</li>
						<li>{$_('consent.confirm3')}</li>
						<li>{$_('consent.confirm4')}</li>
					</ul>
					<p class="mt-3 text-xs text-fg-2">
						{$_('consent.fullTermsPre')}<a
							href={resolve('/(public)/terms')}
							class="text-primary hover:underline">becertain.ai/terms</a
						>{$_('consent.fullTermsPost')}
					</p>
				</div>
			</div>

			{#if error}
				<div
					class="mt-3 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
					role="alert"
				>
					{error}
				</div>
			{/if}

			<div class="mt-5 flex items-center justify-end gap-2">
				<button
					class="px-4 py-2 text-sm text-fg-2 transition hover:text-fg-0"
					onclick={async () => {
						// Await so the studies-store cache clears before the (app) layout's
						// reactive logout redirect (#73) navigates — matches the Sidebar
						// logout pattern.
						await auth.logout();
					}}>{$_('consent.decline')}</button
				>
				<button class="btn-primary" onclick={agree} disabled={loading}>
					{#if loading}<Loader2 size={14} class="animate-spin" />
						{$_('consent.recording')}{:else}{$_('consent.agree')}{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal {
		width: 100%;
		max-width: 36rem;
		border-radius: var(--radius-card);
		border: 1px solid var(--color-border);
		background: var(--color-bg-1);
		box-shadow: var(--shadow-pop);
		padding: 1.75rem;
	}
	.legal-prose {
		--tw-prose-body: var(--color-fg-1);
		--tw-prose-headings: var(--color-fg-0);
		--tw-prose-bold: var(--color-fg-0);
		--tw-prose-links: var(--color-primary);
	}
	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.55rem 1.1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
</style>
