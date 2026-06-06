import { describe, it, expect, beforeEach, vi } from 'vitest';
import { consentGate, crossTabAuthAction } from './auth.svelte';

// A2 — consent gate must FAIL CLOSED. A failed /api/consent/check must NOT leave
// the store in a state the modal/layout treat as "allowed through". We test the
// pure `consentGate` predicate directly AND drive `auth.checkConsent()` with a
// mocked endpoint that throws. PB is mocked so the auth singleton constructs with
// no network (same approach as auth.subscription.test.ts); `apiJson` is the seam
// we flip per-test between success and failure.

// Define the apiJson mock INSIDE the factory (vi.mock is hoisted, so it can't
// close over an outer binding), then import the mocked `apiJson` below and drive
// it per-test — the same pattern as studies.findorcreate.test.ts.
vi.mock('../pb', () => {
	const pb = {
		autoCancellation() {},
		authStore: { record: { id: 'u1' }, isValid: true, token: 't', onChange() {} },
		collection: () => ({ authRefresh: vi.fn(async () => ({})) })
	};
	return { pb, apiJson: vi.fn(), apiFetch: vi.fn(), ApiError: class extends Error {} };
});

import { auth } from './auth.svelte';
import { apiJson } from '../pb';
import type { Mock } from 'vitest';

const apiJsonMock = apiJson as Mock;

describe('consentGate (A2 pure predicate — fail CLOSED)', () => {
	it('is "pending" before any check completes (no modal flash)', () => {
		expect(consentGate({ consentChecked: false, consentError: false, consentOk: null })).toBe(
			'pending'
		);
		// even if a stale consentOk is somehow present, an unchecked gate stays pending
		expect(consentGate({ consentChecked: false, consentError: false, consentOk: true })).toBe(
			'pending'
		);
	});

	it('is "allow" ONLY for a confirmed true', () => {
		expect(consentGate({ consentChecked: true, consentError: false, consentOk: true })).toBe(
			'allow'
		);
	});

	it('is "consent" for a confirmed false (modal should show)', () => {
		expect(consentGate({ consentChecked: true, consentError: false, consentOk: false })).toBe(
			'consent'
		);
	});

	it('is "error" when the check errored — NOT allow, NOT a silent pass-through', () => {
		const g = consentGate({ consentChecked: true, consentError: true, consentOk: null });
		expect(g).toBe('error');
		expect(g).not.toBe('allow');
	});

	it('a null consentOk that has been "checked" without error blocks as "consent" (never allow)', () => {
		// Defensive: even if consentError were somehow false, a non-true result must block.
		expect(consentGate({ consentChecked: true, consentError: false, consentOk: null })).toBe(
			'consent'
		);
	});
});

describe('auth.checkConsent wiring (A2 fail-closed end to end)', () => {
	beforeEach(() => {
		apiJsonMock.mockReset();
		auth.user = { id: 'u1', email: 'a@b.co' } as never;
		auth.consentOk = null;
		auth.consentChecked = false;
		auth.consentError = false;
	});

	it('a THROWING consent check leaves the gate at "error" (blocked), never "allow"', async () => {
		apiJsonMock.mockRejectedValueOnce(new Error('500 / offline / timeout'));
		await auth.checkConsent();
		expect(auth.consentChecked).toBe(true);
		expect(auth.consentError).toBe(true);
		expect(auth.consentOk).toBeNull();
		// The gating predicate the layout consumes must NOT permit access.
		expect(auth.consentGate).toBe('error');
		expect(auth.consentGate).not.toBe('allow');
	});

	it('a check returning true unblocks to "allow"', async () => {
		apiJsonMock.mockResolvedValueOnce(true);
		await auth.checkConsent();
		expect(auth.consentGate).toBe('allow');
		expect(auth.consentError).toBe(false);
	});

	it('a check returning false shows the consent modal ("consent")', async () => {
		apiJsonMock.mockResolvedValueOnce(false);
		await auth.checkConsent();
		expect(auth.consentGate).toBe('consent');
	});

	it('a successful RETRY after an error clears the blocking state', async () => {
		apiJsonMock.mockRejectedValueOnce(new Error('transient'));
		await auth.checkConsent();
		expect(auth.consentGate).toBe('error');
		apiJsonMock.mockResolvedValueOnce(true);
		await auth.checkConsent(); // retry
		expect(auth.consentGate).toBe('allow');
	});

	it('agreeConsent confirms consent and resolves the gate to allow', async () => {
		apiJsonMock.mockRejectedValueOnce(new Error('check failed first'));
		await auth.checkConsent();
		expect(auth.consentGate).toBe('error');
		apiJsonMock.mockResolvedValueOnce(undefined); // /api/consent/agree
		await auth.agreeConsent();
		expect(auth.consentOk).toBe(true);
		expect(auth.consentGate).toBe('allow');
	});
});

describe('crossTabAuthAction (A4 pure decision)', () => {
	it('does nothing when the user id is unchanged', () => {
		expect(crossTabAuthAction('u1', 'u1')).toBe('none');
		expect(crossTabAuthAction(null, null)).toBe('none');
	});

	it('logs out when storage cleared the session in another tab', () => {
		expect(crossTabAuthAction('u1', null)).toBe('logout');
	});

	it('reloads when another tab switched to a DIFFERENT user', () => {
		expect(crossTabAuthAction('u1', 'u2')).toBe('reload');
	});

	it('reloads when a logged-out tab observes a login in another tab', () => {
		expect(crossTabAuthAction(null, 'u2')).toBe('reload');
	});
});
