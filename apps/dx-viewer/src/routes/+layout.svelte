<script lang="ts">
	import './layout.css';
	import '$lib/i18n';
	// Imported so Vite content-hashes the URL → the favicon busts the Cloudflare edge
	// cache automatically on every redeploy (a fixed-name /favicon.png stays CF-cached).
	import faviconUrl from '$lib/assets/favicon.png';
	import { auth } from '$lib/stores/auth.svelte';
	import { page, updated } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { safeNextPath } from '$lib/url';
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';

	let { children } = $props();

	// `updated.current` flips true when version polling (svelte.config.js
	// kit.version.pollInterval) detects a newer deploy than the build this tab is
	// running. Prompt rather than auto-reload so we never interrupt an in-progress
	// upload/review; dismissible per detection.
	let updateDismissed = $state(false);

	const publicPaths = ['/login', '/signup', '/forgot-password', '/otp', '/terms', '/privacy'];
	// A4: auth-entry pages a logged-in user has no business sitting on. Now includes
	// /forgot-password (was only /login + /signup), so an authed user is bounced off
	// it too. Kept loop-safe: every target below is OUTSIDE this set.
	const authEntryPaths = ['/login', '/signup', '/forgot-password'];

	function isPublic(p: string) {
		return publicPaths.some((pub) => p === pub || p.startsWith(pub + '/'));
	}

	function isAuthEntry(p: string) {
		return authEntryPaths.some((pub) => p === pub || p.startsWith(pub + '/'));
	}

	// Once-per-load side effects for an already-authenticated session.
	onMount(async () => {
		if (auth.isLoggedIn) {
			await auth.refreshSubscription();
			await auth.checkConsent();
		}
	});

	// A4: the redirect guard runs reactively — it reads `auth.isLoggedIn` and
	// `page.url.pathname`, so it re-evaluates on client-side SPA navigation between
	// the (public) auth pages (which share this layout) and when auth state flips,
	// not just on first mount.
	$effect(() => {
		const path = page.url.pathname;
		if (!auth.isLoggedIn && !isPublic(path)) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- next= param is runtime-dynamic; base path is resolved
			goto(`${resolve('/(public)/login')}?next=${encodeURIComponent(path)}`, {
				replaceState: true
			});
		} else if (auth.isLoggedIn && isAuthEntry(path)) {
			// Already signed in → send to the app, honoring any ?next (open-redirect-safe
			// via safeNextPath). A `next` that itself points at an auth-entry page (e.g.
			// ?next=/login) would loop, so fall back to /studies in that case too.
			const fallback = resolve('/(app)/studies');
			const candidate = safeNextPath(page.url.searchParams.get('next'), fallback, page.url.origin);
			const dest = isAuthEntry(candidate.split(/[?#]/, 1)[0] ?? candidate) ? fallback : candidate;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- dest is sanitized to a same-origin path (safeNextPath) and guarded off auth-entry pages; fallback is resolved
			goto(dest, { replaceState: true });
		}
	});
</script>

<svelte:head>
	<link rel="icon" type="image/png" href={faviconUrl} />
	<link rel="apple-touch-icon" href={faviconUrl} />
</svelte:head>
{@render children()}

{#if updated.current && !updateDismissed}
	<div
		class="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated,var(--color-canvas))] py-2.5 pr-3 pl-4 text-sm shadow-lg"
		role="status"
		aria-live="polite"
	>
		<span>{$_('app.updateAvailable')}</span>
		<button
			type="button"
			class="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 font-semibold text-[var(--color-on-accent)] transition-opacity hover:opacity-90"
			onclick={() => location.reload()}
		>
			{$_('app.updateReload')}
		</button>
		<button
			type="button"
			class="flex h-6 w-6 items-center justify-center rounded-full text-lg leading-none opacity-60 transition-opacity hover:opacity-100"
			aria-label={$_('app.updateDismiss')}
			onclick={() => (updateDismissed = true)}
		>
			×
		</button>
	</div>
{/if}
