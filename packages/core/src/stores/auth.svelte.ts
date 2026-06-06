import { pb, type UserRecord, type SubscriptionRecord, apiJson } from '../pb';
import { browser } from '../env';

/** Outcome of the consent gate. Drives what the (app) layout is allowed to show. */
export type ConsentGate =
	| 'pending' // initial check still in flight — show nothing yet (avoid flashing the modal)
	| 'allow' // consent confirmed `true` — full app access
	| 'consent' // confirmed NOT consented — show the consent modal
	| 'error'; // check failed (offline/500/timeout) — block with a retryable state

/**
 * Pure gating predicate (unit-testable without rendering the layout). App access
 * is granted ONLY when consent is a CONFIRMED `true`. A failed check blocks
 * ('error') rather than falling through — fail CLOSED, not open — so PHI is never
 * exposed without a recorded consent. `'pending'` keeps the gate quiet during the
 * very first in-flight check so we don't flash the modal.
 */
export function consentGate(state: {
	consentChecked: boolean;
	consentError: boolean;
	consentOk: boolean | null;
}): ConsentGate {
	if (!state.consentChecked) return 'pending';
	if (state.consentError) return 'error';
	if (state.consentOk === true) return 'allow';
	return 'consent';
}

/**
 * Decide how to react to a cross-tab PocketBase auth change (A4). Pure so it's
 * unit-testable without a real `storage` event. `prevUserId` is the id this tab
 * currently holds; `nextUserId` is what storage now says (null = cleared).
 */
export type CrossTabAuthAction = 'none' | 'logout' | 'reload';
export function crossTabAuthAction(
	prevUserId: string | null,
	nextUserId: string | null
): CrossTabAuthAction {
	if (prevUserId === nextUserId) return 'none'; // no identity change → nothing to do
	if (!nextUserId) return 'logout'; // signed out in another tab → log this tab out
	return 'reload'; // switched to a DIFFERENT user → hard reload to drop all cached PHI
}

// App-registered cleanup hooks, run during logout BEFORE the localStorage sweep.
// Dependency inversion: core must not import app stores (studies/history live in
// the app and hold the actual PHI caches), so the app layout registers their
// clearing here instead. Hooks must be synchronous-or-awaitable and idempotent.
type LogoutHook = () => void | Promise<void>;
const logoutHooks = new Set<LogoutHook>();

/** Register a cleanup to run on logout (e.g. clear an app store's in-memory PHI).
 *  Returns an unregister function. */
export function onLogout(hook: LogoutHook): () => void {
	logoutHooks.add(hook);
	return () => logoutHooks.delete(hook);
}

// The PocketBase JS SDK persists auth under this localStorage/cookie key.
const PB_AUTH_STORAGE_KEY = 'pocketbase_auth';
// Refresh the JWT comfortably under its lifetime so a long-lived tab isn't
// evicted mid-session. Cleared on logout (mirrors studies' interval lifecycle).
const AUTH_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min

class AuthStore {
	user = $state<UserRecord | null>(null);
	subscription = $state<SubscriptionRecord | null>(null);
	consentOk = $state<boolean | null>(null);
	// Has a consent check COMPLETED (success OR failure) since login? Gates the
	// blocking UI so we don't flash it during the initial in-flight check.
	consentChecked = $state(false);
	// Did the last consent check THROW (offline/500/timeout)? Drives the retryable
	// "couldn't verify consent" blocking state instead of failing open.
	consentError = $state(false);
	loading = $state(false);

	private authRefreshTimer: ReturnType<typeof setInterval> | null = null;
	private storageHandler: ((e: StorageEvent) => void) | null = null;

	constructor() {
		if (browser) {
			this.syncFromPB();
			pb.authStore.onChange(() => this.syncFromPB());
			this.startCrossTabSync();
			// A tab that loads already-authenticated (persisted token) should keep the
			// JWT fresh too, not only one that just logged in.
			if (pb.authStore.isValid) this.startAuthRefresh();
		}
	}

	private syncFromPB() {
		const wasLoggedIn = !!this.user;
		this.user = (pb.authStore.record as UserRecord | null) ?? null;
		if (!this.user) {
			this.subscription = null;
			this.consentOk = null;
			// A fresh login must re-run the consent gate, so reset the check flags
			// whenever we transition to logged-out (covers logout + token-clear).
			this.consentChecked = false;
			this.consentError = false;
			this.stopAuthRefresh();
		} else if (!wasLoggedIn && browser) {
			// Transitioned logged-out → logged-in (e.g. authWithPassword) → start the
			// refresh loop. Idempotent: startAuthRefresh clears any prior timer.
			this.startAuthRefresh();
		}
	}

	get isLoggedIn() {
		return !!this.user && pb.authStore.isValid;
	}

	/** Whether the CBCT/IOS ("3D") tools are enabled for the current user. Reads the
	 *  `enable3d` user field reactively; DEFAULTS OFF (the 3D AI is segmentation-only /
	 *  premature) so a user with no value set, or no user, gets the 2D-only product. */
	get threeDEnabled() {
		return this.user?.enable3d === true;
	}

	/** Whether the "Photo" (intraoral camera) modality is enabled for the current user.
	 *  Reads the `enablePhoto` user field reactively; DEFAULTS OFF — the app shows X-ray +
	 *  panoramic only until the clinician turns Photos on in Settings (mirrors enable3d). */
	get photoEnabled() {
		return this.user?.enablePhoto === true;
	}

	/** Whether the "Panoramic" modality is enabled for the current user. Reads the
	 *  `enablePanoramic` user field reactively; DEFAULTS OFF. Also gates the FMX
	 *  (full-mouth series) affordances — without panoramic there is no FMX. */
	get panoramicEnabled() {
		return this.user?.enablePanoramic === true;
	}

	/** Whether the "Labs" card (experimental modality opt-ins) is shown for the current
	 *  user. Reads the admin-set `labs_enabled` user field; DEFAULTS OFF — a normal user
	 *  never sees the card. Not user-toggleable: an admin flips it on the user record. */
	get labsEnabled() {
		return this.user?.labs_enabled === true;
	}

	/** Resolved consent gate for the current state (consumed by the (app) layout). */
	get consentGate(): ConsentGate {
		return consentGate(this);
	}

	// --- JWT refresh (A3) -----------------------------------------------------
	// PocketBase tokens expire; with zero authRefresh calls a long-lived tab would
	// eventually 401 on every request. Refresh periodically while the token is
	// valid; a failed refresh (revoked/expired) clears the session so the app's
	// 401/redirect path takes over rather than looping on a dead token.
	startAuthRefresh() {
		if (!browser) return;
		this.stopAuthRefresh();
		this.authRefreshTimer = setInterval(() => {
			if (!pb.authStore.isValid) {
				this.stopAuthRefresh();
				return;
			}
			pb.collection('users')
				.authRefresh()
				.then(() => this.syncFromPB())
				.catch(() => {
					// Token no longer refreshable (expired/revoked/deactivated). Clear it;
					// the next guarded navigation / apiFetch 401 handles the redirect.
					pb.authStore.clear();
					this.syncFromPB();
				});
		}, AUTH_REFRESH_INTERVAL_MS);
	}

	stopAuthRefresh() {
		if (this.authRefreshTimer) {
			clearInterval(this.authRefreshTimer);
			this.authRefreshTimer = null;
		}
	}

	// --- Cross-tab auth sync (A4) ---------------------------------------------
	// A `storage` event fires in OTHER tabs when localStorage changes. If another
	// tab logs out (or switches user), re-sync this tab's pb.authStore from storage
	// and react, so a shared machine can't leave the previous clinician's PHI on
	// screen in a stale tab.
	startCrossTabSync() {
		if (!browser || this.storageHandler) return;
		this.storageHandler = (e: StorageEvent) => this.handleStorageEvent(e);
		window.addEventListener('storage', this.storageHandler);
	}

	stopCrossTabSync() {
		if (browser && this.storageHandler) {
			window.removeEventListener('storage', this.storageHandler);
		}
		this.storageHandler = null;
	}

	/**
	 * Handle a cross-tab `storage` event for the PB auth key. Re-syncs pb.authStore
	 * from the just-written storage value, then returns the action taken (also
	 * applied as a side effect) so it's observable in tests.
	 */
	handleStorageEvent(e: StorageEvent): CrossTabAuthAction {
		if (e.key !== null && e.key !== PB_AUTH_STORAGE_KEY) return 'none';
		const prevUserId = this.user?.id ?? null;
		// Pull the other tab's write into THIS tab's SDK instance, then read it back.
		try {
			pb.authStore.loadFromCookie?.(typeof document !== 'undefined' ? document.cookie : '');
		} catch {
			/* best effort */
		}
		// If localStorage was cleared for the key, mirror that into the SDK.
		if (e.key === PB_AUTH_STORAGE_KEY && e.newValue === null && pb.authStore.isValid) {
			pb.authStore.clear();
		}
		this.syncFromPB();
		const nextUserId = pb.authStore.isValid ? (pb.authStore.record?.id ?? null) : null;
		const action = crossTabAuthAction(prevUserId, nextUserId);
		if (action === 'logout') {
			this.stopAuthRefresh();
			if (browser) window.location.assign('/login');
		} else if (action === 'reload') {
			if (browser) window.location.reload();
		}
		return action;
	}

	get hasActiveSubscription() {
		if (!this.subscription) return false;
		const s = this.subscription.status;
		if (s !== 'active' && s !== 'trialing') return false;
		// A missing/unparseable currentPeriodEnd must NOT downgrade an otherwise-active sub.
		// A `checkout.session.completed` event carries no period end, so the webhook leaves
		// it unset (PB stores '') until the next subscription event — it deliberately won't
		// write a bogus date. Pre-fix `new Date('').getTime()` was NaN and `NaN > now` false,
		// locking a just-paid clinician OUT. The date check is a safety net for a genuinely-
		// lapsed RENEWAL (a real past date), not a block on missing data — so trust the
		// active status when there's no valid date. (NB: guard the raw value first —
		// `new Date(null)` is epoch 0, a finite-but-wrong 1970, so isFinite alone misses it.)
		const raw = this.subscription.currentPeriodEnd;
		if (!raw) return true;
		const end = new Date(raw).getTime();
		if (!Number.isFinite(end)) return true;
		return end + 24 * 60 * 60 * 1000 > Date.now();
	}

	async loginWithPassword(email: string, password: string) {
		this.loading = true;
		try {
			await pb.collection('users').authWithPassword(email, password);
			this.syncFromPB();
		} finally {
			this.loading = false;
		}
	}

	async signup(email: string, password: string, name?: string) {
		this.loading = true;
		try {
			await pb.collection('users').create({
				email,
				password,
				passwordConfirm: password,
				name: name ?? ''
			});
			await pb.collection('users').authWithPassword(email, password);
			this.syncFromPB();
		} finally {
			this.loading = false;
		}
	}

	async requestOTP(email: string) {
		// Set `loading` like the other auth calls — the login "Send code" button is
		// disabled={auth.loading}, so without this it stayed enabled during the
		// request and a double-click fired two OTP emails.
		this.loading = true;
		try {
			const res = await pb.collection('users').requestOTP(email);
			return res.otpId;
		} finally {
			this.loading = false;
		}
	}

	async loginWithOTP(otpId: string, code: string) {
		this.loading = true;
		try {
			await pb.collection('users').authWithOTP(otpId, code);
			this.syncFromPB();
		} finally {
			this.loading = false;
		}
	}

	async requestPasswordReset(email: string) {
		this.loading = true;
		try {
			await pb.collection('users').requestPasswordReset(email);
		} finally {
			this.loading = false;
		}
	}

	async logout() {
		this.stopAuthRefresh();
		pb.authStore.clear();
		this.user = null;
		this.subscription = null;
		this.consentOk = null;
		// Re-arm the consent gate so a same-session re-login re-runs the check
		// instead of inheriting a stale 'allow'.
		this.consentChecked = false;
		this.consentError = false;
		// Drop in-memory user data + caches owned by APP stores (studies' patient
		// list, history's patient names — both PHI that must not survive a same-
		// session re-login). Core can't import those stores (they're app-level and
		// Dexie-backed), so the app registers their clearing via onLogout() — see
		// the (app) layout. Hooks are awaited so the sweep below runs after them.
		for (const hook of logoutHooks) {
			try {
				await hook();
			} catch {
				/* a faulty hook must not abort the rest of logout */
			}
		}
		// Wipe any per-study UI state from localStorage on signout. Keep device
		// preferences (theme + language) — they belong to the browser, not the
		// session, and resetting them on logout would be surprising.
		const keepKeys = new Set(['dxv:theme', 'dxv:lang']);
		try {
			if (typeof localStorage !== 'undefined') {
				for (let i = localStorage.length - 1; i >= 0; i--) {
					const key = localStorage.key(i);
					if (key && key.startsWith('dxv:') && !keepKeys.has(key)) localStorage.removeItem(key);
				}
			}
		} catch {
			/* localStorage unavailable — best effort. */
		}
	}

	async refreshSubscription() {
		if (!this.user) return;
		try {
			const list = await pb.collection('subscriptions').getList(1, 1, {
				filter: `user = "${this.user.id}"`,
				sort: '-created'
			});
			// A SUCCESSFUL query is authoritative — empty items means the user genuinely
			// has no subscription, so clearing to null is correct here.
			this.subscription = (list.items[0] as SubscriptionRecord | undefined) ?? null;
		} catch {
			// Transient failure (offline / 500 / timeout): KEEP the last-known
			// subscription rather than nulling it. This refresh runs once on every
			// (app)-shell mount with NO retry UI of its own, so nulling on a momentary
			// blip would treat a PAYING clinician as unsubscribed for the whole session
			// (paywall + AI runs blocked). Keeping the cached value is safe because:
			//   - it is non-null ONLY after a prior SUCCESSFUL fetch of a real row, so an
			//     unsubscribed user starts at null and stays null on error (no false grant);
			//   - `hasActiveSubscription` independently re-checks `currentPeriodEnd`, so a
			//     genuinely-expired sub still reads inactive even when kept;
			//   - the backend re-validates the subscription on every paywalled call (403),
			//     so the FE value is UX only, never the security boundary.
			// Contrast `checkConsent`, which fails CLOSED — consent gates PHI exposure;
			// subscription gates a paid feature, where availability for a known-good payer
			// is the correct default. Leave `this.subscription` unchanged.
		}
	}

	async checkConsent() {
		if (!this.user) return null;
		try {
			const res = await apiJson<boolean>('/api/consent/check', { method: 'POST' });
			this.consentOk = res === true;
			this.consentError = false;
			this.consentChecked = true;
			return this.consentOk;
		} catch {
			// FAIL CLOSED: a failed check (500/timeout/offline) must NOT grant access.
			// Flag the error so the gate blocks with a retryable "couldn't verify"
			// state. `consentOk` is left null (NOT a confirmed true) and consentChecked
			// flips true so the gate stops showing 'pending'.
			this.consentOk = null;
			this.consentError = true;
			this.consentChecked = true;
			return null;
		}
	}

	async agreeConsent() {
		await apiJson('/api/consent/agree', { method: 'POST' });
		this.consentOk = true;
		// A successful agree is a confirmed consent → clear any prior error and mark
		// the gate resolved so the app unblocks immediately.
		this.consentError = false;
		this.consentChecked = true;
	}

	/** Persist the CBCT/IOS ("3D") opt-in to the user record and sync it back into the
	 *  auth store so every consumer (route guard, patient tabs, upload) re-derives
	 *  reactively. Mirrors the account-page profile-save pattern: update the server
	 *  record, then `authStore.save` the returned record (cookie/localStorage write is
	 *  best-effort — it persists AFTER the server already did, so a private-mode throw
	 *  is non-fatal; the next navigation re-reads auth from the server). Throws on the
	 *  server update so the caller can surface a localized error. */
	async setThreeDEnabled(enabled: boolean) {
		if (!this.user) return;
		const rec = (await pb
			.collection('users')
			.update(this.user.id, { enable3d: enabled })) as UserRecord;
		try {
			pb.authStore.save(pb.authStore.token, rec);
		} catch (persistErr) {
			console.warn('auth: enable3d saved on the server but local persistence failed', persistErr);
			// Reflect the new value locally even if the cookie write failed.
			this.user = rec;
		}
	}

	/** Persist the "Photo" modality opt-in to the user record + sync it back into the
	 *  auth store so every consumer (upload picker, patient/viewer Photos tab) re-derives
	 *  reactively. Mirrors setThreeDEnabled exactly. */
	async setPhotoEnabled(enabled: boolean) {
		if (!this.user) return;
		const rec = (await pb
			.collection('users')
			.update(this.user.id, { enablePhoto: enabled })) as UserRecord;
		try {
			pb.authStore.save(pb.authStore.token, rec);
		} catch (persistErr) {
			console.warn(
				'auth: enablePhoto saved on the server but local persistence failed',
				persistErr
			);
			this.user = rec;
		}
	}

	/** Persist the "Panoramic" modality opt-in (mirrors setThreeDEnabled/setPhotoEnabled). */
	async setPanoramicEnabled(enabled: boolean) {
		if (!this.user) return;
		const rec = (await pb
			.collection('users')
			.update(this.user.id, { enablePanoramic: enabled })) as UserRecord;
		try {
			pb.authStore.save(pb.authStore.token, rec);
		} catch (persistErr) {
			console.warn(
				'auth: enablePanoramic saved on the server but local persistence failed',
				persistErr
			);
			this.user = rec;
		}
	}
}

export const auth = new AuthStore();
