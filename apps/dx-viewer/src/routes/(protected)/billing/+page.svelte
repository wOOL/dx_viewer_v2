<script lang="ts">
	import { goto } from '$app/navigation';
	import BezelButton from '$components/ui/BezelButton.svelte';
	import { subscription } from '$lib/auth.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { StripePlan } from '@be-certain/core/types';
	import { onMount } from 'svelte';

	let checkoutError = $state<string | null>(null);
	let pendingPriceId = $state<string | null>(null);

	onMount(() => {
		if (subscription.plans.length === 0 && !subscription.plansHandler.isLoading) {
			subscription.loadPlans();
		}
		if (subscription.stage === 'unknown') subscription.load();
	});

	// ─── Group plans by productId so one product with multiple intervals renders
	//     as a single section with N rows. Sort intervals consistently:
	//     day → week → month → year so cards always read the same way.
	const intervalOrder: Record<string, number> = { day: 0, week: 1, month: 2, year: 3 };
	const groupedPlans = $derived.by(() => {
		const groups = new Map<string, { productId: string; productName: string; intervals: StripePlan[] }>();
		for (const plan of subscription.plans) {
			const existing = groups.get(plan.productId);
			if (existing) {
				existing.intervals.push(plan);
			} else {
				groups.set(plan.productId, {
					productId: plan.productId,
					productName: plan.productName,
					intervals: [plan]
				});
			}
		}
		for (const g of groups.values()) {
			g.intervals.sort((a, b) => (intervalOrder[a.interval] ?? 99) - (intervalOrder[b.interval] ?? 99));
		}
		return [...groups.values()];
	});

	function intervalLabel(p: StripePlan): string {
		if (p.intervalCount && p.intervalCount > 1) return `Every ${p.intervalCount} ${p.interval}s`;
		const labels: Record<string, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };
		return labels[p.interval] ?? p.interval;
	}

	function formatPrice(p: StripePlan): string {
		try {
			return new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: p.currency.toUpperCase(),
				maximumFractionDigits: p.unitAmount % 100 === 0 ? 0 : 2
			}).format(p.unitAmount / 100);
		} catch {
			return `${(p.unitAmount / 100).toFixed(2)} ${p.currency.toUpperCase()}`;
		}
	}

	/** Annualised-price savings for non-monthly intervals vs same product's monthly price. */
	function savingsPercent(intervals: StripePlan[], plan: StripePlan): number | null {
		if (plan.interval !== 'year') return null;
		const monthly = intervals.find((i) => i.interval === 'month' && i.currency === plan.currency);
		if (!monthly) return null;
		const periodsPerYear = 1 / (plan.intervalCount ?? 1);
		const annualisedMonthly = monthly.unitAmount * 12;
		const annualisedPlan = plan.unitAmount * periodsPerYear;
		if (annualisedMonthly <= annualisedPlan) return null;
		return Math.round(((annualisedMonthly - annualisedPlan) / annualisedMonthly) * 100);
	}

	async function startCheckout(p: StripePlan) {
		checkoutError = null;
		pendingPriceId = p.id;
		const returnUrl = `${location.origin}/account`;
		const url = await subscription.startCheckout(p.id, returnUrl);
		if (url) {
			location.href = url;
		} else {
			pendingPriceId = null;
			checkoutError = subscription.checkoutHandler.error ?? 'Could not start checkout';
		}
	}
</script>

<div class="page">
	<header class="page-head">
		<h1 class="text-display">{m.dx_billing_title()}</h1>
		<p class="text-body tone-muted">{m.dx_billing_tagline()}</p>
	</header>

	{#if subscription.isActive}
		<aside class="active-banner" role="status">
			<div>
				<span class="active-dot" aria-hidden="true"></span>
				<span>{m.dx_billing_active_banner()}</span>
			</div>
			<a href="/account">
				{m.dx_billing_manage_link()}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</a>
		</aside>
	{/if}

	{#if subscription.plansHandler.isLoading || (subscription.plans.length === 0 && !subscription.plansHandler.isError)}
		<div class="sections" aria-busy="true" aria-label={m.dx_billing_loading()}>
			{#each Array(2) as _}
				<section class="section skeleton-section">
					<div class="skel skel-title"></div>
					<div class="skel skel-row"></div>
					<div class="skel skel-row"></div>
				</section>
			{/each}
		</div>
	{:else if subscription.plansHandler.isError}
		<div class="toast critical" role="alert">
			<span>{subscription.plansHandler.error}</span>
			<button class="link" type="button" onclick={() => subscription.loadPlans()}>
				{m.dx_account_retry()}
			</button>
		</div>
	{:else if subscription.plans.length === 0}
		<div class="empty">
			<p class="text-body tone-muted">{m.dx_billing_no_plans()}</p>
		</div>
	{:else}
		<div class="sections">
			{#each groupedPlans as group, gi (group.productId)}
				<section class="section" style="--stagger: {gi * 60}ms">
					<header>
						<h2 class="text-section-title">{group.productName}</h2>
					</header>
					<dl class="rows">
						{#each group.intervals as plan (plan.id)}
							{@const saved = savingsPercent(group.intervals, plan)}
							<div class="row">
								<dt>
									<span class="interval-label">{intervalLabel(plan)}</span>
									{#if saved !== null && saved > 0}
										<span class="save-pill">{m.dx_billing_save({ percent: String(saved) })}</span>
									{/if}
								</dt>
								<dd>
									<span class="price text-mono-numeric">{formatPrice(plan)}</span>
									<BezelButton
										type="button"
										variant={plan.interval === 'year' ? 'primary' : 'secondary'}
										onclick={() => startCheckout(plan)}
										disabled={pendingPriceId !== null}
									>
										{pendingPriceId === plan.id ? m.dx_billing_redirecting() : m.dx_billing_subscribe()}
									</BezelButton>
								</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
		</div>
	{/if}

	{#if checkoutError}
		<div class="toast critical" role="alert">{checkoutError}</div>
	{/if}

	<button class="back-link" type="button" onclick={() => goto('/account')}>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<polyline points="15 18 9 12 15 6" />
		</svg>
		{m.dx_billing_back_to_account()}
	</button>
</div>

<style>
	.page {
		max-width: 720px;
		margin: 0 auto;
		padding: 8px 0 96px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		animation: rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	/* ─── Page head ─────────────────────────────────────────────────────────── */
	.page-head {
		padding: 16px 0 8px;
	}
	.page-head h1 {
		margin: 0 0 8px;
	}
	.page-head p {
		margin: 0;
		max-width: 60ch;
	}

	/* ─── Active subscription banner ────────────────────────────────────────── */
	.active-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 14px 18px;
		border: 1px solid rgba(93, 212, 201, 0.2);
		background-color: rgba(93, 212, 201, 0.05);
		border-radius: 10px;
		font-size: 14px;
		color: #b6e8e2;
	}
	.active-banner > div {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.active-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: #5dd4c9;
		box-shadow: 0 0 0 3px rgba(93, 212, 201, 0.2);
	}
	.active-banner a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #b6e8e2;
		text-decoration: none;
		font-weight: 500;
		transition: opacity 160ms;
	}
	.active-banner a:hover {
		opacity: 0.85;
	}
	.active-banner a:hover svg {
		transform: translateX(2px);
	}
	.active-banner svg {
		transition: transform 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	/* ─── Sections ──────────────────────────────────────────────────────────── */
	.sections {
		display: flex;
		flex-direction: column;
	}
	.section {
		padding: 36px 0 40px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 20px;
		animation: rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
		animation-delay: var(--stagger, 0ms);
	}
	.section:first-child {
		padding-top: 32px;
	}
	.section header h2 {
		margin: 0;
	}

	/* ─── Rows ──────────────────────────────────────────────────────────────── */
	.rows {
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 24px;
		padding: 18px 0;
		border-top: 1px solid rgba(240, 199, 100, 0.06);
		align-items: center;
	}
	.row:first-child {
		border-top: none;
		padding-top: 4px;
	}
	.row:last-child {
		padding-bottom: 4px;
	}

	dt {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		margin: 0;
	}
	.interval-label {
		font-size: 15px;
		color: var(--fg);
	}
	.save-pill {
		display: inline-flex;
		padding: 3px 8px;
		border-radius: 999px;
		background-color: rgba(93, 212, 201, 0.08);
		border: 1px solid rgba(93, 212, 201, 0.22);
		color: #b6e8e2;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: 500;
	}

	dd {
		display: flex;
		align-items: center;
		gap: 18px;
		margin: 0;
		justify-content: flex-end;
	}
	.price {
		font-size: 17px;
		color: var(--fg);
	}

	/* ─── Skeleton (matches layout shape) ───────────────────────────────────── */
	.skeleton-section {
		gap: 16px;
	}
	.skel {
		border-radius: 4px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.07) 50%, rgba(255, 255, 255, 0.03) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.6s linear infinite;
	}
	.skel-title {
		height: 22px;
		width: 30%;
	}
	.skel-row {
		height: 38px;
		width: 100%;
	}

	/* ─── Toasts & links ────────────────────────────────────────────────────── */
	.toast {
		font-size: 14px;
		padding: 12px 16px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		gap: 12px;
		justify-content: space-between;
	}
	.toast.critical {
		background-color: rgba(232, 75, 58, 0.08);
		border: 1px solid rgba(232, 75, 58, 0.2);
		color: #f8a59a;
	}
	.link {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.empty {
		padding: 32px 0;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		padding: 8px 0;
		background: none;
		border: none;
		color: var(--muted-fg);
		font-family: inherit;
		font-size: 14px;
		cursor: pointer;
		transition: color 160ms, transform 100ms;
	}
	.back-link:hover {
		color: var(--accent);
	}
	.back-link:active {
		transform: translateY(1px);
	}
	.back-link:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* ─── Animations ────────────────────────────────────────────────────────── */
	@keyframes rise {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes shimmer {
		0% { background-position: 100% 0; }
		100% { background-position: -100% 0; }
	}

	/* ─── Responsive ────────────────────────────────────────────────────────── */
	@media (max-width: 560px) {
		.page-head h1 {
			font-size: 26px;
		}
		.row {
			grid-template-columns: 1fr;
			gap: 12px;
		}
		dd {
			justify-content: space-between;
			width: 100%;
		}
		.active-banner {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}
	}
</style>
