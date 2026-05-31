import PocketBase from 'pocketbase';
import { AsyncHandler } from '../async/handler.svelte.js';
import { logger } from '../logger/index.js';
import type { StripePlan, Subscription, SubscriptionStatus } from '../types/index.js';

const log = logger.scoped('subscription');

/**
 * Grace period applied on top of `currentPeriodEnd` (PB_Backend.md §3:
 * "currentPeriodEnd + 24h grace > now"). Keep in sync with the backend rule.
 */
export const SUBSCRIPTION_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * How often `isActive` re-evaluates against the wall clock. Without this,
 * an expiring subscription wouldn't flip the UI until something else
 * mutated the row.
 */
const ACTIVE_TICK_MS = 60_000;

export type SubscriptionStage = 'unknown' | 'loaded' | 'none' | 'error';

/**
 * Reactive wrapper around `GET /api/collections/subscriptions/records`.
 *
 *   const sub = new SubscriptionService(pb);
 *   await sub.load();
 *   if (sub.isActive) … else … (paywall)
 *
 * `listRule` ensures the listing returns at most one row (the caller's own).
 * `realtimeSubscribe()` keeps the local state in sync with webhook-driven
 * changes; `reset()` clears state on sign-out so the next user doesn't
 * briefly see the previous user's subscription.
 */
export class SubscriptionService {
	private pb: PocketBase;
	private unsubscribeFn: (() => void) | null = null;
	private tickHandle: ReturnType<typeof setInterval> | null = null;
	/** Bumped every `ACTIVE_TICK_MS`; nudges $derived consumers of `isActive`. */
	private nowTick = $state(0);

	stage = $state<SubscriptionStage>('unknown');
	row = $state<Subscription | null>(null);
	plans = $state<StripePlan[]>([]);
	loadHandler = new AsyncHandler<Subscription | null>();
	cancelHandler = new AsyncHandler<{ status: string }>();
	checkoutHandler = new AsyncHandler<{ url: string; sessionId: string }>();
	plansHandler = new AsyncHandler<StripePlan[]>();

	constructor(pb: PocketBase) {
		this.pb = pb;
	}

	/** Fetch the user's subscription row. Safe to call repeatedly. */
	async load(): Promise<Subscription | null> {
		const result = await this.loadHandler.run(async () => {
			const list = await this.pb.collection('subscriptions').getList<Subscription>(1, 1);
			return list.items[0] ?? null;
		});
		if (this.loadHandler.isError) {
			this.row = null;
			this.stage = 'error';
			log.warn('Subscription load failed', { error: this.loadHandler.error });
			return null;
		}
		this.row = result ?? null;
		this.stage = result ? 'loaded' : 'none';
		this.ensureTick();
		log.info('Subscription loaded', { status: result?.status ?? 'none' });
		return this.row;
	}

	/**
	 * Subscribe to realtime updates. Pairs the `customer.subscription.*`
	 * Stripe webhook → PB-realtime push with our local state. Idempotent —
	 * safe to call multiple times; the previous subscription is cancelled.
	 */
	async realtimeSubscribe(): Promise<() => void> {
		const userId = this.pb.authStore.record?.id;
		if (!userId) {
			log.warn('Cannot subscribe to realtime — no auth');
			return () => {};
		}
		this.unsubscribeFn?.();
		const unsub = await this.pb.collection('subscriptions').subscribe<Subscription>('*', (e) => {
			if (e.record.user !== userId) return;
			log.debug('Subscription realtime event', { action: e.action });
			if (e.action === 'delete') {
				this.row = null;
				this.stage = 'none';
			} else {
				this.row = e.record;
				this.stage = 'loaded';
			}
		});
		this.unsubscribeFn = unsub;
		return unsub;
	}

	/**
	 * `/api/stripe/cancel-subscription` — schedules cancellation at period
	 * end. The local row's `cancelAtPeriodEnd` will flip true once the
	 * realtime push (or next load()) lands.
	 */
	async cancel(): Promise<boolean> {
		const result = await this.cancelHandler.run(async () => {
			return await this.pb.send<{ status: string }>('/api/stripe/cancel-subscription', { method: 'POST' });
		});
		if (result?.status === 'canceled' && this.row) {
			// Optimistically reflect the cancellation; realtime push will confirm.
			this.row = { ...this.row, cancelAtPeriodEnd: true };
		}
		return result?.status === 'canceled';
	}

	/**
	 * `GET /api/stripe/plans` — returns the available recurring price list.
	 * Public endpoint; safe to call before sign-in.
	 */
	async loadPlans(): Promise<StripePlan[]> {
		const result = await this.plansHandler.run(async () => {
			const res = await this.pb.send<{ plans: StripePlan[] }>('/api/stripe/plans', { method: 'GET' });
			return res.plans ?? [];
		});
		this.plans = result ?? [];
		return this.plans;
	}

	/**
	 * `/api/stripe/create-checkout-session` — returns the Stripe Checkout URL
	 * for starting (or upgrading) a subscription. Caller redirects.
	 */
	async startCheckout(priceId: string, returnUrl: string): Promise<string | null> {
		const result = await this.checkoutHandler.run(async () => {
			return await this.pb.send<{ url: string; sessionId: string }>('/api/stripe/create-checkout-session', {
				method: 'POST',
				body: { priceId, returnUrl }
			});
		});
		return result?.url ?? null;
	}

	/** Clear local state — call on sign-out so the next user doesn't see stale data. */
	reset(): void {
		this.unsubscribeFn?.();
		this.unsubscribeFn = null;
		this.stopTick();
		this.row = null;
		this.stage = 'unknown';
		this.loadHandler.reset();
	}

	dispose(): void {
		this.reset();
	}

	/** Mirrors the backend rule in PB_Backend.md §3. */
	get isActive(): boolean {
		// Read nowTick so Svelte re-evaluates this derived value when the timer fires.
		void this.nowTick;
		const row = this.row;
		if (!row) return false;
		if (row.status !== 'active' && row.status !== 'trialing') return false;
		if (!row.currentPeriodEnd) return true;
		const end = new Date(row.currentPeriodEnd).getTime();
		return end + SUBSCRIPTION_GRACE_MS > Date.now();
	}

	get statusKind(): 'active' | 'inactive' | 'expired' | 'none' {
		const row = this.row;
		if (!row) return 'none';
		const active = row.status === 'active' || row.status === 'trialing';
		if (!active) return 'inactive';
		if (this.isActive) return 'active';
		return 'expired';
	}

	get status(): SubscriptionStatus | null {
		return this.row?.status ?? null;
	}

	get cancelAtPeriodEnd(): boolean {
		return this.row?.cancelAtPeriodEnd === true;
	}

	private ensureTick(): void {
		if (this.tickHandle !== null) return;
		this.tickHandle = setInterval(() => {
			this.nowTick++;
		}, ACTIVE_TICK_MS);
	}

	private stopTick(): void {
		if (this.tickHandle === null) return;
		clearInterval(this.tickHandle);
		this.tickHandle = null;
	}
}
