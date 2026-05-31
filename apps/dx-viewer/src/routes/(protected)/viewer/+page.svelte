<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Viewer2D from '$components/viewer-2d/Viewer2D.svelte';
	import Viewer3D from '$components/viewer-3d/Viewer3D.svelte';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import { PaywallGuard } from '@be-certain/ui';
	import { subscription } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';

	const mode = $derived(page.url.searchParams.get('mode') ?? '3d');
</script>

<PaywallGuard service={subscription}>
	{#if mode === '2d'}
		<Viewer2D />
	{:else}
		<Viewer3D />
	{/if}

	<!-- Without this fallback the guard renders its default text-only prompt, which
	     tells a paywalled user to subscribe but gives them no way to — a dead-end.
	     PaywallGuard is in the framework-pure @be-certain/ui package and can't link
	     to /billing itself, so the routing-aware CTA is injected here. -->
	{#snippet fallback({ kind }: { kind: 'inactive' | 'expired' | 'none'; cancelAtPeriodEnd: boolean })}
		<div class="paywall">
			<h2 class="paywall-title">
				{#if kind === 'expired'}
					{m.paywall_expired()}
				{:else if kind === 'inactive'}
					{m.paywall_inactive()}
				{:else}
					{m.paywall_no_subscription()}
				{/if}
			</h2>
			<p class="paywall-body">{m.paywall_upgrade_cta()}</p>
			<BezelButton onclick={() => goto('/billing')}>{m.dx_account_view_plans()}</BezelButton>
		</div>
	{/snippet}
</PaywallGuard>

<style>
	.paywall {
		max-width: 28rem;
		margin: 3rem auto;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		text-align: center;
	}
	.paywall-title {
		margin: 0;
		font-size: var(--text-section-title, 1.25rem);
		font-weight: 600;
		color: var(--fg);
	}
	.paywall-body {
		margin: 0 0 8px;
		font-size: var(--text-body, 0.95rem);
		color: var(--muted-fg);
		line-height: 1.55;
	}
</style>
