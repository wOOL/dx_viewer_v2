<script lang="ts">
	import { page, updated } from '$app/state';
	import Sidebar from '$components/layout/Sidebar.svelte';
	import { auth } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';
	import { languageTag, onSetLanguageTag } from '$lib/paraglide/runtime';
	import { preferences } from '$lib/preferences.svelte';
	import { logger } from '@be-certain/core/logger';
	import { onMount } from 'svelte';
	import './layout.css';

	if (import.meta.env.VITE_DEBUG === 'true') logger.enable('debug');
	preferences.hydrate();

	let { children } = $props();
	let isMobile = $state(false);

	// `updated.current` flips true when version polling (see svelte.config.js)
	// detects a newer deploy than the build this tab is running. We prompt rather
	// than auto-reload: in-progress scans live only in memory, so a silent reload
	// would discard the clinician's current analysis.
	let updateDismissed = $state(false);

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

	{#if updated.current && !updateDismissed}
		<div class="update-toast" role="status" aria-live="polite">
			<span class="update-text">{m.dx_update_available()}</span>
			<button class="update-reload" type="button" onclick={() => location.reload()}>
				{m.dx_update_reload()}
			</button>
			<button
				class="update-dismiss"
				type="button"
				aria-label={m.dx_update_dismiss()}
				onclick={() => (updateDismissed = true)}
			>
				×
			</button>
		</div>
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

	/* "New version available" prompt — fixed, non-blocking, above all chrome. */
	.update-toast {
		position: fixed;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px 10px 16px;
		border-radius: 999px;
		background-color: var(--surface-2, #1a2c3e);
		border: 1px solid var(--border, rgba(240, 199, 100, 0.2));
		box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.6);
		font-size: 13px;
		color: var(--fg, #e8ecf0);
		animation: toastRise 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.update-reload {
		padding: 6px 14px;
		border-radius: 999px;
		border: none;
		background-color: var(--accent, #f0c764);
		color: var(--primary-fg, #0f1c26);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 150ms;
	}
	.update-reload:hover {
		opacity: 0.88;
	}
	.update-dismiss {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: none;
		background: transparent;
		color: var(--muted-fg, #9fb0c0);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		transition: color 150ms, background-color 150ms;
	}
	.update-dismiss:hover {
		color: var(--fg, #e8ecf0);
		background-color: rgba(255, 255, 255, 0.06);
	}
	@keyframes toastRise {
		from { opacity: 0; transform: translate(-50%, 8px); }
		to { opacity: 1; transform: translate(-50%, 0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.update-toast { animation: none; }
	}
</style>
