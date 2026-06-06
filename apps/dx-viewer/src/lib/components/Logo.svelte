<script lang="ts">
	// Imported (not /static) so Vite content-hashes the URL — a new logo always gets a
	// new filename, which busts the Cloudflare edge cache automatically (fixed-name
	// /logo.png would otherwise stay cached for hours after a redeploy).
	import logoUrl from '$lib/assets/logo.png';

	interface Props {
		size?: number;
		showText?: boolean;
		variant?: 'full' | 'mark';
	}
	let { size = 32, showText = true, variant = 'full' }: Props = $props();
</script>

<div class="logo flex items-center gap-2.5" style:--s="{size}px">
	<!-- Official BeCertain mark (tooth + aim reticle), trimmed + background keyed out to
	     full transparency. It's a glow-on-dark X-ray design: on the dark sidebar the
	     transparent mark matches the original (the art's navy background == the sidebar
	     bg), and on the light theme the transparent background simply shows the tooth +
	     aim. No chip/backdrop — the background is genuinely removed. -->
	<img src={logoUrl} alt="" class="logo-mark" aria-hidden="true" />
	{#if showText && variant === 'full'}
		<div class="flex flex-col leading-none">
			<span class="logo-name">BeCertain</span>
			<span class="logo-product">Dx Viewer</span>
		</div>
	{/if}
</div>

<style>
	.logo-mark {
		width: var(--s);
		height: var(--s);
		flex: none;
		object-fit: contain;
		box-sizing: border-box;
	}
	.logo-name {
		font-weight: 800;
		font-size: 1rem;
		letter-spacing: -0.02em;
		color: var(--color-fg-0);
	}
	.logo-product {
		font-weight: 600;
		font-size: 0.66rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--color-primary);
		margin-top: 3px;
	}
</style>
