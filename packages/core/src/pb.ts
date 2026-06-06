import PocketBase, { type RecordModel } from 'pocketbase';

// Minimal typing for the bundler-injected env (avoids depending on vite/client
// types inside this package; every consumer is a Vite app, so the value exists).
declare global {
	interface ImportMetaEnv {
		readonly VITE_PB_URL?: string;
	}
}
import { browser } from './env';
import { get } from 'svelte/store';
import { _ } from 'svelte-i18n';
import { safeNextPath } from './url';

// Configurable for staging/local backends; falls back to prod so a plain
// `vite dev`/`vite build` without env vars behaves exactly as before.
const PB_URL = import.meta.env.VITE_PB_URL || 'https://pbapi.becertain.ai';

export const pb = new PocketBase(PB_URL);

// Disable the SDK's per-endpoint auto-cancellation. By default PB aborts an
// in-flight request when a second one hits the same collection/endpoint, which
// made overlapping loads (rapid navigation, or the 100s token-refresh loop
// coinciding with studies.refresh()) throw "request was aborted (autocancelled)"
// — surfacing as an empty studies list. We never rely on auto-cancel (search is
// client-side), so turn it off globally; concurrent reads simply both complete.
pb.autoCancellation(false);

if (browser) {
	pb.authStore.loadFromCookie(document.cookie);
	pb.authStore.onChange(() => {
		document.cookie = pb.authStore.exportToCookie({
			httpOnly: false,
			secure: location.protocol === 'https:',
			sameSite: 'Lax',
			path: '/'
		});
	});
}

// Resolve the active-locale string for an ApiError construction. svelte-i18n
// is initialised at app startup before any code path that throws, so $_ is
// safe here — but guarded with a try just in case (the helper is also used
// from non-browser test harnesses where svelte-i18n isn't bootstrapped).
function apiErrorFallback(status: number): string {
	let t: (k: string, opts?: { values?: Record<string, string | number> }) => string;
	try {
		t = get(_);
	} catch {
		t = (k) => k;
	}
	if (status >= 500) return t('api.serverError', { values: { status } });
	if (status === 413) return t('api.fileTooLarge');
	if (status === 0) return t('api.networkError');
	return t('api.requestFailed', { values: { status } });
}

// --- Expired-session / 401 handling --------------------------------------
// Public (unauthenticated) route prefixes. A 401 while ALREADY on one of these
// must NOT redirect to login (would risk a redirect loop, and there's no
// authenticated location to preserve). Kept here (not imported from the app
// layout) so apiFetch has no app-layer dependency.
const PUBLIC_PATH_PREFIXES = [
	'/login',
	'/signup',
	'/forgot-password',
	'/otp',
	'/terms',
	'/privacy',
	'/reset-password'
];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATH_PREFIXES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

/**
 * A8 — query string ("next=<encoded current path>") for the login redirect when an
 * UNAUTHENTICATED visitor hits an (app) deep link, so they return there after login.
 * Isolated here (the encoding is the load-bearing, easy-to-get-wrong part) so the
 * layout's redirect is unit-testable; the layout composes it with the resolved
 * /login base. Mirrors the root layout's encodeURIComponent(pathname) contract.
 */
export function loginNextQuery(currentPath: string): string {
	return `next=${encodeURIComponent(currentPath)}`;
}

/**
 * Build the login URL a 401 / expired session should bounce to. Preserves the
 * current location in `?next=` (so re-auth returns the user where they were) and
 * tags `reason=expired` so the login page can show a "session expired" notice.
 *
 * Returns `null` when the current path is itself public/auth — there is nowhere
 * safer to send the user and redirecting would only risk a loop.
 */
export function expiredSessionLoginUrl(currentPath: string, origin: string): string | null {
	// `currentPath` is normally page.url.pathname, but be robust if a full
	// path+query is passed: classify on the pathname only so a public route with a
	// query (e.g. "/login?next=…") is still recognised and not redirected (no loop).
	const pathOnly = currentPath.split(/[?#]/, 1)[0] ?? currentPath;
	if (isPublicPath(pathOnly)) return null;
	const next = safeNextPath(currentPath, '/', origin); // reuse the open-redirect-safe contract
	const params = new URLSearchParams({ reason: 'expired' });
	if (next !== '/') params.set('next', next);
	return `/login?${params.toString()}`;
}

/**
 * Pluggable reaction to an authenticated request returning 401 (expired JWT, or
 * a revoked/deactivated user). The app layout registers the real implementation
 * (clear the session + redirect). It's an injectable hook so `pb.ts` never
 * imports the auth store / navigation (avoids a circular dependency) and so the
 * 401 behaviour is unit-testable in isolation.
 */
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
	unauthorizedHandler = handler;
}

/** Invoke the registered 401 handler (exposed for tests). Safe if none set. */
export function handleUnauthorized(): void {
	try {
		unauthorizedHandler?.();
	} catch {
		/* a faulty handler must not mask the ApiError that apiFetch is about to throw */
	}
}

export class ApiError extends Error {
	status: number;
	body: unknown;
	constructor(status: number, body: unknown) {
		// Prefer a meaningful message from the server; otherwise fall back to a
		// human-readable, status-aware message rather than a raw "HTTP 500" that
		// would otherwise surface to clinicians in the upload/inference error UI.
		const serverMsg =
			typeof body === 'object' && body !== null && 'message' in body
				? String((body as Record<string, unknown>).message ?? '')
				: '';
		super(serverMsg || apiErrorFallback(status));
		this.status = status;
		this.body = body;
	}
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	if (pb.authStore.token) {
		headers.set('Authorization', `Bearer ${pb.authStore.token}`);
	}
	let res: Response;
	try {
		res = await fetch(`${PB_URL}${path}`, { ...init, headers });
	} catch {
		// A network-level failure (server unreachable / offline / DNS) makes
		// fetch reject rather than return a Response, so it would otherwise
		// surface a raw "Failed to fetch" in the inference/upload error UI.
		// Normalise it to an ApiError(0) → friendly "Network error…" message.
		throw new ApiError(0, null);
	}
	if (!res.ok) {
		// An expired JWT or a revoked/deactivated user surfaces as 401 on EVERY
		// authenticated call. Tear the session down and bounce to login instead of
		// stranding the user on a dead shell that throws a generic error on every
		// action. Non-401s keep their existing ApiError behaviour untouched.
		if (res.status === 401) {
			handleUnauthorized();
		}
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			body = await res.text();
		}
		throw new ApiError(res.status, body);
	}
	return res;
}

export async function apiJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	if (init.body && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}
	const res = await apiFetch(path, { ...init, headers });
	return res.json() as Promise<T>;
}

export type UserRecord = RecordModel & {
	email: string;
	name?: string;
	verified: boolean;
	address?: string;
	mobile?: string;
	// Per-user opt-in for the CBCT/IOS ("3D") tools. Default OFF (the 3D AI is
	// segmentation-only / premature) → the app is 2D-only unless turned on in Settings.
	enable3d?: boolean;
	// Per-user opt-in for the "Photo" (intraoral camera image) modality. Default OFF —
	// the app shows X-ray + panoramic only until a clinician turns Photos on in Settings.
	enablePhoto?: boolean;
	// Per-user opt-in for the "Panoramic" modality (and, with it, the FMX view). Default
	// OFF → only intraoral X-ray is offered until a clinician turns Panoramic on in Settings.
	enablePanoramic?: boolean;
	// Admin "Labs" gate. Default OFF → the Settings "Labs" card (the experimental modality
	// opt-ins) is hidden entirely unless an admin sets this true on the user record.
	labs_enabled?: boolean;
};

export type SubscriptionRecord = RecordModel & {
	user: string;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	status: 'active' | 'trialing' | 'incomplete' | 'past_due' | 'canceled' | 'unpaid' | string;
	currentPeriodEnd: string;
	cancelAtPeriodEnd: boolean;
};
