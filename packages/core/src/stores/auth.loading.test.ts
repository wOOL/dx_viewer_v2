import { describe, it, expect, vi } from 'vitest';

// #96 — requestOTP / requestPasswordReset must flip `auth.loading` like the other
// auth calls do, so the login "Send code" and forgot-password buttons (both
// disabled={auth.loading}) actually disable during the in-flight request and a
// double-click can't fire two OTP / reset emails. Mock the PB module so no
// network/auth is needed (same approach as studies.findorcreate.test.ts).
vi.mock('../pb', () => {
	const pb = {
		autoCancellation() {},
		authStore: { record: null, isValid: false, token: '', onChange() {} },
		collection: () => ({
			requestOTP: vi.fn(async () => ({ otpId: 'otp-1' })),
			requestPasswordReset: vi.fn(async () => undefined)
		})
	};
	return { pb, apiJson: vi.fn(), apiFetch: vi.fn(), ApiError: class extends Error {} };
});

import { auth } from './auth.svelte';

describe('auth request* loading flag (#96 double-submit guard)', () => {
	it('requestOTP sets loading during the call and clears it after', async () => {
		expect(auth.loading).toBe(false);
		const p = auth.requestOTP('a@b.co'); // not awaited yet
		expect(auth.loading).toBe(true); // set synchronously, before the await
		const otpId = await p;
		expect(otpId).toBe('otp-1');
		expect(auth.loading).toBe(false);
	});

	it('requestPasswordReset sets loading during the call and clears it after', async () => {
		const p = auth.requestPasswordReset('a@b.co');
		expect(auth.loading).toBe(true);
		await p;
		expect(auth.loading).toBe(false);
	});
});
