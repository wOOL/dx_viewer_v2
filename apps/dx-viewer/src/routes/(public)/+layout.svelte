<script lang="ts">
	// Login/auth background image (requested). Imported from $lib/assets so Vite content-
	// hashes the URL → Cloudflare busts its cache when the asset changes (the fixed-name
	// caching gotcha). A dark scrim over it keeps the form card legible on the busy artwork.
	import authBg from '$lib/assets/auth-bg.png';

	let { children } = $props();
</script>

<div class="relative flex min-h-screen items-center justify-center bg-bg-0 px-4 py-8">
	<div
		class="auth-bg pointer-events-none absolute inset-0 overflow-hidden bg-cover bg-center"
		style:background-image="url({authBg})"
	></div>
	<div class="auth-scrim pointer-events-none absolute inset-0"></div>
	<div class="relative w-full max-w-md">
		{@render children()}
	</div>
</div>

<style>
	/* A subtle darkening scrim so the white form card keeps strong contrast over the
	   navy + gold artwork (the image is already dark, so a light scrim is enough). */
	.auth-scrim {
		background: linear-gradient(
			to bottom,
			color-mix(in oklab, var(--color-bg-0) 35%, transparent),
			color-mix(in oklab, var(--color-bg-0) 55%, transparent)
		);
	}
</style>
