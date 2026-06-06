import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	apiFetch,
	ApiError,
	setUnauthorizedHandler,
	handleUnauthorized,
	isPublicPath,
	expiredSessionLoginUrl,
	loginNextQuery
} from './pb';

// A3 — apiFetch must (a) invoke the registered 401 handler on a 401 so the app can
// clear the session + redirect, and (b) leave non-401 behaviour (throw ApiError,
// no handler call) exactly as before. We exercise the REAL pb.ts (not mocked) and
// stub global.fetch to return crafted responses.

const ORIGIN = 'https://dx.becertain.ai';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

describe('apiFetch 401 handling (A3)', () => {
	beforeEach(() => {
		setUnauthorizedHandler(null);
	});
	afterEach(() => {
		setUnauthorizedHandler(null);
		vi.restoreAllMocks();
	});

	it('calls the registered unauthorized handler on a 401 and still throws ApiError', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(401, { message: 'token expired' }))
		);

		await expect(apiFetch('/api/anything')).rejects.toBeInstanceOf(ApiError);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('does NOT call the handler on a 500 (behaviour unchanged) and throws ApiError', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(500, { message: 'boom' }))
		);

		const err = await apiFetch('/api/anything').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(500);
		expect(handler).not.toHaveBeenCalled();
	});

	it('does NOT call the handler on a 403 (only 401 is the expired-session signal)', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(403, { message: 'forbidden' }))
		);
		await expect(apiFetch('/api/anything')).rejects.toBeInstanceOf(ApiError);
		expect(handler).not.toHaveBeenCalled();
	});

	it('a 2xx response neither throws nor calls the handler', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(200, { ok: true }))
		);
		const res = await apiFetch('/api/ok');
		expect(res.status).toBe(200);
		expect(handler).not.toHaveBeenCalled();
	});

	it('handleUnauthorized swallows a faulty handler (must not mask the ApiError)', () => {
		setUnauthorizedHandler(() => {
			throw new Error('handler blew up');
		});
		expect(() => handleUnauthorized()).not.toThrow();
	});

	it('handleUnauthorized is a no-op when no handler is registered', () => {
		setUnauthorizedHandler(null);
		expect(() => handleUnauthorized()).not.toThrow();
	});
});

describe('expiredSessionLoginUrl / isPublicPath (A3 redirect target)', () => {
	it('flags public/auth routes', () => {
		expect(isPublicPath('/login')).toBe(true);
		expect(isPublicPath('/signup')).toBe(true);
		expect(isPublicPath('/forgot-password')).toBe(true);
		expect(isPublicPath('/otp/123')).toBe(true);
		expect(isPublicPath('/terms')).toBe(true);
		expect(isPublicPath('/privacy')).toBe(true);
		expect(isPublicPath('/reset-password/abc')).toBe(true);
	});

	it('flags app routes as non-public', () => {
		expect(isPublicPath('/studies')).toBe(false);
		expect(isPublicPath('/patients/abc')).toBe(false);
		expect(isPublicPath('/')).toBe(false);
		// A non-public path that merely CONTAINS a public token must stay non-public.
		expect(isPublicPath('/loginhelp')).toBe(false);
	});

	it('builds a login URL with an encoded next= for a deep app path', () => {
		const url = expiredSessionLoginUrl('/patients/abc?tab=photos', ORIGIN);
		expect(url).not.toBeNull();
		const u = new URL(url!, ORIGIN);
		expect(u.pathname).toBe('/login');
		expect(u.searchParams.get('reason')).toBe('expired');
		expect(u.searchParams.get('next')).toBe('/patients/abc?tab=photos');
	});

	it('omits next= for the app root but still tags reason=expired', () => {
		const url = expiredSessionLoginUrl('/', ORIGIN);
		const u = new URL(url!, ORIGIN);
		expect(u.searchParams.get('reason')).toBe('expired');
		expect(u.searchParams.has('next')).toBe(false);
	});

	it('returns null on a public route (no redirect → no loop)', () => {
		expect(expiredSessionLoginUrl('/login', ORIGIN)).toBeNull();
		expect(expiredSessionLoginUrl('/login?next=/studies', ORIGIN)).toBeNull();
	});

	it('sanitizes an off-origin next via safeNextPath (no open redirect)', () => {
		// A crafted current "path" that resolves off-origin must not survive into next=.
		const url = expiredSessionLoginUrl('//evil.com/steal', ORIGIN);
		const u = new URL(url!, ORIGIN);
		// safeNextPath collapses the off-origin value to the fallback '/', so next= is dropped.
		expect(u.searchParams.has('next')).toBe(false);
	});
});

describe('loginNextQuery (A8 — unauthenticated deep-link redirect keeps ?next)', () => {
	it('encodes the current path into a next= query the login page can consume', () => {
		expect(loginNextQuery('/patients/abc')).toBe('next=%2Fpatients%2Fabc');
	});

	it('round-trips through URL parsing back to the original path', () => {
		const path = '/viewer/p1/s1?tab=photos';
		const q = loginNextQuery(path);
		const u = new URL(`${ORIGIN}/login?${q}`);
		expect(u.searchParams.get('next')).toBe(path);
	});

	it('encodes query/hash characters so they are not lost', () => {
		// '?' and '#' in the original path must be percent-encoded inside next=.
		const q = loginNextQuery('/a?x=1#frag');
		expect(q).toBe('next=%2Fa%3Fx%3D1%23frag');
		const u = new URL(`${ORIGIN}/login?${q}`);
		expect(u.searchParams.get('next')).toBe('/a?x=1#frag');
	});
});
