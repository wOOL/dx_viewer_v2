<script lang="ts">
	import TopBar from '$lib/components/TopBar.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { apiJson } from '$lib/pb';
	import { _, locale } from 'svelte-i18n';
	import { Check, Loader2, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { planListState, serverErrorMessage, resolveErrorMessage } from '$lib/forms';
	import { formatDisplayDate } from '$lib/date';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	interface Plan {
		id: string;
		currency: string;
		unitAmount: number;
		interval: 'day' | 'week' | 'month' | 'year';
		intervalCount: number;
		productName: string | null;
		productId: string;
	}

	let plans = $state<Plan[]>([]);
	let loading = $state(true);
	let checkoutLoading = $state<string | null>(null);
	let cancelLoading = $state(false);
	let error = $state('');
	// A6: set when the post-checkout poll exhausts without the subscription
	// flipping active (slow webhook) — shows a "payment received, still
	// confirming" notice with a manual refresh instead of the unsubscribed view.
	let confirming = $state(false);
	let confirmRefreshing = $state(false);
	let onboarding = $derived(page.url.searchParams.has('onboarding'));
	let returnedSessionId = $derived(page.url.searchParams.get('session_id'));
	let canceledCheckout = $derived(page.url.searchParams.has('canceled'));

	// Track whether the component is still mounted — the post-checkout poll
	// (below) runs for up to ~20s. Without this, the user navigating away
	// mid-poll would get yanked back to /billing whenever the subscription
	// flipped active, interrupting whatever they moved on to.
	let mounted = true;
	onDestroy(() => {
		mounted = false;
	});

	// A failed server call previously set `error = (err as Error).message` — a raw,
	// untranslated PocketBase/fetch string. Route every billing failure through the
	// shared status→localized mapper so non-English users don't see English.
	function localizeError(err: unknown): string {
		const status = (err as { status?: number })?.status;
		return resolveErrorMessage(
			serverErrorMessage(err),
			$_,
			status != null ? { status } : undefined
		);
	}

	async function loadPlans() {
		loading = true;
		error = '';
		try {
			const res = await apiJson<{ plans: Plan[] }>('/api/stripe/plans');
			plans = res.plans.sort((a, b) => intervalRank(a) - intervalRank(b));
		} catch (err) {
			error = localizeError(err);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		await auth.refreshSubscription();
		await loadPlans();

		if (returnedSessionId) {
			// Poll for subscription update for ~20s after checkout
			for (let i = 0; i < 10; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				if (!mounted) return; // user navigated away — drop the poll
				await auth.refreshSubscription();
				if (!mounted) return;
				if (auth.hasActiveSubscription) {
					goto(resolve('/(app)/billing'), { replaceState: true });
					return;
				}
			}
			// A6: poll exhausted but the subscription is still not active — the
			// webhook is likely just slow. Don't fall through to the "No subscription"
			// view (a paid user would read it as a failed payment and pay again);
			// show a reassuring "still confirming" notice with a manual refresh.
			if (mounted && !auth.hasActiveSubscription) confirming = true;
		}
	});

	// A6: manual "I've waited — check again" action from the confirming notice.
	async function recheckConfirmation() {
		confirmRefreshing = true;
		try {
			await auth.refreshSubscription();
			if (!mounted) return;
			if (auth.hasActiveSubscription) {
				confirming = false;
				goto(resolve('/(app)/billing'), { replaceState: true });
			}
		} finally {
			if (mounted) confirmRefreshing = false;
		}
	}

	const planState = $derived(planListState({ loading, plans, error }));

	function intervalRank(p: Plan): number {
		const days =
			p.interval === 'day' ? 1 : p.interval === 'week' ? 7 : p.interval === 'month' ? 30 : 365;
		return days * p.intervalCount;
	}

	async function startCheckout(p: Plan) {
		checkoutLoading = p.id;
		error = '';
		try {
			const res = await apiJson<{ url: string }>('/api/stripe/create-checkout-session', {
				method: 'POST',
				body: JSON.stringify({ priceId: p.id, returnUrl: window.location.origin + '/billing' })
			});
			if (res.url) {
				window.location.href = res.url;
			} else {
				error = $_('billing.noCheckoutUrl');
			}
		} catch (err) {
			// Sibling of loadPlans/cancelSubscription: route through the localized
			// status→message mapper. Previously this lone path surfaced the raw
			// `e.body.error` (the backend's English `err.toString()`) / `e.message`
			// (a PB ClientResponseError always has a truthy English `.message`), so a
			// non-English user saw an untranslated technical string on a checkout failure.
			error = localizeError(err);
		} finally {
			checkoutLoading = null;
		}
	}

	async function cancelSubscription() {
		if (!confirm($_('billing.cancelConfirm'))) return;
		cancelLoading = true;
		error = '';
		try {
			await apiJson('/api/stripe/cancel-subscription', { method: 'POST' });
			await auth.refreshSubscription();
		} catch (err) {
			error = localizeError(err);
		} finally {
			cancelLoading = false;
		}
	}

	// Map raw Stripe sub.status to the localized label. Unknown statuses pass
	// through verbatim so a future Stripe value isn't silently swallowed.
	function statusLabel(status: string): string {
		const map: Record<string, string> = {
			active: 'billing.statusActive',
			trialing: 'billing.statusTrialing',
			past_due: 'billing.statusPastDue',
			canceled: 'billing.statusCanceled',
			incomplete: 'billing.statusIncomplete',
			incomplete_expired: 'billing.statusIncompleteExpired',
			unpaid: 'billing.statusUnpaid',
			paused: 'billing.statusPaused'
		};
		return map[status] ? $_(map[status]) : status;
	}

	function priceText(p: Plan): string {
		const amount = (p.unitAmount / 100).toLocaleString($locale ?? undefined, {
			style: 'currency',
			currency: p.currency.toUpperCase()
		});
		// Stripe returns the interval as raw English ('month'/'year'). The price
		// label sits next to the localized currency amount, so route the interval
		// through ICU plurals so a French user sees "199 £/mois", not "199 £/month".
		const intervalKey = `billing.interval_${p.interval}`;
		const interval = $_(intervalKey, { values: { count: p.intervalCount } });
		return `${amount}/${interval}`;
	}

	const sub = $derived(auth.subscription);
	const isActive = $derived(auth.hasActiveSubscription);
</script>

<TopBar title={$_('nav.billing')} showSearch={false} />

<main class="flex-1 overflow-y-auto px-8 py-7">
	<div class="mx-auto max-w-4xl">
		{#if onboarding}
			<div
				class="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-5 py-4 text-sm text-fg-1"
			>
				<strong class="text-primary">{$_('billing.welcome')}</strong>
				{$_('billing.welcomeBlurb')}
			</div>
		{/if}

		{#if canceledCheckout}
			<div
				class="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-5 py-3 text-sm text-warning"
			>
				{$_('billing.checkoutCanceled')}
			</div>
		{/if}

		{#if confirming && !isActive}
			<div class="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-5 py-4">
				<div class="flex items-start gap-3">
					<Loader2 size={20} class="mt-0.5 animate-spin text-primary" />
					<div>
						<div class="text-sm font-medium text-fg-0">{$_('billing.confirmingTitle')}</div>
						<p class="mt-1 text-sm text-fg-2">{$_('billing.confirmingDesc')}</p>
						<button
							class="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-60"
							onclick={recheckConfirmation}
							disabled={confirmRefreshing}
						>
							<RefreshCw size={14} class={confirmRefreshing ? 'animate-spin' : ''} />
							{confirmRefreshing
								? $_('billing.confirmingChecking')
								: $_('billing.confirmingRefresh')}
						</button>
					</div>
				</div>
			</div>
		{/if}

		<div class="mb-8">
			<h2 class="mb-1 text-xl font-bold text-fg-0">{$_('billing.heading')}</h2>
			<p class="text-sm text-fg-2">{$_('billing.subheading')}</p>
		</div>

		{#if loading}
			<div class="flex h-40 items-center justify-center">
				<Loader2 size={28} class="animate-spin text-fg-2" />
			</div>
		{:else if sub && isActive}
			<div class="mb-6 rounded-xl border border-border bg-bg-1 p-5 shadow-[var(--shadow-card)]">
				<div class="mb-3 flex items-center gap-2">
					<span class="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success"
						>{statusLabel(sub.status)}</span
					>
					{#if sub.cancelAtPeriodEnd}
						<span
							class="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning"
							>{$_('billing.endsAtPeriodEnd')}</span
						>
					{/if}
				</div>
				<div class="mb-1 text-lg font-semibold text-fg-0">{$_('billing.planActive')}</div>
				<div class="text-sm text-fg-2">
					{sub.cancelAtPeriodEnd ? $_('billing.endsOn') : $_('billing.renewsOn')}
					<span class="text-fg-1"
						>{formatDisplayDate(sub.currentPeriodEnd, $locale ?? undefined, {
							year: 'numeric',
							month: 'long',
							day: 'numeric'
						})}</span
					>
				</div>
				{#if !sub.cancelAtPeriodEnd}
					<button
						class="mt-4 text-sm text-danger hover:underline"
						onclick={cancelSubscription}
						disabled={cancelLoading}
					>
						{cancelLoading ? $_('billing.canceling') : $_('billing.cancel')}
					</button>
				{/if}
			</div>
		{:else if !confirming}
			<div class="mb-6 rounded-xl border border-warning/40 bg-bg-1 p-5">
				<div class="flex items-start gap-3">
					<AlertTriangle size={20} class="mt-0.5 text-warning" />
					<div>
						<div class="text-sm font-medium text-fg-0">{$_('billing.noSubTitle')}</div>
						<p class="mt-1 text-sm text-fg-2">{$_('billing.noSubDesc')}</p>
					</div>
				</div>
			</div>
		{/if}

		{#if !isActive && !confirming}
			{#if planState === 'empty'}
				<!-- A5: successful fetch but zero plans (all archived / Stripe
				     misconfig). Distinct from the network-error block below, with a
				     retry so an unsubscribed user isn't stranded on a dead-end paywall. -->
				<div class="mb-6 rounded-xl border border-border bg-bg-1 p-6 text-center">
					<AlertTriangle size={24} class="mx-auto mb-3 text-warning" />
					<div class="text-sm font-medium text-fg-0">{$_('billing.noPlansTitle')}</div>
					<p class="mx-auto mt-1 max-w-md text-sm text-fg-2">{$_('billing.noPlansDesc')}</p>
					<button
						class="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline disabled:opacity-60"
						onclick={loadPlans}
						disabled={loading}
					>
						<RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
						{$_('billing.retry')}
					</button>
				</div>
			{:else if planState === 'ready'}
				<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
					{#each plans as plan (plan.id)}
						<div
							class="flex flex-col rounded-xl border border-border bg-bg-1 p-5 shadow-[var(--shadow-card)] transition hover:border-primary"
						>
							<div class="text-xs tracking-wide text-fg-2 uppercase">
								{plan.productName ?? plan.interval}
							</div>
							<div class="my-4 text-3xl font-bold text-fg-0">{priceText(plan)}</div>
							<ul class="mb-6 flex-1 space-y-2 text-sm text-fg-1">
								<li class="flex gap-2">
									<Check size={14} class="mt-0.5 text-primary" />{$_('billing.featUnlimited')}
								</li>
								<li class="flex gap-2">
									<Check size={14} class="mt-0.5 text-primary" />{$_('billing.featXray')}
								</li>
								<li class="flex gap-2">
									<Check size={14} class="mt-0.5 text-primary" />{$_('billing.featCbctIos')}
								</li>
								<li class="flex gap-2">
									<Check size={14} class="mt-0.5 text-primary" />{$_('billing.featReports')}
								</li>
							</ul>
							<button
								class="btn-primary"
								onclick={() => startCheckout(plan)}
								disabled={checkoutLoading !== null}
							>
								{#if checkoutLoading === plan.id}
									<span class="spinner"></span> {$_('billing.redirecting')}
								{:else}
									{$_('billing.subscribe')} <ExternalLink size={14} class="ml-1 inline" />
								{/if}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		{#if error}
			<div
				class="mt-6 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger"
				role="alert"
			>
				{error}
			</div>
		{/if}

		<p class="mt-8 text-xs text-fg-2">
			{$_('billing.stripeNotePre')}
			<code class="text-fg-1">4242 4242 4242 4242</code>
			{$_('billing.stripeNotePost')}
		</p>
	</div>
</main>

<style>
	.btn-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 600;
		font-size: 0.875rem;
		padding: 0.6rem 1rem;
		border-radius: var(--radius-control);
		cursor: pointer;
		transition: background 0.15s;
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--color-primary-hover);
	}
	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
