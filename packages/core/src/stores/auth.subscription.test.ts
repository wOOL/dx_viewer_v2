import { describe, it, expect, beforeEach, vi } from 'vitest';

// hasActiveSubscription gates the whole paywall: active/trialing status AND the
// period-end (with a 24h grace) must hold. Untested logic where a wrong result
// either locks out a paying clinician or lets an expired one through. Mock PB so
// the auth singleton constructs without network/auth (as in auth.loading.test.ts).
const { getList } = vi.hoisted(() => ({ getList: vi.fn() }));
vi.mock('../pb', () => {
	const pb = {
		autoCancellation() {},
		authStore: { record: { id: 'u1' }, isValid: true, token: 't', onChange() {} },
		collection: () => ({ getList })
	};
	return { pb, apiJson: vi.fn(), apiFetch: vi.fn(), ApiError: class extends Error {} };
});

import { auth } from './auth.svelte';

const DAY = 24 * 60 * 60 * 1000;
function sub(status: string, endOffsetMs: number) {
	return { status, currentPeriodEnd: new Date(Date.now() + endOffsetMs).toISOString() } as never;
}

describe('auth.hasActiveSubscription', () => {
	beforeEach(() => {
		auth.subscription = null;
	});

	it('is false with no subscription', () => {
		expect(auth.hasActiveSubscription).toBe(false);
	});

	it('is false for a non-active/trialing status even with a future period end', () => {
		auth.subscription = sub('canceled', 5 * DAY);
		expect(auth.hasActiveSubscription).toBe(false);
		auth.subscription = sub('past_due', 5 * DAY);
		expect(auth.hasActiveSubscription).toBe(false);
	});

	it('is true for active/trialing with a future period end', () => {
		auth.subscription = sub('active', 5 * DAY);
		expect(auth.hasActiveSubscription).toBe(true);
		auth.subscription = sub('trialing', DAY);
		expect(auth.hasActiveSubscription).toBe(true);
	});

	it('honours the 24h grace just after the period end, but not beyond it', () => {
		auth.subscription = sub('active', -60 * 60 * 1000); // ended 1h ago → within grace
		expect(auth.hasActiveSubscription).toBe(true);
		auth.subscription = sub('active', -2 * DAY); // ended 2 days ago → past grace
		expect(auth.hasActiveSubscription).toBe(false);
	});

	it('does NOT lock out an active sub whose currentPeriodEnd is missing/unset', () => {
		// A checkout.session.completed event has no period end, so the webhook leaves it
		// unset until the next subscription event (it won't write a bogus date). During that
		// window the date is empty/null/invalid → new Date(...).getTime() is NaN. Pre-fix
		// `NaN + grace > now` was false, locking a just-paid clinician OUT. Trust the status.
		auth.subscription = { status: 'active', currentPeriodEnd: '' } as never;
		expect(auth.hasActiveSubscription).toBe(true);
		auth.subscription = { status: 'active', currentPeriodEnd: null } as never;
		expect(auth.hasActiveSubscription).toBe(true);
		auth.subscription = { status: 'trialing', currentPeriodEnd: undefined } as never;
		expect(auth.hasActiveSubscription).toBe(true);
		// ...but a missing date still can't rescue a non-active status.
		auth.subscription = { status: 'canceled', currentPeriodEnd: '' } as never;
		expect(auth.hasActiveSubscription).toBe(false);
	});
});

// refreshSubscription runs once on every (app)-shell mount with no retry UI of its own.
// It previously did `catch { this.subscription = null }`, so a transient PB blip
// (offline/500/timeout) silently downgraded a PAYING clinician to "unsubscribed" for the
// whole session (paywall + AI blocked). The fix: a SUCCESSFUL query is authoritative
// (empty → null), but a THROW keeps the last-known value.
describe('auth.refreshSubscription keeps a known-good sub across transient errors', () => {
	beforeEach(() => {
		auth.subscription = null;
		auth.user = { id: 'u1' } as never; // bypass the browser-gated syncFromPB
		getList.mockReset();
	});

	it('sets the subscription from a successful fetch', async () => {
		getList.mockResolvedValueOnce({ items: [sub('active', 5 * DAY)] });
		await auth.refreshSubscription();
		expect(auth.hasActiveSubscription).toBe(true);
	});

	it('KEEPS the cached subscription when the refresh THROWS (no lockout on a blip)', async () => {
		getList.mockResolvedValueOnce({ items: [sub('active', 5 * DAY)] });
		await auth.refreshSubscription();
		expect(auth.hasActiveSubscription).toBe(true);
		// A later transient failure must NOT null the cached sub.
		getList.mockRejectedValueOnce(new Error('500'));
		await auth.refreshSubscription();
		expect(auth.subscription).not.toBeNull();
		expect(auth.hasActiveSubscription).toBe(true);
	});

	it('clears the subscription on a SUCCESSFUL empty result (genuinely unsubscribed)', async () => {
		auth.subscription = sub('active', 5 * DAY);
		getList.mockResolvedValueOnce({ items: [] });
		await auth.refreshSubscription();
		expect(auth.subscription).toBeNull();
	});

	it('stays null when the first-ever fetch fails (no false grant from keep-on-error)', async () => {
		auth.subscription = null;
		getList.mockRejectedValueOnce(new Error('timeout'));
		await auth.refreshSubscription();
		expect(auth.subscription).toBeNull();
	});
});
