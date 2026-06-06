import { describe, it, expect } from 'vitest';
import { segLoadOutcome, shouldPaywall } from './segGate';

describe('segLoadOutcome', () => {
	it('ok for a 2xx response', () => {
		expect(segLoadOutcome({ ok: true, status: 200 })).toBe('ok');
	});

	it('absent for a 404 (file genuinely not present → show the Run-AI CTA)', () => {
		expect(segLoadOutcome({ ok: false, status: 404 })).toBe('absent');
	});

	it('error for a 403 — an expired file token must NOT look like "no segmentation"', () => {
		// The V5 bug: a 403 was swallowed and the empty Run-CTA shown, inviting the
		// user to silently re-run a billable job. It must surface as a retry banner.
		expect(segLoadOutcome({ ok: false, status: 403 })).toBe('error');
	});

	it('error for a 500 (server failure)', () => {
		expect(segLoadOutcome({ ok: false, status: 500 })).toBe('error');
	});

	it('error for a 401 (auth) — any non-ok, non-404 is a real failure', () => {
		expect(segLoadOutcome({ ok: false, status: 401 })).toBe('error');
	});
});

describe('shouldPaywall', () => {
	// Proactive guard (status omitted): gate the billable call on the local sub state.
	it('proactive: paywalls when there is no active subscription', () => {
		expect(shouldPaywall(false)).toBe(true);
	});

	it('proactive: does NOT paywall when the subscription is active', () => {
		expect(shouldPaywall(true)).toBe(false);
	});

	// Catch-side (status provided): the server is the source of truth.
	it('catch: paywalls on a backend 403 even if the client thought it was subscribed', () => {
		expect(shouldPaywall(true, 403)).toBe(true);
	});

	it('catch: paywalls on a backend 403 when unsubscribed too', () => {
		expect(shouldPaywall(false, 403)).toBe(true);
	});

	it('catch: a non-403 error is NOT a paywall (it surfaces as a normal error banner)', () => {
		expect(shouldPaywall(true, 500)).toBe(false);
		expect(shouldPaywall(false, 500)).toBe(false);
		expect(shouldPaywall(true, 0)).toBe(false);
	});
});
