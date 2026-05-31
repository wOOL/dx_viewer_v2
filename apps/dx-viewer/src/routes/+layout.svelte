<script lang="ts">
	import { page } from '$app/state';
	import Sidebar from '$components/layout/Sidebar.svelte';
	import { auth } from '$lib/auth.svelte';
	import { languageTag, onSetLanguageTag } from '$lib/paraglide/runtime';
	import { preferences } from '$lib/preferences.svelte';
	import { logger } from '@be-certain/core/logger';
	import { onMount } from 'svelte';
	import './layout.css';

	if (import.meta.env.VITE_DEBUG === 'true') logger.enable('debug');
	preferences.hydrate();

	let { children } = $props();
	let isMobile = $state(false);

	// Paraglide's `languageTag()` is a plain JS getter, not reactive. Calling
	// `setLanguageTag(...)` mutates a module variable but Svelte has no way to
	// know — so already-mounted `m.foo()` calls never re-evaluate. Bridge it:
	// bump a Svelte $state whenever the tag changes, then wrap the route tree
	// in `{#key langKey}` so the whole content slot remounts and every message
	// function re-runs in the new locale.
	let langKey = $state<string>(languageTag());
	onSetLanguageTag((tag: string) => (langKey = tag));

	// Routes that own their entire viewport — no surrounding padding, no route-level
	// scroll. Wheel events on a slice canvas must reach VTK's interactor instead of
	// scrolling the page.
	const isFullBleed = $derived(page.url.pathname.startsWith('/viewer'));

	onMount(() => {
		const mq = window.matchMedia('(max-width: 768px)');
		const update = () => (isMobile = mq.matches);
		update();
		mq.addEventListener('change', update);
		return () => mq.removeEventListener('change', update);
	});
</script>

{#key langKey}
	{#if auth.isAuthenticated}
		<div class="shell" class:is-mobile={isMobile}>
			<Sidebar {isMobile} />
			<main class="content" class:full-bleed={isFullBleed}>
				{@render children()}
			</main>
		</div>
	{:else}
		<!-- Unauthenticated routes ((auth)/+layout.svelte) own their own full-bleed chrome. -->
		{@render children()}
	{/if}
{/key}

<style>
	.shell {
		display: flex;
		height: 100vh;
		background-color: var(--bg);
		overflow: hidden;
	}
	.shell.is-mobile {
		flex-direction: column;
		height: auto;
		min-height: 100dvh;
		overflow: visible;
	}
	.content {
		flex: 1;
		min-width: 0;
		padding: 32px;
		overflow-y: auto;
	}
	.shell.is-mobile .content {
		padding: 20px 16px 48px;
		overflow-y: visible;
	}
	/* Full-bleed routes (the 3D viewer) take the whole content slot and manage
	 * their own scroll. Critical for wheel events on slice canvases to reach
	 * VTK's interactor instead of scrolling the page. */
	.content.full-bleed {
		padding: 0;
		overflow: hidden;
	}
	.shell.is-mobile .content.full-bleed {
		padding: 0;
		overflow: hidden;
	}
</style>
