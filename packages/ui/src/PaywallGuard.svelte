<script lang="ts">
	import type { SubscriptionService } from '@be-certain/core/subscription';
	import type { Snippet } from 'svelte';

	type Props = {
		service: SubscriptionService;
		children: Snippet;
		fallback?: Snippet<[{ kind: 'inactive' | 'expired' | 'none'; cancelAtPeriodEnd: boolean }]>;
		loading?: Snippet;
	};

	let { service, children, fallback, loading }: Props = $props();
</script>

{#if service.stage === 'unknown'}
	{#if loading}
		{@render loading()}
	{:else}
		<div class="paywall-loading" role="status" aria-live="polite">
			<div class="paywall-spinner"></div>
		</div>
	{/if}
{:else if service.isActive}
	{@render children()}
{:else if fallback}
	{@render fallback({ kind: service.statusKind as 'inactive' | 'expired' | 'none', cancelAtPeriodEnd: service.cancelAtPeriodEnd })}
{:else}
	<div class="paywall-prompt" role="alert">
		<h2>Subscription required</h2>
		<p>
			{#if service.statusKind === 'none'}
				You don't have an active subscription. Subscribe to use this feature.
			{:else if service.statusKind === 'expired'}
				Your subscription has expired. Renew to continue.
			{:else}
				Your subscription is inactive. Update your payment method to continue.
			{/if}
		</p>
	</div>
{/if}

<style>
	.paywall-loading {
		display: flex;
		justify-content: center;
		padding: 3rem 0;
	}
	.paywall-spinner {
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		border: 3px solid var(--border);
		border-top-color: var(--primary);
		animation: paywall-spin 0.8s linear infinite;
	}
	@keyframes paywall-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.paywall-prompt {
		max-width: 28rem;
		margin: 3rem auto;
		padding: 1.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		color: var(--card-fg);
		text-align: center;
	}
	.paywall-prompt h2 {
		font-size: var(--fs-h2);
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.paywall-prompt p {
		color: var(--muted-fg);
		font-size: var(--fs-body);
		line-height: var(--leading-body);
	}
</style>
