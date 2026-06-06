<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import ConsentModal from '$lib/components/ConsentModal.svelte';
	import GlobalDropZone from '$lib/components/GlobalDropZone.svelte';
	import QuickAssignBanner from '$lib/components/QuickAssignBanner.svelte';
	import { auth, onLogout } from '$lib/stores/auth.svelte';
	import { setUnauthorizedHandler, expiredSessionLoginUrl, loginNextQuery } from '$lib/pb';
	import { studies } from '$lib/stores/studies.svelte';
	import { history } from '$lib/stores/history.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { _ } from 'svelte-i18n';
	import { onMount } from 'svelte';
	import { ShieldAlert, Loader2 } from 'lucide-svelte';

	let { children } = $props();
	let ready = $state(false);
	let retrying = $state(false);

	// Core's auth store can no longer import app stores (it moved to
	// @be-certain/core in the Phase B extraction), so the PHI-cache clearing that
	// logout must perform is registered here: studies' in-memory patient list and
	// the History dropdown's patient names. Mirrors the pre-extraction behaviour
	// (these two calls were hardcoded inside the old app-local auth store).
	onMount(() =>
		onLogout(() => {
			studies.clearCache();
			history.clear();
		})
	);

	onMount(async () => {
		// A3: when any authenticated call 401s (expired JWT / revoked user), clear the
		// session and bounce to login with ?next + a "session expired" notice — instead
		// of stranding the user on a dead shell. Registered here so pb.ts stays free of
		// app/navigation deps; unregistered on unmount.
		setUnauthorizedHandler(() => {
			const url = expiredSessionLoginUrl(page.url.pathname, page.url.origin);
			if (!url) return; // already on a public/auth route → don't loop
			void auth.logout().finally(() => {
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- expiredSessionLoginUrl returns a sanitized same-origin path (safeNextPath); base /login is static
				void goto(url, { replaceState: true });
			});
		});

		if (!auth.isLoggedIn) {
			// A8: preserve the bookmarked deep link so the user returns here after login
			// (the root layout already does this; the (app) layout previously dropped it).
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- next= is runtime-dynamic; base path is resolved
			await goto(`${resolve('/(public)/login')}?${loginNextQuery(page.url.pathname)}`, {
				replaceState: true
			});
			return;
		}
		await auth.refreshSubscription();
		await auth.checkConsent();
		ready = true;
	});

	onMount(() => {
		return () => setUnauthorizedHandler(null);
	});

	async function retryConsent() {
		retrying = true;
		try {
			await auth.checkConsent();
		} finally {
			retrying = false;
		}
	}

	// React to mid-session sign-out (e.g. the ConsentModal "Decline" button) — without
	// this the user stayed on the (app) shell after auth was cleared, looking at a frozen
	// UI with no content. Watches isLoggedIn (flips false the moment pb.authStore.clear()
	// fires) and redirects.
	$effect(() => {
		if (ready && !auth.isLoggedIn) {
			ready = false;
			goto(resolve('/(public)/login'), { replaceState: true });
		}
	});

	// A2: the app body renders ONLY when consent is a CONFIRMED 'allow'. 'consent'
	// shows the modal (over a neutral backdrop); 'error' shows a blocking retry state;
	// 'pending' (and pre-ready) shows the spinner. Never falls through to full access
	// without a recorded consent.
	const gate = $derived(auth.consentGate);
</script>

{#if ready && gate === 'allow'}
	<div class="flex h-screen overflow-hidden">
		<Sidebar />
		<div class="flex min-w-0 flex-1 flex-col">
			{@render children()}
		</div>
	</div>
	<ConsentModal />
	<GlobalDropZone />
	<QuickAssignBanner />
{:else if ready && gate === 'consent'}
	<!-- Consent required: render the modal over a neutral backdrop (no app chrome /
	     no PHI). The modal owns its own visibility via the same gate. -->
	<div class="h-screen bg-bg-0"></div>
	<ConsentModal />
{:else if ready && gate === 'error'}
	<!-- A2: consent check FAILED — block with a retry affordance rather than silently
	     granting access (fail closed). Do not permanently lock out a transient error. -->
	<div class="flex h-screen items-center justify-center px-4">
		<div class="max-w-sm text-center" role="alert">
			<div
				class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger"
			>
				<ShieldAlert size={24} />
			</div>
			<h1 class="text-lg font-bold text-fg-0">{$_('consent.verifyErrorTitle')}</h1>
			<p class="mt-2 text-sm text-fg-2">{$_('consent.verifyErrorDesc')}</p>
			<button class="btn-primary mt-5" onclick={retryConsent} disabled={retrying}>
				{#if retrying}<Loader2 size={14} class="animate-spin" />{/if}
				{$_('common.retry')}
			</button>
		</div>
	</div>
{:else}
	<div class="flex h-screen items-center justify-center">
		<span class="spinner text-3xl text-fg-2"></span>
	</div>
{/if}

<style>
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
	.btn-primary:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}
</style>
